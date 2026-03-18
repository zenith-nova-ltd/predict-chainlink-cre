import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { PolymarketUpDownAgent } from './polymarket/prediction.js';
import { getPolymarketOrder, placePolymarketBet } from './polymarket/placeBet.js';
import prisma from './lib/db.js';
import { authMiddleware, signToken } from './auth/middleware.js';
import { startSettlementCron } from './services/settlement.ts';
import { startRealBetMonitorCron } from './services/realBetMonitor.ts';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

const agent = new PolymarketUpDownAgent();

// Polymarket CLOB yêu cầu tối thiểu một số "shares" nhất định mỗi lệnh.
// Mặc định dùng 5 shares nếu không cấu hình khác qua env.
const POLY_MIN_SHARES =
  process.env.POLY_MIN_SHARES != null && process.env.POLY_MIN_SHARES !== ''
    ? Number(process.env.POLY_MIN_SHARES)
    : 5;

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter((s) => s.trim().length > 0);

  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return [];
    if (s.startsWith('[') && s.endsWith(']')) {
      try {
        const parsed = JSON.parse(s) as unknown;
        if (Array.isArray(parsed)) return parsed.map(String).filter((x) => x.trim().length > 0);
      } catch {
        // fall through
      }
    }
    return [s];
  }

  return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toHistoryResponse(row: Record<string, any>) {
  return {
    id: row.id,
    symbol: row.symbol,
    timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
    current_price: row.currentPrice,
    market: {
      market_slug: row.marketSlug,
      question: row.question,
      outcomes: row.outcomes as string[],
      outcomePrices: row.outcomePrices as number[],
      clobTokenIds: normalizeStringArray(row.clobTokenIds),
    },
    prediction: {
      market_slug: row.marketSlug,
      direction: row.direction,
      size_usd: row.sizeUsd,
      max_loss_usd: row.maxLossUsd,
      edge_prob: row.edgeProb,
    },
    reasoning: row.reasoning,
  };
}

// ─── Auth Routes ───────────────────────────────────────────────

app.get('/api/auth/nonce', async (req, res) => {
  try {
    const address = (req.query.address as string | undefined)?.trim().toLowerCase();
    if (!address || !ethers.utils.isAddress(address)) {
      res.status(400).json({ error: 'Invalid wallet address' });
      return;
    }

    let user = await prisma.user.findUnique({ where: { walletAddress: address } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          walletAddress: address,
          nonce: crypto.randomUUID(),
        },
      });
    }

    res.json({ nonce: user.nonce });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[auth/nonce] failed:', message);
    res.status(500).json({ error: message });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    const { address, signature } = req.body as { address?: string; signature?: string };
    if (!address || !signature) {
      res.status(400).json({ error: 'Missing address or signature' });
      return;
    }

    const normalizedAddress = address.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { walletAddress: normalizedAddress } });
    if (!user) {
      res.status(404).json({ error: 'User not found. Request nonce first.' });
      return;
    }

    const message = `Sign this message to login to Prediction Bot.\n\nNonce: ${user.nonce}`;
    const recoveredAddress = ethers.utils.verifyMessage(message, signature).toLowerCase();

    if (recoveredAddress !== normalizedAddress) {
      res.status(401).json({ error: 'Signature verification failed' });
      return;
    }

    const newNonce = crypto.randomUUID();
    await prisma.user.update({
      where: { id: user.id },
      data: { nonce: newNonce },
    });

    const token = signToken({ userId: user.id, walletAddress: normalizedAddress });

    res.json({
      token,
      user: {
        id: user.id,
        address: normalizedAddress,
        balance: user.balance,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[auth/verify] failed:', message);
    res.status(500).json({ error: message });
  }
});

function getDisplayStatusForBet(bet: { status: string; pnl: number | null }): 'WIN' | 'LOST' | 'PENDING' {
  // Pending bets are always PENDING
  if (bet.status === 'PENDING') return 'PENDING';

  // Cancelled bets are excluded from WIN/LOST and treated as neither
  if (bet.status === 'CANCELLED') return 'PENDING';

  const pnl = bet.pnl ?? 0;
  if (pnl > 0) return 'WIN';
  return 'LOST';
}

