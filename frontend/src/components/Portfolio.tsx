import { type ReactNode, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getVirtualBets, getBetSummary } from '../api/prediction';
import { useAuth } from '../context/AuthContext';

const STATUS_BADGE = {
  PENDING: 'bg-yellow-500/15 text-yellow-400',
  WON: 'bg-emerald-500/15 text-emerald-400',
  LOST: 'bg-red-500/15 text-red-400',
  CANCELLED: 'bg-gray-500/15 text-gray-400',
} as const;

const PAGE_SIZE = 10;

export default function Portfolio() {
  const { user } = useAuth();

  const { data: summary } = useQuery({
    queryKey: ['bet-summary'],
    queryFn: getBetSummary,
    enabled: !!user,
    refetchInterval: 15_000,
  });

  const { data: bets, isLoading } = useQuery({
    queryKey: ['virtual-bets'],
    queryFn: () => getVirtualBets(),
    enabled: !!user,
    refetchInterval: 15_000,
  });

  const [page, setPage] = useState(1);

  const totalBets = bets?.length ?? 0;
  const totalPages = totalBets > 0 ? Math.ceil(totalBets / PAGE_SIZE) : 1;
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const visibleBets = bets ? bets.slice(startIndex, endIndex) : [];

  useEffect(() => {
    setPage(1);
  }, [totalBets]);

  if (!user) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
        Portfolio
      </h2>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard
            label="Balance"
            value={`$${summary.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            color="text-white"
          />
          <SummaryCard
            label="Total P&L"
            value={`${summary.totalPnl >= 0 ? '+' : ''}$${summary.totalPnl.toFixed(2)}`}
            color={summary.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
          />
          <SummaryCard
            label="Win Rate"
            value={summary.settledBets > 0 ? `${summary.winRate}%` : '-'}
            color="text-indigo-400"
          />
          <SummaryCard
            label="Bets"
            value={
              <span className="space-x-1">
                <span className="text-emerald-400 font-semibold">
                  {summary.wonBets} WIN
                </span>
                <span className="text-gray-500">/</span>
                <span className="text-red-400 font-semibold">
                  {summary.lostBets} LOST
                </span>
                <span className="text-gray-500">/</span>
                <span className="text-yellow-400 font-semibold">
                  {summary.pendingBets} PENDING
                </span>
              </span>
            }
            color="text-gray-300"
          />
        </div>
      )}

      {/* Bets Table */}
      {isLoading ? (
        <div className="text-center text-gray-500 py-6 text-sm">Loading bets...</div>
      ) : !bets || bets.length === 0 ? (
        <div className="text-center text-gray-500 py-6 text-sm">
          No virtual bets yet. Make a prediction and place your first bet!
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-900/60 text-xs text-gray-400 uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Time</th>
                  <th className="px-4 py-3 text-left">Symbol</th>
                  <th className="px-4 py-3 text-left">Direction</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Edge</th>
                  <th className="px-4 py-3 text-right">Payout</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/40">
                {visibleBets.map((bet) => (
                  <tr key={bet.id} className="hover:bg-gray-800/20 transition-colors">
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs whitespace-nowrap">
                      {new Date(bet.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-gray-800 px-2 py-0.5 text-xs font-semibold">
                        {bet.prediction.symbol}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-md px-2.5 py-0.5 text-xs font-semibold ${
                          bet.direction === 'UP'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-red-500/15 text-red-400'
                        }`}
                      >
                        {bet.direction}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-white">
                      ${bet.amount.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-400">
                      {bet.prediction.edgeProb != null
                        ? `${(bet.prediction.edgeProb * 100).toFixed(1)}%`
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-300">
                      ${bet.potentialPayout.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block rounded-md px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[bet.status]}`}
                      >
                        {bet.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">
                      {bet.pnl != null ? (
                        <span className={bet.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {bet.pnl >= 0 ? '+' : ''}${bet.pnl.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-800 bg-gray-900/60 text-xs text-gray-400">
            <div>
              Showing{' '}
              <span className="font-mono text-gray-200">
                {totalBets === 0 ? 0 : startIndex + 1}-{totalBets === 0 ? 0 : Math.min(endIndex, totalBets)}
              </span>{' '}
              of <span className="font-mono text-gray-200">{totalBets}</span> bets
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-2 py-1 rounded border border-gray-700 bg-gray-900/80 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800/80 transition-colors"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
              >
                Prev
              </button>
              <span className="font-mono">
                Page {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                className="px-2 py-1 rounded border border-gray-700 bg-gray-900/80 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800/80 transition-colors"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages || totalBets === 0}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: ReactNode;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-lg font-semibold font-mono ${color}`}>{value}</p>
    </div>
  );
}
