import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPredictionHistory } from '../api/prediction';
import { useAuth } from '../context/AuthContext';
import type { PredictionHistoryEntry } from '../types';

const DIR_BADGE = {
  UP: 'bg-emerald-500/15 text-emerald-400',
  DOWN: 'bg-red-500/15 text-red-400',
  NO_BET: 'bg-gray-500/15 text-gray-400',
} as const;

interface MarketGroup {
  slug: string;
  question: string;
  symbol: string;
  entries: PredictionHistoryEntry[];
  latestTimestamp: string;
}

function groupByMarketSlug(entries: PredictionHistoryEntry[]): MarketGroup[] {
  const map = new Map<string, MarketGroup>();

  for (const entry of entries) {
    const slug = entry.market.market_slug;
    const existing = map.get(slug);
    if (existing) {
      existing.entries.push(entry);
      if (entry.timestamp > existing.latestTimestamp) {
        existing.latestTimestamp = entry.timestamp;
      }
    } else {
      map.set(slug, {
        slug,
        question: entry.market.question,
        symbol: entry.symbol,
        entries: [entry],
        latestTimestamp: entry.timestamp,
      });
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime(),
  );
}

function formatSlugShort(slug: string): string {
  const match = slug.match(/(\d+)$/);
  if (!match) return slug;
  const ts = parseInt(match[0], 10);
  const d = new Date(ts * 1000);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const endTime = new Date((ts + 900) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${time} - ${endTime}`;
}

const PAGE_SIZE = 10;

export default function PredictionHistory() {
  const { user } = useAuth();

  const { data: history, isLoading } = useQuery({
    queryKey: ['prediction-history', user?.id],
    queryFn: fetchPredictionHistory,
    refetchInterval: 15_000,
    enabled: !!user,
  });

  const groups = useMemo(
    () => (history ? groupByMarketSlug(history) : []),
    [history],
  );

  const [expandedSlugs, setExpandedSlugs] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);

  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedGroups = groups.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const latestSlug = groups[0]?.slug;

  const isExpanded = (slug: string) =>
    slug === latestSlug || expandedSlugs.has(slug);

  const toggleSlug = (slug: string) => {
    setExpandedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="text-center text-gray-500 py-8 text-sm">Loading history...</div>
    );
  }

  if (!user) {
    return (
      <div className="text-center text-gray-500 py-8 text-sm">
        Connect your wallet to see your prediction history.
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8 text-sm">
        No predictions yet. Enter a symbol above to get started.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          Prediction History
        </h2>
        <span className="text-xs text-gray-500">
          {groups.length} market{groups.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-3">
        {pagedGroups.map((group) => {
          const expanded = isExpanded(group.slug);
          const isLatest = group.slug === latestSlug;

          return (
            <div
              key={group.slug}
              className={`rounded-xl border overflow-hidden transition ${
                isLatest ? 'border-indigo-500/30' : 'border-gray-800'
              }`}
            >
              {/* Group header */}
              <button
                type="button"
                onClick={() => toggleSlug(group.slug)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-gray-900/60 hover:bg-gray-800/60 transition text-left"
              >
                <svg
                  className={`h-3.5 w-3.5 text-gray-400 transition-transform flex-shrink-0 ${
                    expanded ? 'rotate-90' : ''
                  }`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="rounded-md bg-gray-800 px-2 py-0.5 text-xs font-semibold">
                      {group.symbol}
                    </span>
                    <span className="text-xs text-gray-400 font-mono">
                      {formatSlugShort(group.slug)}
                    </span>
                    {isLatest && (
                      <span className="rounded-full bg-indigo-500/20 text-indigo-400 px-2 py-0.5 text-[10px] font-semibold uppercase">
                        Current
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1 truncate">{group.question}</p>
                </div>

                <span className="text-xs text-gray-500 whitespace-nowrap flex-shrink-0">
                  {group.entries.length} prediction{group.entries.length !== 1 ? 's' : ''}
                </span>
              </button>

              {/* Group content */}
              {expanded && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-t border-gray-800 bg-gray-900/30 text-xs text-gray-400 uppercase tracking-wider">
                        <th className="px-4 py-2.5 text-left">Time</th>
                        <th className="px-4 py-2.5 text-left">Direction</th>
                        <th className="px-4 py-2.5 text-right">Price</th>
                        <th className="px-4 py-2.5 text-right">Edge</th>
                        <th className="px-4 py-2.5 text-right">Bet Size</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/40">
                      {group.entries.map((entry) => (
                        <tr key={entry.id} className="hover:bg-gray-800/20 transition-colors">
                          <td className="px-4 py-2.5 text-gray-400 font-mono text-xs whitespace-nowrap">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-block rounded-md px-2.5 py-0.5 text-xs font-semibold ${DIR_BADGE[entry.prediction.direction]}`}>
                              {entry.prediction.direction}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono">
                            {entry.current_price != null
                              ? `$${entry.current_price.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                              : '-'}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono">
                            {(entry.prediction.edge_prob * 100).toFixed(1)}%
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono">
                            ${entry.prediction.size_usd}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1.5 pt-2">
          <button
            type="button"
            onClick={() => setPage(0)}
            disabled={safePage === 0}
            className="px-2 py-1.5 rounded-md text-xs text-gray-400 hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="px-2 py-1.5 rounded-md text-xs text-gray-400 hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {Array.from({ length: totalPages }, (_, i) => i)
            .filter((i) => i === 0 || i === totalPages - 1 || Math.abs(i - safePage) <= 1)
            .reduce<(number | 'ellipsis')[]>((acc, i, idx, arr) => {
              if (idx > 0 && arr[idx - 1] !== undefined && i - (arr[idx - 1] as number) > 1) {
                acc.push('ellipsis');
              }
              acc.push(i);
              return acc;
            }, [])
            .map((item, idx) =>
              item === 'ellipsis' ? (
                <span key={`e-${idx}`} className="px-1 text-xs text-gray-600">...</span>
              ) : (
                <button
                  key={item}
                  type="button"
                  onClick={() => setPage(item)}
                  className={`min-w-[28px] py-1.5 rounded-md text-xs font-medium transition ${
                    item === safePage
                      ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40'
                      : 'text-gray-400 hover:bg-gray-800'
                  }`}
                >
                  {item + 1}
                </button>
              ),
            )}

          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            className="px-2 py-1.5 rounded-md text-xs text-gray-400 hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setPage(totalPages - 1)}
            disabled={safePage >= totalPages - 1}
            className="px-2 py-1.5 rounded-md text-xs text-gray-400 hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
