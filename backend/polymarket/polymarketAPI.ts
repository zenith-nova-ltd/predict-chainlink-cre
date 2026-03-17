/// <reference types="node" />
import axios from 'axios';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { retry } from '../lib/utils/utils.js';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

// Parse proxy string "host:port:username:password" -> "http://username:password@host:port"
function parseProxyUrl(proxy: string): string {
  const parts = proxy.trim().split(':');
  if (parts.length >= 4) {
    const host = parts[0] ?? '';
    const port = parts[1] ?? '';
    const user = parts[2] ?? '';
    const password = parts.slice(3).join(':'); // password may contain ":"
    return `http://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}`;
  }
  return proxy;
}

// Use IPv4 and optional proxy so Node can reach APIs when browser works (e.g. corporate proxy/VPN).
// Supports: HTTPS_PROXY, HTTP_PROXY, or POLY_PROXY in format host:port:username:password
function createAxiosAgent(): https.Agent {
  const raw =
    process.env.POLY_PROXY ||
    process.env.POLYMARKET_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY;
  const proxy = raw ? parseProxyUrl(raw) : '';
  if (proxy) {
    try {
      return new HttpsProxyAgent(proxy) as https.Agent;
    } catch {
      // fall back to IPv4 agent
    }
  }
  return new https.Agent({ family: 4 });
}

const httpsAgent = createAxiosAgent();

function isRetryableNetworkError(err: any): boolean {
  const code = err?.code;
  const status = err?.response?.status;
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    (typeof status === 'number' && (status === 429 || status >= 500))
  );
}

/** Market outcome with label and implied probability (0–1) */
export interface MarketOutcome {
  label: string;
  price: number;
}

/** Simplified BTC up/down (or similar) market data */
export interface BtcMarketData {
  id: string;
  question: string;
  slug: string;
  outcomes: MarketOutcome[];
  clobTokenIds: string[];
  closed: boolean;
  /** ISO datetime when this 15m event window starts, if provided (eventStartTime) */
  eventStartTime?: string;
}

// --- internal types and helpers ---

interface PolymarketEvent {
  id: string;
  slug?: string;
  title?: string;
  active?: boolean;
  closed?: boolean;
  markets?: PolymarketMarket[];
}

interface PolymarketMarket {
  id?: string;
  question?: string;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string[];
  eventStartTime?: string;
}

function parseOutcomes(outcomesJson?: string, pricesJson?: string): MarketOutcome[] {
  if (!outcomesJson || !pricesJson) return [];
  let labels: string[];
  let prices: string[];
  try {
    labels = JSON.parse(outcomesJson) as string[];
    prices = JSON.parse(pricesJson) as string[];
  } catch {
    return [];
  }
  if (!Array.isArray(labels) || !Array.isArray(prices) || labels.length !== prices.length) return [];
  return labels.map((label, i) => ({
    label,
    price: parseFloat(prices[i] ?? '0') || 0,
  }));
}

/**
 * Fetches active events from Polymarket and returns markets related to BTC up/down
 * (or any crypto price direction). Uses Gamma API (no auth required).
 * When slug is set (e.g. "btc-updown-15m-1770690600" from polymarket.com/event/btc-updown-15m-1770690600), fetches that event by slug only.
 */
export async function fetchBtcUpDownMarkets(options?: {
  limit?: number;
  searchTitle?: string;
  slug?: string;
}): Promise<BtcMarketData[]> {
  const slug = options?.slug ?? '';
  const limit = options?.limit ?? 50;
  const searchTitle = options?.searchTitle ?? 'BTC';

  let events: PolymarketEvent[];

  if (slug) {
    const res = await retry(
      () =>
        axios.get(`${GAMMA_API}/events/slug/${encodeURIComponent(slug)}`, {
          httpsAgent,
          timeout: 15000,
        }),
      { maxAttempts: 3, backoffBase: 500, retryOn: isRetryableNetworkError }
    );
    const event = res.data as PolymarketEvent | null;
    events = event ? [event] : [];
  } else {
    const res = await retry(
      () =>
        axios.get(`${GAMMA_API}/events`, {
          httpsAgent,
          timeout: 15000,
          params: {
            active: true,
            closed: false,
            limit,
          },
        }),
      { maxAttempts: 3, backoffBase: 500, retryOn: isRetryableNetworkError }
    );
    events = res.data as PolymarketEvent[];
  }

  const results: BtcMarketData[] = [];

  for (const event of events) {
    const title = (event.title || '').toLowerCase();
    if (!slug && !title.includes('btc') && !title.includes('bitcoin')) continue;
    if (!slug && options?.searchTitle && !title.includes(searchTitle.toLowerCase())) continue;

    for (const market of event.markets || []) {
      const outcomes = parseOutcomes(market.outcomes, market.outcomePrices);
      if (outcomes.length === 0) continue;
      results.push({
        id: market.id ?? event.id,
        question: market.question ?? event.title ?? '',
        slug: event.slug ?? slug ?? '',
        outcomes,
        clobTokenIds: market.clobTokenIds ?? [],
        closed: !!event.closed,
        eventStartTime: market.eventStartTime,
      });
    }
  }

  return results;
}

/**
 * Fetches current mid/price for a single token from the CLOB (e.g. one outcome of a market).
 */
export async function fetchTokenPrice(tokenId: string, side: 'buy' | 'sell' = 'buy'): Promise<number> {
  const res = await retry(
    () =>
      axios.get(`${CLOB_API}/price`, {
        httpsAgent,
        timeout: 15000,
        params: { token_id: tokenId, side },
      }),
    { maxAttempts: 3, backoffBase: 500, retryOn: isRetryableNetworkError }
  );
  return parseFloat((res.data as { price: string }).price);
}

/**
 * Fetches order book for a token (bids/asks).
 */
export async function fetchOrderBook(
  tokenId: string
): Promise<{ bids: Array<{ price: string; size: string }>; asks: Array<{ price: string; size: string }> }> {
  const res = await retry(
    () =>
      axios.get(`${CLOB_API}/book`, {
        httpsAgent,
        timeout: 15000,
        params: { token_id: tokenId },
      }),
    { maxAttempts: 3, backoffBase: 500, retryOn: isRetryableNetworkError }
  );
  const data = res.data as {
    bids?: Array<{ price: string; size: string }>;
    asks?: Array<{ price: string; size: string }>;
  };
  return { bids: data.bids ?? [], asks: data.asks ?? [] };
}
