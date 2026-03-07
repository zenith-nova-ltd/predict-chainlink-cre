import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { PolymarketUpDownAgent } from './polymarket/prediction.js';
import { placePolymarketBet } from './polymarket/placeBet.js';
import prisma from './lib/db.js';
import { authMiddleware, signToken } from './auth/middleware.js';
import { startSettlementCron } from './services/settlement.ts';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

const agent = new PolymarketUpDownAgent();

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
      clobTokenIds: (row.clobTokenIds as string[]) ?? [],
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
    if (!address || !ethers.isAddress(address)) {
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
    const recoveredAddress = ethers.verifyMessage(message, signature).toLowerCase();

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

app.get('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const bets = await prisma.virtualBet.findMany({ where: { userId: user.id } });
    const totalBets = bets.length;
    const settledBets = bets.filter((b) => b.status === 'WON' || b.status === 'LOST');
    const wonBets = bets.filter((b) => b.status === 'WON').length;
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

app.get('/api/virtual-bets', authMiddleware, async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
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
      bets.map((b) => ({
        id: b.id,
        marketSlug: b.marketSlug,
        direction: b.direction,
        amount: b.amount,
        outcomePrice: b.outcomePrice,
        potentialPayout: Math.round(b.potentialPayout * 100) / 100,
        status: b.status,
        pnl: b.pnl != null ? Math.round(b.pnl * 100) / 100 : null,
        settledAt: b.settledAt?.toISOString() ?? null,
        createdAt: b.createdAt.toISOString(),
        prediction: b.prediction,
      })),
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
    const pendingBets = bets.filter((b) => b.status === 'PENDING').length;
    const settledBets = bets.filter((b) => b.status === 'WON' || b.status === 'LOST');
    const wonBets = settledBets.filter((b) => b.status === 'WON').length;
    const totalPnl = settledBets.reduce((sum, b) => sum + (b.pnl ?? 0), 0);
    const winRate = settledBets.length > 0 ? wonBets / settledBets.length : 0;

    res.json({
      balance: user.balance,
      totalBets,
      pendingBets,
      settledBets: settledBets.length,
      wonBets,
      lostBets: settledBets.length - wonBets,
      totalPnl: Math.round(totalPnl * 100) / 100,
      winRate: Math.round(winRate * 1000) / 10,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[virtual-bets/summary] failed:', message);
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

    const result = await placePolymarketBet({
      tokenId,
      price,
      size,
      side: side ?? 'BUY',
    });

    res.json({ success: true, order: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[place-bet] failed:', message);
    res.status(500).json({ error: message });
  }
});

// ─── Start Server ──────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Prediction API running on http://localhost:${PORT}`);
  console.log(`Try: GET http://localhost:${PORT}/api/predict?symbol=BTC`);
  startSettlementCron();
});
