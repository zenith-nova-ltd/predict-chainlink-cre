import { useState, useRef, useCallback, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchPrediction, placeVirtualBet, placeBet, registerRealBet } from './api/prediction';
import { useAuth } from './context/AuthContext';
import type { PredictionResponse } from './types';
import Layout from './components/Layout';
import PredictionForm from './components/PredictionForm';
import PredictionCard from './components/PredictionCard';
import PredictionHistory from './components/PredictionHistory';
import AutoStatus from './components/AutoStatus';
import Portfolio from './components/Portfolio';

const AUTO_INTERVAL_MS = 30_000;

type BetMode = 'VIRTUAL' | 'REAL';

export interface AutoBetLog {
  direction: string;
  amount: number;
  success: boolean;
  message: string;
  timestamp: number;
}

export default function App() {
  const queryClient = useQueryClient();
  const { user, profile, refreshProfile } = useAuth();
  const [lastResult, setLastResult] = useState<(PredictionResponse & { id?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAutoBet, setLastAutoBet] = useState<AutoBetLog | null>(null);
  const [betMode, setBetMode] = useState<BetMode>('VIRTUAL');

  const [autoSymbol, setAutoSymbol] = useState<string | null>(null);
  const [autoCount, setAutoCount] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const autoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPendingRef = useRef(false);
  const autoSymbolRef = useRef<string | null>(null);

  useEffect(() => {
    autoSymbolRef.current = autoSymbol;
  }, [autoSymbol]);

  const betModeRef = useRef<BetMode>('VIRTUAL');
  useEffect(() => {
    betModeRef.current = betMode;
  }, [betMode]);

  async function placeRealOrderFromPrediction(
    data: PredictionResponse & { id?: string },
    sizeUsd: number,
    direction: 'UP' | 'DOWN' | 'NO_BET',
  ) {
    const { market } = data;
    const label = direction.toLowerCase();

    const outcomes = market.outcomes ?? [];
    const idx = outcomes.findIndex((o) => o.toLowerCase() === label);
    if (idx === -1) {
      throw new Error(`Cannot map direction ${direction} to Polymarket outcome`);
    }

    const rawTokenIds = (market as any).clobTokenIds;
    const clobTokenIds: string[] = (() => {
      if (Array.isArray(rawTokenIds)) return rawTokenIds.map(String);
      if (typeof rawTokenIds === 'string') {
        const s = rawTokenIds.trim();
        if (!s) return [];
        if (s.startsWith('[') && s.endsWith(']')) {
          try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed)) return parsed.map(String);
          } catch {
            // fall through
          }
        }
        return [s];
      }
      return [];
    })();

    const tokenId = clobTokenIds[idx];
    const price = (market.outcomePrices ?? [])[idx];

    if (!tokenId || !price) {
      throw new Error('Missing tokenId or price for selected outcome');
    }

    const side: 'BUY' | 'SELL' = 'BUY';

    // Backend expects BUY "size" as USD notional (and converts to shares).
    const shares = sizeUsd / price;
    const res = await placeBet({ tokenId, price, size: sizeUsd, side });
    if (!res.success) {
      throw new Error(res.error || 'On-chain order failed');
    }

    const rawOrder: any = (res as any).order;
    const clobOrderId: string | undefined =
      (rawOrder?.orderID as string | undefined) ??
      (rawOrder?.orderId as string | undefined) ??
      (rawOrder?.id as string | undefined);

    // Also register a shadow virtual bet so auto-sell can track entryPrice.
    const predictionId = data.id;
    if (predictionId && direction !== 'NO_BET') {
      try {
        await registerRealBet({
          predictionId,
          direction: direction as 'UP' | 'DOWN',
          amount: sizeUsd,
          clobOrderId,
          clobTokenId: tokenId,
          clobShares: shares,
        });
      } catch (err) {
        // Do not fail the real order if registration fails; just log.
        // eslint-disable-next-line no-console
        console.error('[real-bet] register shadow virtual bet failed', err);
      }
    }

    setLastAutoBet({
      direction,
      amount: sizeUsd,
      success: true,
      message: `REAL ORDER: ${direction} ~$${sizeUsd.toFixed(2)} at price ${price.toFixed(
        4,
      )} (size ${shares.toFixed(4)} shares)`,
      timestamp: Date.now(),
    });
  }

  const tryAutoBet = useCallback(
    async (data: PredictionResponse & { id?: string }) => {
      if (!autoSymbolRef.current || !user) return;

      const { direction, size_usd } = data.prediction;
      const predictionId = data.id;

      if (!predictionId || direction === 'NO_BET') {
        setLastAutoBet({
          direction,
          amount: 0,
          success: false,
          message: direction === 'NO_BET' ? 'AI chose NO_BET — skipped' : 'Missing prediction ID',
          timestamp: Date.now(),
        });
        return;
      }

      const balance = profile?.balance ?? user.balance;
      try {
        if (betModeRef.current === 'VIRTUAL') {
          if (balance < size_usd) {
            setLastAutoBet({
              direction,
              amount: size_usd,
              success: false,
              message: `Insufficient balance ($${balance.toFixed(2)} < $${size_usd})`,
              timestamp: Date.now(),
            });
            return;
          }

          const result = await placeVirtualBet({
            predictionId,
            direction: direction as 'UP' | 'DOWN',
            amount: size_usd,
          });
          setLastAutoBet({
            direction,
            amount: size_usd,
            success: true,
            message: `${direction} $${size_usd} — payout $${result.potentialPayout.toFixed(2)}`,
            timestamp: Date.now(),
          });
          refreshProfile();
          queryClient.invalidateQueries({ queryKey: ['virtual-bets'] });
          queryClient.invalidateQueries({ queryKey: ['bet-summary'] });
        } else {
          await placeRealOrderFromPrediction(data, size_usd, direction);
        }
      } catch (err) {
        setLastAutoBet({
          direction,
          amount: size_usd,
          success: false,
          message: err instanceof Error ? err.message : 'Bet failed',
          timestamp: Date.now(),
        });
      }
    },
    [user, profile, refreshProfile, queryClient],
  );

  const mutation = useMutation({
    mutationFn: fetchPrediction,
    onSuccess: (data) => {
      const result = data as PredictionResponse & { id?: string };
      setLastResult(result);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['prediction-history'] });
      if (autoSymbolRef.current) {
        setAutoCount((c) => c + 1);
        tryAutoBet(result);
      }
    },
    onError: (err: Error) => {
      setError(err.message);
    },
    onSettled: () => {
      isPendingRef.current = false;
    },
  });

  const runPredict = useCallback(
    (symbol: string) => {
      if (isPendingRef.current) return;
      isPendingRef.current = true;
      setError(null);
      mutation.mutate(symbol);
    },
    [mutation],
  );

  const startCountdown = useCallback(() => {
    setCountdown(AUTO_INTERVAL_MS / 1000);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
  }, []);

  const stopAuto = useCallback(() => {
    if (autoIntervalRef.current) {
      clearInterval(autoIntervalRef.current);
      autoIntervalRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setAutoSymbol(null);
    setAutoCount(0);
    setCountdown(0);
    setLastAutoBet(null);
  }, []);

  const startAuto = useCallback(
    (symbol: string) => {
      stopAuto();
      setAutoSymbol(symbol);
      setAutoCount(0);
      runPredict(symbol);
      startCountdown();

      autoIntervalRef.current = setInterval(() => {
        runPredict(symbol);
        startCountdown();
      }, AUTO_INTERVAL_MS);
    },
    [runPredict, stopAuto, startCountdown],
  );

  useEffect(() => {
    return () => {
      if (autoIntervalRef.current) clearInterval(autoIntervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const handlePredict = (symbol: string) => {
    if (autoSymbol || !user) return;
    runPredict(symbol);
  };

  const handleAutoToggle = (symbol: string | null) => {
    if (!user) return;
    if (symbol) {
      startAuto(symbol);
    } else {
      stopAuto();
    }
  };

  const isAutoRunning = autoSymbol !== null;

  return (
    <Layout>
      <section className="space-y-6">
        <div className="flex items-center justify-end gap-2 text-xs text-gray-300">
          <span className="mr-1">Bet mode:</span>
          <button
            type="button"
            onClick={() => setBetMode('VIRTUAL')}
            className={`rounded-full px-3 py-1 border text-xs ${
              betMode === 'VIRTUAL'
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500'
            }`}
          >
            Virtual
          </button>
          <button
            type="button"
            onClick={() => setBetMode('REAL')}
            className={`rounded-full px-3 py-1 border text-xs ${
              betMode === 'REAL'
                ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500'
            }`}
          >
            Real
          </button>
        </div>

        <PredictionForm
          onSubmit={handlePredict}
          isLoading={mutation.isPending}
          isAuto={isAutoRunning}
          onAutoToggle={handleAutoToggle}
          countdown={countdown}
          disabled={!user}
        />

        {!user && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400 text-center">
            Connect your wallet to start making predictions
          </div>
        )}

        {isAutoRunning && (
          <AutoStatus
            symbol={autoSymbol}
            countdown={countdown}
            predictCount={autoCount}
            isLoading={mutation.isPending}
            lastAutoBet={lastAutoBet}
          />
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {mutation.isPending && (
          <div className="flex items-center justify-center gap-3 py-4 text-gray-400">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-sm">Fetching indicators & running AI analysis... this may take 15-30s</span>
          </div>
        )}

        {lastResult && <PredictionCard data={lastResult} betMode={betMode} />}
      </section>

      <Portfolio />

      <PredictionHistory />
    </Layout>
  );
}