app.get('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const bets = await prisma.virtualBet.findMany({ where: { userId: user.id } });
    const totalBets = bets.length;

    const settledBets = bets.filter(
      (b) => b.status !== 'PENDING' && b.status !== 'CANCELLED',
    );
    const wonBets = settledBets.filter((b) => getDisplayStatusForBet({ status: b.status, pnl: b.pnl ?? null }) === 'WIN')
      .length;
    const totalPnl = settledBets.reduce((sum, b) => sum + (b.pnl ?? 0), 0);
    const winRate = settledBets.length > 0 ? wonBets / settledBets.length : 0;

    res.json({
      id: user.id,
      address: user.walletAddress,
      balance: user.balance,
      totalBets,
      settledBets: settledBets.length,
      wonBets,
      totalPnl: Math.round(totalPnl * 100) / 100,
      winRate: Math.round(winRate * 1000) / 10,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[user/profile] failed:', message);
    res.status(500).json({ error: message });
  }
});

// ─── Virtual Bet Routes ────────────────────────────────────────

app.post('/api/virtual-bet', authMiddleware, async (req, res) => {
  try {
    console.log('Virtual bet request received');
    const { predictionId, direction, amount } = req.body as {
      predictionId?: string;
      direction?: 'UP' | 'DOWN';
      amount?: number;
    };

    if (!predictionId || !direction || !amount || amount <= 0) {
      res.status(400).json({ error: 'Missing or invalid fields: predictionId, direction, amount' });
      return;
    }

    if (direction !== 'UP' && direction !== 'DOWN') {
      res.status(400).json({ error: 'Direction must be UP or DOWN' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (user.balance < amount) {
      res.status(400).json({ error: `Insufficient balance. Current: $${user.balance.toFixed(2)}` });
      return;
    }

    const prediction = await prisma.prediction.findUnique({ where: { id: predictionId } });
    if (!prediction) {
      res.status(404).json({ error: 'Prediction not found' });
      return;
    }

    const outcomes = prediction.outcomes as string[];
    const prices = prediction.outcomePrices as number[];
    const dirIndex = outcomes.findIndex((o) => o.toLowerCase() === direction.toLowerCase());
    const outcomePrice = prices[dirIndex] ?? 0.5;
    const potentialPayout = amount / outcomePrice;

    const { bet, balance } = await prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: {
          id: user.id,
          balance: { gte: amount },
        },
        data: {
          balance: { decrement: amount },
        },
      });

      if (count === 0) {
        throw new Error('INSUFFICIENT_BALANCE');
      }

      const createdBet = await tx.virtualBet.create({
        data: {
          userId: user.id,
          predictionId,
          marketSlug: prediction.marketSlug,
          direction,
          amount,
          outcomePrice,
          potentialPayout,
        },
      });

      const updatedUser = await tx.user.findUnique({
        where: { id: user.id },
        select: { balance: true },
      });

      if (updatedUser) {
        console.log(
          `[balance] User ${user.id} debited $${amount.toFixed(
            2,
          )} for virtual bet ${createdBet.id}. New balance: $${updatedUser.balance.toFixed(2)}`,
        );
      }

      return {
        bet: createdBet,
        balance: updatedUser!.balance,
      };
    });

    res.json({
      id: bet.id,
      marketSlug: bet.marketSlug,
      direction: bet.direction,
      amount: bet.amount,
      outcomePrice: bet.outcomePrice,
      potentialPayout: Math.round(bet.potentialPayout * 100) / 100,
      status: bet.status,
      balance: Math.round(balance * 100) / 100,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message === 'INSUFFICIENT_BALANCE') {
      res.status(400).json({
        error: `Insufficient balance for bet amount $${(req.body?.amount as number | undefined)?.toFixed?.(2) ?? ''}`,
      });
      return;
    }

    console.error('[virtual-bet] failed:', message);
    res.status(500).json({ error: message });
  }
});

