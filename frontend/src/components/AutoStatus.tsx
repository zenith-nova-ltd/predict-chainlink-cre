import { useMemo } from 'react';
import type { AutoBetLog } from '../App';

interface Props {
  symbol: string;
  countdown: number;
  predictCount: number;
  isLoading: boolean;
  lastAutoBet: AutoBetLog | null;
}

function getMarketWindow() {
  const FIFTEEN_MINUTES = 15 * 60;
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSec / FIFTEEN_MINUTES) * FIFTEEN_MINUTES;
  const windowEnd = windowStart + FIFTEEN_MINUTES;
  const remaining = windowEnd - nowSec;
  return {
    start: new Date(windowStart * 1000),
    end: new Date(windowEnd * 1000),
    remainingSec: Math.max(0, remaining),
  };
}

export default function AutoStatus({ symbol, countdown, predictCount, isLoading, lastAutoBet }: Props) {
  const market = useMemo(getMarketWindow, [countdown]);

  const fmt = (d: Date) =>
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const remainMin = Math.floor(market.remainingSec / 60);
  const remainSec = market.remainingSec % 60;

  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="text-sm font-medium text-gray-200">
            Auto-Predict + Bet
          </span>
        </div>
        <span className="rounded-md bg-gray-800 px-2.5 py-1 text-xs font-semibold">
          {symbol}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
        <StatusItem
          label="Next predict"
          value={isLoading ? 'Running...' : `${countdown}s`}
        />
        <StatusItem
          label="Market window"
          value={`${fmt(market.start)} - ${fmt(market.end)}`}
        />
        <StatusItem
          label="Window closes in"
          value={`${remainMin}m ${remainSec.toString().padStart(2, '0')}s`}
        />
        <StatusItem
          label="Predictions"
          value={String(predictCount)}
        />
      </div>

      {lastAutoBet && (
        <div
          className={`rounded-lg px-4 py-2.5 text-xs flex items-center gap-2 ${
            lastAutoBet.success
              ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border border-yellow-500/30 bg-yellow-500/10 text-yellow-400'
          }`}
        >
          <span className="font-semibold">
            {lastAutoBet.success ? 'Auto-bet:' : 'Skipped:'}
          </span>
          <span>{lastAutoBet.message}</span>
        </div>
      )}
    </div>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-semibold font-mono text-gray-200">{value}</p>
    </div>
  );
}
