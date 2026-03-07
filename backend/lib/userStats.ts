interface BetLike {
  status: string;
  pnl?: number | null;
}

export interface BetStats {
  totalBets: number;
  pendingBets: number;
  settledCount: number;
  wonBets: number;
  lostBets: number;
  totalPnl: number;
  winRate: number;
}

export function computeBetStats(bets: BetLike[]): BetStats {
  const totalBets = bets.length;
  const pendingBets = bets.filter((b) => b.status === 'PENDING').length;
  const settled = bets.filter((b) => b.status === 'WON' || b.status === 'LOST');
  const wonBets = settled.filter((b) => b.status === 'WON').length;
  const lostBets = settled.length - wonBets;
  const totalPnl = settled.reduce((sum, b) => sum + (b.pnl ?? 0), 0);
  const winRate = settled.length > 0 ? wonBets / settled.length : 0;

  return {
    totalBets,
    pendingBets,
    settledCount: settled.length,
    wonBets,
    lostBets,
    totalPnl: Math.round(totalPnl * 100) / 100,
    winRate: Math.round(winRate * 1000) / 10,
  };
}