// Register a "shadow" virtual bet for a real on-chain order so that
// auto-sell & history can reuse the same virtualBet table.
app.post('/api/real-bet/register', authMiddleware, async (req, res) => {
  try {
    const { predictionId, direction, amount, clobOrderId, clobTokenId, clobShares } = req.body as {
      predictionId?: string;
      direction?: 'UP' | 'DOWN';
      amount?: number;
      clobOrderId?: string;
      clobTokenId?: string;
      clobShares?: number;
    };

    if (!predictionId || !direction || !amount || amount <= 0) {
      res
        .status(400)
        .json({ error: 'Missing or invalid fields: predictionId, direction, amount' });
      return;
    }

    if (direction !== 'UP' && direction !== 'DOWN') {
      res.status(400).json({ error: 'Direction must be UP or DOWN' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const prediction = await prisma.prediction.findUnique({ where: { id: predictionId } });
    if (!prediction) {
      res.status(404).json({ error: 'Prediction not found' });
      return;
    }

    const outcomes = prediction.outcomes as string[];
    const prices = prediction.outcomePrices as number[];
    const dirIndex = outcomes.findIndex((o) => o.toLowerCase() === direction.toLowerCase());
    const outcomePrice = prices[dirIndex] ?? 0.5;
    const potentialPayout = amount / outcomePrice;

    const bet = await prisma.virtualBet.create({
      data: {
        userId: user.id,
        predictionId,
        marketSlug: prediction.marketSlug,
        direction,
        amount,
        outcomePrice,
        potentialPayout,
        // NOTE: these fields require a Prisma migration + generate
        isReal: true,
        clobOrderId: clobOrderId?.trim() || null,
        clobTokenId: clobTokenId?.trim() || null,
        clobShares: Number.isFinite(clobShares as number) ? (clobShares as number) : null,
      } as any,
    });

    console.log(
      `[real-bet/register] Shadow virtual bet ${bet.id} created for real order. Amount=$${amount.toFixed(
        2,
      )}, outcomePrice=${outcomePrice.toFixed(4)}, potentialPayout=$${potentialPayout.toFixed(2)}`,
    );

    res.json({
      id: bet.id,
      marketSlug: bet.marketSlug,
      direction: bet.direction,
      amount: bet.amount,
      outcomePrice: bet.outcomePrice,
      potentialPayout: Math.round(bet.potentialPayout * 100) / 100,
      status: bet.status,
      // Balance is unchanged for real bets; return current balance for convenience
      balance: Math.round(user.balance * 100) / 100,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[real-bet/register] failed:', message);
    res.status(500).json({ error: message });
  }
});

app.get('/api/virtual-bets', authMiddleware, async (req, res) => {
  try {
    const status = (Array.isArray(req.query.status) ? req.query.status[0] : req.query.status) as
      | string
      | undefined;
    const where: Record<string, unknown> = { userId: req.user!.userId };
    if (status && ['PENDING', 'WON', 'LOST', 'CANCELLED'].includes(status)) {
      where.status = status;
    }

    const bets = await prisma.virtualBet.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        prediction: {
          select: {
            symbol: true,
            question: true,
            direction: true,
            currentPrice: true,
            edgeProb: true,
          },
        },
      },
    });

    res.json(
      bets.map((b) => {
        const roundedPnl = b.pnl != null ? Math.round(b.pnl * 100) / 100 : null;
        const displayStatus = getDisplayStatusForBet({
          status: b.status,
          pnl: roundedPnl,
        });

        return {
          id: b.id,
          marketSlug: b.marketSlug,
          direction: b.direction,
          amount: b.amount,
          outcomePrice: b.outcomePrice,
          potentialPayout: Math.round(b.potentialPayout * 100) / 100,
          status: b.status,
          displayStatus,
          pnl: roundedPnl,
          settledAt: b.settledAt?.toISOString() ?? null,
          createdAt: b.createdAt.toISOString(),
          prediction: b.prediction,
        };
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[virtual-bets] failed:', message);
    res.status(500).json({ error: message });
  }
});

app.get('/api/virtual-bets/summary', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const bets = await prisma.virtualBet.findMany({ where: { userId: user.id } });
    const totalBets = bets.length;

    const pendingBets = bets.filter((b) => getDisplayStatusForBet({ status: b.status, pnl: b.pnl ?? null }) === 'PENDING')
      .length;

    const settledDisplayBets = bets.filter(
      (b) => getDisplayStatusForBet({ status: b.status, pnl: b.pnl ?? null }) !== 'PENDING',
    );

    const wonBets = settledDisplayBets.filter(
      (b) => getDisplayStatusForBet({ status: b.status, pnl: b.pnl ?? null }) === 'WIN',
    ).length;

    const lostBets = settledDisplayBets.length - wonBets;

    const totalPnl = settledDisplayBets.reduce((sum, b) => sum + (b.pnl ?? 0), 0);
    const winRate = settledDisplayBets.length > 0 ? wonBets / settledDisplayBets.length : 0;

    res.json({
      balance: user.balance,
      totalBets,
      pendingBets,
      settledBets: settledDisplayBets.length,
      wonBets,
      lostBets,
      totalPnl: Math.round(totalPnl * 100) / 100,
      winRate: Math.round(winRate * 1000) / 10,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[virtual-bets/summary] failed:', message);
    res.status(500).json({ error: message });
  }
});

app.post('/api/virtual-bet/:id/sell', authMiddleware, async (req, res) => {
  try {
    const betId = String((req.params as Record<string, unknown>)?.id ?? '').trim();
    if (!betId) {
      res.status(400).json({ error: 'Missing bet id' });
      return;
    }
    const { exitOutcomePrice } = req.body as { exitOutcomePrice?: number };

    console.log('[virtual-bet/sell] incoming request', {
      betId,
      exitOutcomePrice,
      userId: req.user!.userId,
    });

    if (!exitOutcomePrice || !Number.isFinite(exitOutcomePrice) || exitOutcomePrice <= 0 || exitOutcomePrice > 1.0001) {
      res.status(400).json({ error: 'Invalid exitOutcomePrice. Must be in (0, 1].' });
      return;
    }

    const bet = await prisma.virtualBet.findUnique({
      where: { id: betId },
    });

    if (!bet || bet.userId !== req.user!.userId) {
      console.warn('[virtual-bet/sell] bet not found or not owned by user', {
        betId,
        userId: req.user!.userId,
      });
      res.status(404).json({ error: 'Virtual bet not found' });
      return;
    }

    if (bet.status !== 'PENDING') {
      console.warn('[virtual-bet/sell] bet not pending', {
        betId,
        status: bet.status,
      });
      res.status(400).json({ error: `Bet is not PENDING (current status: ${bet.status})` });
      return;
    }

    if (!bet.outcomePrice || bet.outcomePrice <= 0) {
      console.error('[virtual-bet/sell] invalid outcomePrice on bet', {
        betId,
        outcomePrice: bet.outcomePrice,
      });
      res.status(400).json({ error: 'Invalid stored outcomePrice for bet' });
      return;
    }

    const entryPrice = bet.outcomePrice;
    const shares = bet.amount / entryPrice;
    const takeProfitAmount = shares * exitOutcomePrice;
    const pnl = takeProfitAmount - bet.amount;

    const { updatedBet, balance } = await prisma.$transaction(async (tx) => {
      const now = new Date();

      const { count } = await tx.virtualBet.updateMany({
        where: { id: bet.id, status: 'PENDING' },
        data: {
          status: 'WON' as never,
          pnl,
          exitOutcomePrice,
          takeProfitAmount,
          settledAt: now,
          closeReason: 'TAKE_PROFIT',
        } as any,
      });

      if (count === 0) {
        throw new Error('BET_NOT_PENDING');
      }

      const updated = await tx.virtualBet.findUnique({ where: { id: bet.id } });
      if (!updated) throw new Error('BET_NOT_FOUND_AFTER_UPDATE');

      const user = await tx.user.update({
        where: { id: bet.userId },
        data: { balance: { increment: takeProfitAmount } },
        select: { balance: true },
      });

      console.log(
        `[virtual-bet] Bet ${bet.id} cashed out at outcomePrice=${exitOutcomePrice.toFixed(
          4,
        )}, takeProfitAmount=$${takeProfitAmount.toFixed(2)}, pnl=$${pnl.toFixed(2)}`,
      );

      return { updatedBet: updated, balance: user.balance };
    });

    res.json({
      id: updatedBet.id,
      marketSlug: updatedBet.marketSlug,
      direction: updatedBet.direction,
      amount: updatedBet.amount,
      outcomePrice: updatedBet.outcomePrice,
      potentialPayout: Math.round(updatedBet.potentialPayout * 100) / 100,
      status: updatedBet.status,
      pnl: updatedBet.pnl != null ? Math.round(updatedBet.pnl * 100) / 100 : null,
      balance: Math.round(balance * 100) / 100,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'BET_NOT_PENDING') {
      res.status(409).json({ error: 'Bet is no longer PENDING' });
      return;
    }
    console.error('[virtual-bet/sell] failed:', message);
    res.status(500).json({ error: message });
  }
});

function normalizeOrderStatus(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') return raw.toLowerCase();
  return String(raw).toLowerCase();
}

function extractMatchedSize(order: any): number {
  const candidates = [
    order?.size_matched,
    order?.sizeMatched,
    order?.matched_size,
    order?.matchedSize,
    order?.filled_size,
    order?.filledSize,
    order?.filled,
  ];
  for (const c of candidates) {
    const n = typeof c === 'string' || typeof c === 'number' ? Number(c) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function extractOriginalSize(order: any): number {
  const candidates = [order?.size, order?.original_size, order?.originalSize];
  for (const c of candidates) {
    const n = typeof c === 'string' || typeof c === 'number' ? Number(c) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

// Debug/utility: check Polymarket CLOB order status for a recorded real bet
app.get('/api/real-bet/:id/order-status', authMiddleware, async (req, res) => {
  try {
    const betId = String((req.params as Record<string, unknown>)?.id ?? '').trim();
    if (!betId) {
      res.status(400).json({ error: 'Missing bet id' });
      return;
    }

    const bet = await prisma.virtualBet.findUnique({ where: { id: betId } });
    if (!bet || bet.userId !== req.user!.userId) {
      res.status(404).json({ error: 'Bet not found' });
      return;
    }
    const realBet = bet as any;
    if (!realBet.isReal || !realBet.clobOrderId) {
      res.status(400).json({ error: 'Bet is not a real bet or missing clobOrderId' });
      return;
    }
    console.log(realBet.clobOrderId);
    const order = await getPolymarketOrder(realBet.clobOrderId);
    const status = normalizeOrderStatus((order as any)?.status);
    const matchedSize = extractMatchedSize(order as any);
    const originalSize = extractOriginalSize(order as any);

    res.json({
      betId: bet.id,
      clobOrderId: realBet.clobOrderId,
      status,
      matchedSize,
      originalSize,
      order,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[real-bet/order-status] failed:', message);
    res.status(500).json({ error: message });
  }
});

// Real auto-sell: only sell after BUY is actually matched/filled.
app.post('/api/real-bet/:id/sell-from-shadow', authMiddleware, async (req, res) => {
  try {
    const betId = String((req.params as Record<string, unknown>)?.id ?? '').trim();
    const { price } = req.body as { price?: number };

    console.log('[real-bet/sell-from-shadow] incoming request', {
      betId,
      price,
      userId: req.user!.userId,
    });

    if (!betId) {
      res.status(400).json({ error: 'Missing bet id' });
      return;
    }
    if (!price || !Number.isFinite(price) || price <= 0 || price > 1.0001) {
      res.status(400).json({ error: 'Invalid price. Must be in (0, 1].' });
      return;
    }

    const bet = await prisma.virtualBet.findUnique({ where: { id: betId } });
    if (!bet || bet.userId !== req.user!.userId) {
      res.status(404).json({ error: 'Bet not found' });
      return;
    }
    const realBet = bet as any;
    if (!realBet.isReal) {
      console.warn('[real-bet/sell-from-shadow] bet is not marked as real', {
        betId,
      });
      res.status(400).json({ error: 'Bet is not a real bet' });
      return;
    }
    if (bet.status !== 'PENDING') {
      console.warn('[real-bet/sell-from-shadow] bet is not pending', {
        betId,
        status: bet.status,
      });
      res.status(400).json({ error: `Bet is not PENDING (current status: ${bet.status})` });
      return;
    }
    if (!realBet.clobOrderId || !realBet.clobTokenId || !realBet.clobShares || realBet.clobShares <= 0) {
      console.error('[real-bet/sell-from-shadow] missing clob info on bet', {
        betId,
        clobOrderId: realBet.clobOrderId,
        clobTokenId: realBet.clobTokenId,
        clobShares: realBet.clobShares,
      });
      res.status(400).json({ error: 'Missing clobOrderId/clobTokenId/clobShares for this real bet' });
      return;
    }

    const order = await getPolymarketOrder(realBet.clobOrderId);
    console.log('[real-bet/sell-from-shadow] order:', order);
    const status = normalizeOrderStatus((order as any)?.status);
    const matchedSize = extractMatchedSize(order as any);
    const originalSize = extractOriginalSize(order as any);

    // Consider "filled" when matched size reaches (almost) intended shares.
    const intended = realBet.clobShares as number;
    const fillRatio = intended > 0 ? matchedSize / intended : 0;
    const isFilledEnough =
      status === 'matched' ||
      status === 'filled' ||
      status === 'complete' ||
      status === 'completed' ||
      fillRatio >= 0.999;

    console.log('[real-bet/sell-from-shadow] fill check', {
      betId,
      status,
      matchedSize,
      originalSize,
      intendedShares: intended,
      fillRatio: fillRatio.toFixed(4),
      isFilledEnough,
    });

    if (!isFilledEnough) {
      console.log('[real-bet/sell-from-shadow] order not filled enough, skipping SELL', {
        betId,
        status,
        matchedSize,
        originalSize,
        intendedShares: intended,
        fillRatio: fillRatio.toFixed(4),
      });
      res.status(409).json({
        error: 'ORDER_NOT_FILLED',
        details: {
          status,
          matchedSize,
          originalSize,
          intendedShares: intended,
        },
      });
      return;
    }

    const sizeToSell = Math.min(matchedSize || intended, intended);
    console.log('[real-bet/sell-from-shadow] placing SELL order', {
      betId,
      tokenId: realBet.clobTokenId,
      price,
      sizeToSell,
      matchedSize,
      intendedShares: intended,
    });
    const result = await placePolymarketBet({
      tokenId: realBet.clobTokenId,
      price,
      size: sizeToSell,
      side: 'SELL',
    });

    console.log('[real-bet/sell-from-shadow] SELL order placed successfully', {
      betId,
      tokenId: realBet.clobTokenId,
      price,
      sizeToSell,
    });

    res.json({ success: true, order: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[real-bet/sell-from-shadow] failed:', message);
    res.status(500).json({ error: message });
  }
});

// ─── Prediction Routes ────────────────────────────────────────

app.get('/api/predict', authMiddleware, async (req, res) => {
  const symbol = (req.query.symbol as string | undefined)?.trim();

  if (!symbol) {
    res.status(400).json({ error: 'Missing required query parameter: symbol (e.g. ?symbol=BTC)' });
    return;
  }

  try {
    const { market, marketData, result } = await agent.predict(symbol);

    // Nếu không có kèo (NO_BET) thì không lưu vào database
    if (result.decision.direction === 'NO_BET') {
      res.json({
        symbol: symbol.toUpperCase(),
        timestamp: new Date().toISOString(),
        current_price: marketData[0]?.current_price ?? null,
        market: {
          market_slug: market.market_slug,
          question: market.question,
          outcomes: market.outcomes,
          outcomePrices: market.outcomePrices,
          clobTokenIds: market.clobTokenIds,
        },
        prediction: result.decision,
        reasoning: result.reasoning,
      });
      return;
    }

    const row = await prisma.prediction.create({
      data: {
        userId: req.user!.userId,
        symbol: symbol.toUpperCase(),
        currentPrice: marketData[0]?.current_price ?? null,
        marketSlug: market.market_slug,
        question: market.question,
        outcomes: market.outcomes,
        outcomePrices: market.outcomePrices,
        clobTokenIds: market.clobTokenIds,
        direction: result.decision.direction,
        sizeUsd: result.decision.size_usd,
        maxLossUsd: result.decision.max_loss_usd,
        edgeProb: result.decision.edge_prob,
        reasoning: result.reasoning,
      },
    });

    res.json(toHistoryResponse(row));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[predict] ${symbol} failed:`, message);
    res.status(500).json({ error: message });
  }
});

app.get('/api/predictions', authMiddleware, async (req, res) => {
  try {
    const marketSlug = (req.query.market_slug as string | undefined)?.trim();

    const where: Record<string, unknown> = { userId: req.user!.userId };
    if (marketSlug) where.marketSlug = marketSlug;

    const rows = await prisma.prediction.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: 200,
    });
    res.json(rows.map(toHistoryResponse));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[predictions] failed:', message);
    res.status(500).json({ error: message });
  }
});

app.post('/api/place-bet', async (req, res) => {
  try {
    const { tokenId, price, size, side } = req.body as {
      tokenId?: string;
      price?: number;
      size?: number;
      side?: 'BUY' | 'SELL';
    };

    if (!tokenId || price == null || size == null) {
      res.status(400).json({ error: 'Missing required fields: tokenId, price, size' });
      return;
    }

    const resolvedSide: 'BUY' | 'SELL' = side ?? 'BUY';

    // Interpret incoming BUY "size" as USD notional (Auto uses this endpoint)
    let finalSize = size;
    if (resolvedSide === 'BUY') {
      let usdNotional = size;

      const minUsdRaw = process.env.AUTO_MIN_BET_USD;
      const maxUsdRaw = process.env.AUTO_MAX_BET_USD;
      const minUsd = minUsdRaw != null && minUsdRaw !== '' ? Number(minUsdRaw) : 1;
      const maxUsd =
        maxUsdRaw != null && maxUsdRaw !== '' ? Number(maxUsdRaw) : Number.POSITIVE_INFINITY;

      if (!Number.isFinite(usdNotional) || usdNotional <= 0) {
        res.status(400).json({ error: 'Invalid size (USD) for BUY order' });
        return;
      }

      // Clamp USD notional vào [minUsd, maxUsd]
      if (Number.isFinite(minUsd) && usdNotional < minUsd) {
        usdNotional = minUsd;
      }
      if (Number.isFinite(maxUsd) && usdNotional > maxUsd) {
        usdNotional = maxUsd;
      }

      // Convert USD notional -> shares cho Polymarket CLOB
      finalSize = usdNotional / price;

      // Đảm bảo thỏa min shares của Polymarket
      if (Number.isFinite(POLY_MIN_SHARES) && finalSize < POLY_MIN_SHARES) {
        finalSize = POLY_MIN_SHARES;
      }
    }

    const result = await placePolymarketBet({
      tokenId,
      price,
      size: finalSize,
      side: resolvedSide,
    });

    res.json({ success: true, order: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[place-bet] failed:', message);
    res.status(500).json({ error: message });
  }
});

// Real position take-profit helper (server-side Polymarket order)
app.post('/api/real-bet/sell', async (req, res) => {
  try {
    const { tokenId, price, size } = req.body as {
      tokenId?: string;
      price?: number;
      size?: number;
    };

    console.log('[real-bet/sell] incoming request:', {
      tokenId,
      price,
      size,
    });

    if (!tokenId || price == null || size == null) {
      res.status(400).json({ error: 'Missing required fields: tokenId, price, size' });
      return;
    }

    const notional = price * size;
    if (notional < 1 || size < POLY_MIN_SHARES) {
      res.status(400).json({
        error: `Order too small for SELL: notional=$${notional.toFixed(
          2,
        )}, size=${size.toFixed(2)}. Minimum is $1 notional and ${POLY_MIN_SHARES} shares.`,
      });
      return;
    }
    console.log('[real-bet/sell] order placed successfully:', {
      tokenId,
      price,
      size,
      notional,
      side: 'SELL',
    });
    const result = await placePolymarketBet({
      tokenId,
      price,
      size,
      side: 'SELL',
    });

   

    res.json({ success: true, order: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[real-bet/sell] failed:', message);
    res.status(500).json({ error: message });
  }
});

// ─── Start Server ──────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Prediction API running on http://localhost:${PORT}`);
  console.log(`Try: GET http://localhost:${PORT}/api/predict?symbol=BTC`);
  startSettlementCron();
  startRealBetMonitorCron();
});
