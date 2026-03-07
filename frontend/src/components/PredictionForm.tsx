import { useState } from 'react';

interface Props {
  onSubmit: (symbol: string) => void;
  isLoading: boolean;
  isAuto: boolean;
  onAutoToggle: (symbol: string | null) => void;
  countdown: number;
  disabled?: boolean;
}

const POPULAR_SYMBOLS = ['BTC', 'ETH', 'SOL'];

export default function PredictionForm({ onSubmit, isLoading, isAuto, onAutoToggle, countdown, disabled }: Props) {
  const [symbol, setSymbol] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isAuto || disabled) return;
    const trimmed = symbol.trim().toUpperCase();
    if (trimmed) onSubmit(trimmed);
  };

  const handleQuickPick = (s: string) => {
    if (isAuto || disabled) return;
    setSymbol(s);
  };

  const handleAutoClick = () => {
    if (disabled) return;
    if (isAuto) {
      onAutoToggle(null);
    } else {
      const trimmed = symbol.trim().toUpperCase();
      if (trimmed) onAutoToggle(trimmed);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-3">
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="Enter token symbol (e.g. BTC)"
          disabled={isLoading || isAuto || disabled}
          className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-sm
                     placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500
                     focus:border-transparent disabled:opacity-50 transition"
        />
        <button
          type="submit"
          disabled={isLoading || isAuto || disabled || !symbol.trim()}
          className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-medium
                     hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed
                     transition flex items-center gap-2"
        >
          {isLoading && !isAuto ? (
            <>
              <Spinner />
              Analyzing...
            </>
          ) : (
            'Predict'
          )}
        </button>
        <button
          type="button"
          onClick={handleAutoClick}
          disabled={disabled || (!isAuto && !symbol.trim())}
          className={`rounded-lg px-5 py-3 text-sm font-medium transition flex items-center gap-2
                     ${isAuto
                       ? 'bg-red-600 hover:bg-red-500 text-white'
                       : 'bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed'
                     }`}
        >
          {isAuto ? (
            <>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Stop
              {countdown > 0 && (
                <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-mono">
                  {countdown}s
                </span>
              )}
            </>
          ) : (
            <>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              Auto
            </>
          )}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {POPULAR_SYMBOLS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={isLoading || isAuto || disabled}
            onClick={() => handleQuickPick(s)}
            className="rounded-md border border-gray-700 bg-gray-800/50 px-3 py-1.5 text-xs
                       text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-40
                       transition"
          >
            {s}
          </button>
        ))}
      </div>
    </form>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
