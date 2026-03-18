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

async function createAuthedClobClient(): Promise<ClobClient> {
  // createAxiosAgent(); // disabled for now; enable if needed

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error('Missing PRIVATE_KEY');
  const signer = new Wallet(privateKey);
  const signerForClob = signer as unknown as ConstructorParameters<typeof ClobClient>[2];

  const PROXY_WALLET = process.env.PROXY_WALLET;

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

  return new ClobClient(CLOB_HOST, POLYGON_CHAIN_ID, signerForClob, userApiCreds, 2, PROXY_WALLET);
}

export async function getPolymarketOrder(orderId: string) {
  if (!orderId?.trim()) throw new Error('Missing orderId');
  const client = await createAuthedClobClient();
  return client.getOrder(orderId.trim());
}

/**
 * Fetch all on-chain trades for a specific token from Polymarket CLOB.
 * Returns BUY + SELL fills for the authenticated wallet.
 * Use BUY fills to compute the real weighted-average entry price.
 */
export async function getUserTradesForToken(tokenId: string) {
  const client = await createAuthedClobClient();
  return client.getTrades({ asset_id: tokenId });
}

export async function placePolymarketBet(params: PlaceBetParams) {
  const client = await createAuthedClobClient();

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