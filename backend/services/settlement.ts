import cron from 'node-cron';
import prisma from '../lib/db.js';
import { fetchBtcUpDownMarkets } from '../polymarket/polymarketAPI.js';

async function settlePendingBets() {
  const pendingBets = await prisma.virtualBet.findMany({
    where: { status: 'PENDING' },
    include: { prediction: true },
  });
  
  if (pendingBets.length === 0) return;

  const slugGroups = new Map<string, typeof pendingBets>();
  for (const bet of pendingBets) {
    const group = slugGroups.get(bet.marketSlug) ?? [];
    group.push(bet);
    slugGroups.set(bet.marketSlug, group);
  }

  for (const [slug, bets] of slugGroups) {
    try {
      const markets = await fetchBtcUpDownMarkets({ slug });
      if (markets.length === 0) continue;

      const market = markets[0]!;

      if (!market.closed) continue;

      const upOutcome = market.outcomes.find((o) => o.label.toLowerCase() === 'up');
      const downOutcome = market.outcomes.find((o) => o.label.toLowerCase() === 'down');

      if (!upOutcome || !downOutcome) continue;

      const winningDirection = upOutcome.price > downOutcome.price ? 'UP' : 'DOWN';
      console.log(`[settlement] Market ${slug} resolved: ${winningDirection}`);

      for (const bet of bets) {
        const won = bet.direction === winningDirection;
        const pnl = won ? bet.potentialPayout - bet.amount : -bet.amount;

        await prisma.$transaction(async (tx) => {
          // Chỉ settle khi bet vẫn đang PENDING để tránh double-settlement
          const { count } = await tx.virtualBet.updateMany({
            where: { id: bet.id, status: 'PENDING' },
            data: {
              status: won ? 'WON' : 'LOST',
              pnl,
              settledAt: new Date(),
            },
          });

          if (count === 0) {
            // Bet đã được settle ở transaction khác
            console.log(`[settlement] Bet ${bet.id} already settled elsewhere; skipping balance update`);
            return;
          }

          if (won) {
            const updatedUser = await tx.user.update({
              where: { id: bet.userId },
              data: { balance: { increment: bet.potentialPayout } },
              select: { id: true, balance: true },
            });

            console.log(
              `[balance] User ${updatedUser.id} credited $${bet.potentialPayout.toFixed(
                2,
              )} from bet ${bet.id}. New balance: $${updatedUser.balance.toFixed(2)}`,
            );
          }
        });

        console.log(
          `[settlement] Bet ${bet.id}: ${won ? 'WON' : 'LOST'} | PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
        );
      }
    } catch (err) {
      console.error(`[settlement] Error settling slug ${slug}:`, err instanceof Error ? err.message : err);
    }
  }
}

export function startSettlementCron() {
  console.log('[settlement] Starting settlement cron (every 60s)');
  cron.schedule('* * * * *', async () => {
    try {
      await settlePendingBets();
    } catch (err) {
      console.error('[settlement] Cron error:', err instanceof Error ? err.message : err);
    }
  });
}
