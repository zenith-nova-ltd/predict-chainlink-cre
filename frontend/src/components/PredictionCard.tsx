import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { placeVirtualBet } from '../api/prediction';
import { useAuth } from '../context/AuthContext';
import type { PredictionResponse } from '../types';

const SESSION_DURATION_SEC = 900; // 15 min

const DIRECTION_STYLES = {
  UP: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', label: 'UP' },
  DOWN: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', label: 'DOWN' },
  NO_BET: { bg: 'bg-gray-500/10', border: 'border-gray-500/30', text: 'text-gray-400', label: 'NO BET' },
} as const;

const QUICK_AMOUNTS = [10, 25, 50, 100, 250, 500];

export default function PredictionCard({ data }: { data: PredictionResponse & { id?: string } }) {
  const { user, profile, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const [showReasoning, setShowReasoning] = useState(false);
  const dir = DIRECTION_STYLES[data.prediction.direction];

  const [betSide, setBetSide] = useState<'UP' | 'DOWN'>(
    data.prediction.direction === 'DOWN' ? 'DOWN' : 'UP',
  );
  const [betAmount, setBetAmount] = useState('');
  const [betSuccess, setBetSuccess] = useState<string | null>(null);
  const [betError, setBetError] = useState<string | null>(null);
  const [sessionCountdown, setSessionCountdown] = useState<number | null>(null);

  // Session end: from market_slug trailing timestamp (e.g. btc-updown-15m-1770690600) + 15 min, else timestamp + 15 min
  const sessionEndMs = (() => {
    const match = data.market.market_slug.match(/(\d+)$/);
    if (match) {
      const startSec = parseInt(match[1], 10);
      return (startSec + SESSION_DURATION_SEC) * 1000;
    }
    return new Date(data.timestamp).getTime() + SESSION_DURATION_SEC * 1000;
  })();

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((sessionEndMs - now) / 1000));
      setSessionCountdown(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sessionEndMs]);

  const upIndex = data.market.outcomes.findIndex((o) => o.toLowerCase() === 'up');
  const downIndex = data.market.outcomes.findIndex((o) => o.toLowerCase() === 'down');
  const selectedIndex = betSide === 'UP' ? upIndex : downIndex;
  const selectedPrice = data.market.outcomePrices[selectedIndex] ?? 0.5;

  const usdAmount = parseFloat(betAmount) || 0;
  const potentialPayout = selectedPrice > 0 ? usdAmount / selectedPrice : 0;
  const potentialProfit = potentialPayout - usdAmount;
  const balance = profile?.balance ?? user?.balance ?? 0;
  const predictionId = (data as { id?: string }).id;

  const betMutation = useMutation({
    mutationFn: placeVirtualBet,
    onSuccess: (result) => {
      setBetSuccess(
        `Bet placed! ${betSide} $${usdAmount.toFixed(2)} | Potential payout: $${result.potentialPayout.toFixed(2)}`,
      );
      setBetError(null);
      setBetAmount('');
      refreshProfile();
      queryClient.invalidateQueries({ queryKey: ['virtual-bets'] });
      queryClient.invalidateQueries({ queryKey: ['bet-summary'] });
    },
    onError: (err: Error) => {
      setBetError(err.message);
      setBetSuccess(null);
    },
  });

  const handlePlaceBet = () => {
    if (!predictionId || usdAmount <= 0 || !user) return;
    setBetSuccess(null);
    setBetError(null);
    betMutation.mutate({
      predictionId,
      direction: betSide,
      amount: usdAmount,
    });
  };

  const canBet = !!user && !!predictionId && usdAmount > 0 && usdAmount <= balance;

  return (
    <div className={`rounded-xl border ${dir.border} ${dir.bg} p-6 space-y-5`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`text-3xl font-bold ${dir.text}`}>{dir.label}</span>
          <span className="rounded-md bg-gray-800 px-3 py-1 text-sm font-medium">{data.symbol}</span>
        </div>
        <div className="flex items-center gap-6">
          {data.current_price != null && (
            <div className="text-right">
              <p className="text-xs text-gray-400">Current Price</p>
              <p className="text-lg font-semibold font-mono">
                ${data.current_price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
          )}
          {sessionCountdown !== null && (
            <div className="text-right">
              <p className="text-xs text-gray-400">Session ends</p>
              <p className="text-lg font-semibold font-mono">
                {sessionCountdown > 0
                  ? `${String(Math.floor(sessionCountdown / 60)).padStart(2, '0')}:${String(sessionCountdown % 60).padStart(2, '0')}`
                  : 'Ended'}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Edge Probability" value={`${(data.prediction.edge_prob * 100).toFixed(1)}%`} />
        <Stat label="Bet Size" value={`$${data.prediction.size_usd}`} />
        <Stat label="Max Loss" value={`$${data.prediction.max_loss_usd}`} />
        <Stat label="Time" value={new Date(data.timestamp).toLocaleTimeString()} />
      </div>

      <div className="flex gap-3">
        {data.market.outcomes.map((outcome, i) => (
          <div key={outcome} className="flex-1 rounded-lg bg-gray-800/60 px-4 py-3 text-center">
            <p className="text-xs text-gray-400 mb-1">{outcome}</p>
            <p className="text-sm font-semibold font-mono">
              {((data.market.outcomePrices[i] ?? 0) * 100).toFixed(1)}%
            </p>
          </div>
        ))}
      </div>

      {/* Virtual Bet Section */}
      <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
            Virtual Bet
          </h3>
          {user && (
            <span className="text-xs text-gray-400">
              Balance: <span className="text-emerald-400 font-mono font-semibold">${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </span>
          )}
        </div>

        {!user ? (
          <div className="text-center py-4">
            <p className="text-sm text-gray-400">Connect your wallet to place virtual bets</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setBetSide('UP')}
                className={`py-3 rounded-lg font-semibold text-sm transition-all ${
                  betSide === 'UP'
                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                UP {((data.market.outcomePrices[upIndex] ?? 0) * 100).toFixed(1)}%
              </button>
              <button
                type="button"
                onClick={() => setBetSide('DOWN')}
                className={`py-3 rounded-lg font-semibold text-sm transition-all ${
                  betSide === 'DOWN'
                    ? 'bg-red-500 text-white shadow-lg shadow-red-500/25'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                DOWN {((data.market.outcomePrices[downIndex] ?? 0) * 100).toFixed(1)}%
              </button>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Amount (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  className="w-full rounded-lg bg-gray-800 border border-gray-700 pl-7 pr-3 py-2.5 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                />
              </div>
              {usdAmount > balance && (
                <p className="text-xs text-red-400 mt-1">Insufficient balance</p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {QUICK_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setBetAmount(String(amt))}
                  disabled={amt > balance}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                    betAmount === String(amt)
                      ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40'
                      : amt > balance
                        ? 'bg-gray-800/50 text-gray-600 border border-gray-800 cursor-not-allowed'
                        : 'bg-gray-800 text-gray-400 border border-gray-700 hover:bg-gray-700'
                  }`}
                >
                  ${amt}
                </button>
              ))}
            </div>

            {usdAmount > 0 && usdAmount <= balance && (
              <div className="rounded-lg bg-gray-800/60 border border-gray-700/50 p-3 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Outcome Price</span>
                  <span className="text-white font-mono">{(selectedPrice * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Potential Payout</span>
                  <span className="text-emerald-400 font-mono font-semibold">
                    ${potentialPayout.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-xs border-t border-gray-700/50 pt-1.5">
                  <span className="text-gray-400">Potential Profit</span>
                  <span className={`font-mono font-semibold ${potentialProfit > 0 ? 'text-emerald-400' : 'text-gray-400'}`}>
                    +${potentialProfit.toFixed(2)} ({selectedPrice > 0 ? ((1 / selectedPrice - 1) * 100).toFixed(0) : 0}%)
                  </span>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handlePlaceBet}
              disabled={betMutation.isPending || !canBet}
              className={`w-full py-3 rounded-lg font-semibold text-sm transition-all ${
                !canBet
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : betSide === 'UP'
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-500/20 active:scale-[0.98]'
                    : 'bg-red-500 hover:bg-red-400 text-white shadow-lg shadow-red-500/20 active:scale-[0.98]'
              } ${betMutation.isPending ? 'opacity-60 cursor-wait' : ''}`}
            >
              {betMutation.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Placing virtual bet...
                </span>
              ) : canBet ? (
                `Virtual Bet ${betSide} — $${usdAmount.toFixed(2)}`
              ) : (
                'Enter amount'
              )}
            </button>

            {betSuccess && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-400">
                {betSuccess}
              </div>
            )}
            {betError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-400">
                {betError}
              </div>
            )}
          </>
        )}
      </div>

      <button
        onClick={() => setShowReasoning((v) => !v)}
        className="text-xs text-indigo-400 hover:text-indigo-300 transition flex items-center gap-1"
      >
        <svg
          className={`h-3.5 w-3.5 transition-transform ${showReasoning ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {showReasoning ? 'Hide' : 'Show'} AI Reasoning
      </button>

      {showReasoning && (
        <div className="rounded-lg bg-gray-900/80 border border-gray-800 p-4 text-sm text-gray-300 whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
          {data.reasoning}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-semibold font-mono">{value}</p>
    </div>
  );
}
