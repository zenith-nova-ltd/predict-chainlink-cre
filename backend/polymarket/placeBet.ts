// backend/polymarket/placeBet.ts
import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { Wallet } from 'ethers';
import dotenv from 'dotenv';
import { HttpsProxyAgent } from 'https-proxy-agent';
import https from 'https';


dotenv.config();

const CLOB_HOST = 'https://clob.polymarket.com';
const POLYGON_CHAIN_ID = 137; // Polygon mainnet

export type PlaceBetParams = {
  tokenId: string;
  price: number;
  size: number;
  side: 'BUY' | 'SELL';
};

// --- THÊM: parse proxy giống polymarketAPI.ts ---
function parseProxyUrl(proxy: string): string {
  const trimmed = proxy.trim();

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  // host:port:user:password
  const parts = trimmed.split(':');
  if (parts.length >= 4) {
    const host = parts[0] ?? '';
    const port = parts[1] ?? '';
    const user = encodeURIComponent(parts[2] ?? '');       // ✅ encode
    const password = encodeURIComponent(parts.slice(3).join(':')); // ✅ encode
    return `http://${user}:${password}@${host}:${port}`;
  }

  return trimmed;
}
function createAxiosAgent() {
  const raw =
    process.env.POLY_PROXY ||
    process.env.POLYMARKET_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY;
  const proxyUrl = raw ? parseProxyUrl(raw) : '';
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  (https.globalAgent as any) = new HttpsProxyAgent(proxyUrl);
}

// Singleton: only derive API key once and reuse the client
let _clobClientPromise: Promise<ClobClient> | null = null;

function getAuthedClobClient(): Promise<ClobClient> {
  if (!_clobClientPromise) {
    _clobClientPromise = _createAuthedClobClient().catch((err) => {
      // Reset so the next call retries
      _clobClientPromise = null;
      throw err;
    });
  }
  return _clobClientPromise;
}

