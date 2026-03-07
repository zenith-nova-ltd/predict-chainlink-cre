/**
 * Simple helper to place an order (bet) on Polymarket using the CLOB client.
 *
 * Requirements:
 * - Install deps: npm install @polymarket/clob-client
 * - Set env PRIVATE_KEY to your Polygon wallet private key (EOA with USDCe).
 *
 * This follows the official quickstart:
 * https://docs.polymarket.com/quickstart/first-order
 */
import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { Wallet } from 'ethers';

const CLOB_HOST = 'https://clob.polymarket.com';
const POLYGON_CHAIN_ID = 137; // Polygon mainnet

export interface PlaceBetParams {
  tokenId: string; // CLOB token id for the outcome (from Gamma API: clobTokenIds)
  price: number; // Price per share, e.g. 0.55
  size: number; // Number of shares, e.g. 10
  side: 'BUY' | 'SELL'; // BUY or SELL
}

/**
 * Place a single limit order on Polymarket.
 * - Derives/uses user API credentials.
 * - Assumes you are trading as an EOA (signatureType = 0) with your own USDCe.
 */
export async function placePolymarketBet(params: PlaceBetParams) {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('Missing PRIVATE_KEY in environment');
  }

  const signer = new Wallet(privateKey);
  // ClobClient may expect ethers v5 Wallet; ethers v6 Wallet is compatible at runtime
  const signerForClob = signer as unknown as ConstructorParameters<typeof ClobClient>[2];
  const baseClient = new ClobClient(CLOB_HOST, POLYGON_CHAIN_ID, signerForClob);
  const userApiCreds = await baseClient.createOrDeriveApiKey();

  const SIGNATURE_TYPE = 0; // 0 = EOA (you pay gas, use your own wallet)
  const FUNDER_ADDRESS = signer.address;

  const client = new ClobClient(
    CLOB_HOST,
    POLYGON_CHAIN_ID,
    signerForClob,
    userApiCreds,
    SIGNATURE_TYPE,
    FUNDER_ADDRESS
  );

  const market = await client.getMarket(params.tokenId);
  const sideEnum = params.side === 'BUY' ? Side.BUY : Side.SELL;

  const response = await client.createAndPostOrder(
    {
      tokenID: params.tokenId,
      price: params.price,
      size: params.size,
      side: sideEnum,
    },
    {
      tickSize: market.tickSize,
      negRisk: market.negRisk,
    },
    OrderType.GTC // Good-Til-Cancelled
  );

  return response;
}
