import cron from 'node-cron';
import { Wallet } from 'ethers';
import prisma from '../lib/db.js';
import { placePolymarketBet, getUserTradesForToken } from '../polymarket/placeBet.js';
import { getUserPositions, fetchTokenPrice, type UserPosition } from '../polymarket/polymarketAPI.js';

const POLY_MIN_SHARES = parseFloat(process.env.POLY_MIN_SHARES || '5');
const TAKE_PROFIT_PCT = 0.2;  // take-profit at entry × 1.2
const STOP_LOSS_PCT   = 0.2;  // stop-loss at entry × 0.7

// In-memory queue keyed by tokenId — prevents processing same position twice
const processingSet = new Set<string>();

function getWalletAddress(): string {
  const proxyWallet = process.env.PROXY_WALLET;
  if (proxyWallet?.trim()) return proxyWallet.trim().toLowerCase();

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error('[realBetMonitor] Missing PROXY_WALLET or PRIVATE_KEY in env');
  return new Wallet(privateKey).address.toLowerCase();
}

/**
 * Compute weighted-average entry price directly from on-chain BUY trade fills.
 * entryPrice = sum(fill.size * fill.price) / sum(fill.size)
 *
 * Falls back to null if no BUY trades found or all sizes are zero.
 */
async function getOnChainEntryPrice(tokenId: string): Promise<number | null> {
  const trades = await getUserTradesForToken(tokenId);

  const buyFills = trades.filter((t) => String(t.side).toUpperCase() === 'BUY');

  if (buyFills.length === 0) return null;

  let totalCost = 0;
  let totalSize = 0;

  for (const fill of buyFills) {
    const size = parseFloat(fill.size);
    const price = parseFloat(fill.price);
    if (Number.isFinite(size) && size > 0 && Number.isFinite(price) && price > 0) {
      totalCost += size * price;
      totalSize += size;
    }
  }

  if (totalSize <= 0) return null;

  const weightedAvg = totalCost / totalSize;
  return Number.isFinite(weightedAvg) ? weightedAvg : null;
}

async function processPosition(position: UserPosition): Promise<void> {
  const tag = `[realBetMonitor][${position.asset.slice(0, 12)}...]`;

  if (position.redeemable) return; // market resolved, nothing to sell

  const size = position.size;
  if (!size || size <= 0) return;

  // ── Entry price: directly from on-chain BUY fills ─────────────────────────
  let entryPrice: number | null;
  try {
    entryPrice = await getOnChainEntryPrice(position.asset);
  } catch (err) {
    console.warn(`${tag} failed to fetch on-chain trades, skip:`, err instanceof Error ? err.message : err);
    return;
  }

  if (!entryPrice) {
    console.warn(`${tag} no on-chain BUY fills found for asset, skip`);
    return;
  }

  // ── Live sell price from CLOB ──────────────────────────────────────────────
  let livePrice: number;
  try {
    livePrice = await fetchTokenPrice(position.asset, 'sell');
    if (!Number.isFinite(livePrice) || livePrice <= 0 || livePrice > 1.0001) {
      throw new Error(`invalid price: ${livePrice}`);
    }
  } catch (err) {
    console.warn(`${tag} cannot get live price, skip:`, err instanceof Error ? err.message : err);
    return;
  }

  // ── Take-profit check ─────────────────────────────────────────────────────
  // Use takeProfitPct from DB if we have a record, else default 20%
  const dbBet = await prisma.virtualBet.findFirst({
    where: { clobTokenId: position.asset, status: 'PENDING', isReal: true } as any,
    orderBy: { createdAt: 'desc' },
    select: { id: true, takeProfitPct: true, amount: true },
  });
  const target    = entryPrice * (1 + TAKE_PROFIT_PCT);
  const stopLoss  = entryPrice * (1 - STOP_LOSS_PCT);

  console.log(
    `${tag} entry=${entryPrice.toFixed(4)} live=${livePrice.toFixed(4)}` +
    ` tp=${target.toFixed(4)} sl=${stopLoss.toFixed(4)}` +
    ` | ${position.outcome} "${position.title.slice(0, 40)}"`,
  );

  const isTakeProfit = livePrice >= target;
  const isStopLoss   = livePrice <= stopLoss;

  if (!isTakeProfit && !isStopLoss) return;

  console.log(`${tag} ${isTakeProfit ? 'TAKE-PROFIT' : 'STOP-LOSS'} triggered (live=${livePrice.toFixed(4)})`);


  // ── Minimum sell size validation ──────────────────────────────────────────
  const notional = livePrice * size;
  if (notional < 1 || size < POLY_MIN_SHARES) {
    console.warn(`${tag} SELL too small (notional=$${notional.toFixed(2)}, size=${size.toFixed(2)}), skip`);
    return;
  }

  // ── Place SELL on-chain ───────────────────────────────────────────────────
  const result = await placePolymarketBet({
    tokenId: position.asset,
    price: livePrice,
    size,
    side: 'SELL',
  });

  console.log(`${tag} SELL placed`, result);

  // ── Update DB if we have a matching record (non-critical) ─────────────────
  if (dbBet?.id) {
    try {
      const takeProfitAmount = size * livePrice;
      const costBasis = dbBet.amount ?? size * entryPrice;
      const pnl = takeProfitAmount - costBasis;

      const { count } = await prisma.virtualBet.updateMany({
        where: { id: dbBet.id, status: 'PENDING' },
        data: {
          status: isTakeProfit ? 'WON' : 'LOST',
          pnl,
          exitOutcomePrice: livePrice,
          takeProfitAmount,
          settledAt: new Date(),
          closeReason: isTakeProfit ? 'TAKE_PROFIT_AUTO' : 'STOP_LOSS_AUTO',
        } as any,
      });

      if (count > 0) {
        console.log(`${tag} DB ${dbBet.id} settled — pnl=${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
      }
    } catch (err) {
      // SELL already on-chain; DB update is best-effort
      console.error(`${tag} DB update failed (SELL was placed):`, err instanceof Error ? err.message : err);
    }
  }
}

async function checkAndAutoSell(): Promise<void> {
  const walletAddress = getWalletAddress();

  let positions: UserPosition[];
  try {
    positions = await getUserPositions(walletAddress);
  } catch (err) {
    console.error('[realBetMonitor] Failed to fetch positions:', err instanceof Error ? err.message : err);
    return;
  }

  const active = positions.filter((p) => p.size > 0 && !p.redeemable);
  if (active.length === 0) return;

  console.log(`[realBetMonitor] ${active.length} active position(s) for ${walletAddress.slice(0, 10)}...`);

  for (const position of active) {
    if (processingSet.has(position.asset)) {
      console.log(`[realBetMonitor] ${position.asset.slice(0, 12)}... already in queue, skip`);
      continue;
    }

    processingSet.add(position.asset);

    processPosition(position)
      .catch((err) =>
        console.error(
          `[realBetMonitor] ${position.asset.slice(0, 12)}... error:`,
          err instanceof Error ? err.message : err,
        ),
      )
      .finally(() => processingSet.delete(position.asset));
  }
}

export function startRealBetMonitorCron(): void {
  const intervalSec = parseInt(process.env.REAL_BET_MONITOR_INTERVAL_SEC || '30', 10);
  const cronExpr = `*/${intervalSec} * * * * *`;
  console.log(`[realBetMonitor] Starting cron (${cronExpr})`);

  cron.schedule(cronExpr, async () => {
    try {
      await checkAndAutoSell();
    } catch (err) {
      console.error('[realBetMonitor] top-level error:', err instanceof Error ? err.message : err);
    }
  });
}