function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|socket hang up/i.test(msg);
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3, delayMs = 1500): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isNetworkError(err) && attempt < maxAttempts) {
        console.warn(`[CLOB Client] network error (attempt ${attempt}/${maxAttempts}), retry in ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function _createAuthedClobClient(): Promise<ClobClient> {
  // createAxiosAgent(); // disabled for now; enable if needed

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error('Missing PRIVATE_KEY');
  const signer = new Wallet(privateKey);
  const signerForClob = signer as unknown as ConstructorParameters<typeof ClobClient>[2];

  const PROXY_WALLET = process.env.PROXY_WALLET;

  console.log('[CLOB Client] Deriving API key (once)...');
  const tempClient = new ClobClient(
    CLOB_HOST,
    POLYGON_CHAIN_ID,
    signer,
    undefined, // chưa có creds
    2, // GNOSIS_SAFE
    PROXY_WALLET,
  );

  let userApiCreds;
  try {
    userApiCreds = await tempClient.createOrDeriveApiKey();
  } catch (err) {
    throw new Error(`[Auth] Failed to get API key — proxy bị chặn hoặc sai config: ${err}`);
  }

  if (!userApiCreds?.key || !userApiCreds?.secret) {
    throw new Error('[Auth] API key trống — createOrDeriveApiKey thất bại silently');
  }

  console.log('[CLOB Client] API key derived successfully, client ready.');
  return new ClobClient(CLOB_HOST, POLYGON_CHAIN_ID, signerForClob, userApiCreds, 2, PROXY_WALLET);
}

export async function getPolymarketOrder(orderId: string) {
  if (!orderId?.trim()) throw new Error('Missing orderId');
  return withRetry(async () => {
    const client = await getAuthedClobClient();
    return client.getOrder(orderId.trim());
  });
}

/**
 * Check if there are any open (live/active) SELL orders for a given token on the CLOB.
 * Returns the list of open SELL orders; empty array if none.
 */
export async function getOpenSellOrders(tokenId: string): Promise<any[]> {
  return withRetry(async () => {
    const client = await getAuthedClobClient();
    const openOrders = await client.getOpenOrders({ asset_id: tokenId });
    const orders = Array.isArray(openOrders) ? openOrders : (openOrders as any)?.data ?? [];
    return orders.filter(
      (o: any) => String(o.side).toUpperCase() === 'SELL',
    );
  });
}

/**
 * Fetch all on-chain trades for a specific token from Polymarket CLOB.
 * Returns BUY + SELL fills for the authenticated wallet.
 * Use BUY fills to compute the real weighted-average entry price.
 */
export async function getUserTradesForToken(tokenId: string): Promise<any[]> {
  try {
    return await withRetry(async () => {
      const client = await getAuthedClobClient();
      const result = await client.getTrades({ asset_id: tokenId });
      if (Array.isArray(result)) return result;
      const data = (result as any)?.data;
      if (Array.isArray(data)) return data;
      console.warn(`[getUserTradesForToken] unexpected response shape, returning []: ${typeof result}`);
      return [];
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not iterable|cannot read|undefined/i.test(msg)) {
      console.warn(`[getUserTradesForToken] CLOB returned non-iterable response, returning []: ${msg}`);
      return [];
    }
    throw err;
  }
}

export async function placePolymarketBet(params: PlaceBetParams) {
  const client = await getAuthedClobClient();

  const response = await client.createAndPostOrder(
    {
      tokenID: params.tokenId,
      price: params.price,
      size: params.size,
      side: params.side === 'BUY' ? Side.BUY : Side.SELL,
    },
    {
      tickSize: "0.01",
      negRisk: false,
    },
  );

  return response;
}

export type MarketSellParams = {
  tokenId: string;
  amount: number;    // shares to sell
  orderType?: 'FOK' | 'FAK';
};

export type MarketSellResult = {
  response: any;
  expectedPrice: number | null;
};

export type LimitSellParams = {
  tokenId: string;
  price: number;   // limit price (0–1), e.g. 0.72
  size: number;    // shares to sell
};

/**
 * Sell shares via market order (FOK by default — fill entire amount or cancel).
 * Uses CLOB `createAndPostMarketOrder` which matches against existing bids.
 *
 * - FOK (Fill or Kill): entire order must fill immediately or it's cancelled.
 * - FAK (Fill and Kill): partial fills allowed, unfilled portion is cancelled.
 */
export async function sellMarketOrder(params: MarketSellParams): Promise<MarketSellResult> {
  const client = await getAuthedClobClient();
  const ot = params.orderType === 'FAK' ? OrderType.FAK : OrderType.FOK;

  let expectedPrice: number | null = null;
  try {
    expectedPrice = await withRetry(() =>
      client.calculateMarketPrice(params.tokenId, Side.SELL, params.amount, ot),
    );
  } catch {
    // non-critical — proceed without estimated price
  }

  console.log(
    `[sellMarketOrder] tokenId=${params.tokenId.slice(0, 12)}... amount=${params.amount}` +
    ` type=${ot} expectedPrice=${expectedPrice?.toFixed(4) ?? 'N/A'}`,
  );

  const response = await withRetry(() =>
    client.createAndPostMarketOrder(
      {
        tokenID: params.tokenId,
        amount: params.amount,
        side: Side.SELL,
        orderType: ot,
      },
      { tickSize: '0.01', negRisk: false },
      ot,
    ),
  );

  return { response, expectedPrice };
}

/**
 * Sell shares via limit order at a specific price.
 * Uses `createAndPostOrder` with Side.SELL — rests on the book until filled or cancelled.
 *
 * @param params.tokenId  CLOB token ID of the position to sell
 * @param params.price    Limit price (0–1), e.g. 0.72
 * @param params.size     Number of shares to sell
 */
export async function sellLimitOrder(params: LimitSellParams): Promise<any> {
  console.log(
    `[sellLimitOrder] tokenId=${params.tokenId.slice(0, 12)}... price=${params.price.toFixed(4)} size=${params.size}`,
  );

  return withRetry(async () => {
    const client = await getAuthedClobClient();
    return client.createAndPostOrder(
      {
        tokenID: params.tokenId,
        price: params.price,
        size: params.size,
        side: Side.SELL,
      },
      { tickSize: '0.01', negRisk: false },
    );
  });
}