import { useState, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getVirtualBets, placeVirtualBet, sellVirtualBet, sellRealBetFromShadow } from '../api/prediction';
import { useAuth } from '../context/AuthContext';
import type { PredictionResponse } from '../types';

const SESSION_DURATION_SEC = 900; // 15 min
const POLYMARKET_CLOB_MARKET_WS = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

const DIRECTION_STYLES = {
  UP: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', label: 'UP' },
  DOWN: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', label: 'DOWN' },
  NO_BET: { bg: 'bg-gray-500/10', border: 'border-gray-500/30', text: 'text-gray-400', label: 'NO BET' },
} as const;

const QUICK_AMOUNTS = [10, 25, 50, 100, 250, 500];

type BetMode = 'VIRTUAL' | 'REAL';

export default function PredictionCard({
  data,
  betMode = 'VIRTUAL',
}: {
  data: PredictionResponse & { id?: string };
  betMode?: BetMode;
}) {
  const { user, profile, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const [showReasoning, setShowReasoning] = useState(false);
  const [wsEnabled, setWsEnabled] = useState(true);
  const dir = DIRECTION_STYLES[data.prediction.direction];

  const [betSide, setBetSide] = useState<'UP' | 'DOWN'>(
    data.prediction.direction === 'DOWN' ? 'DOWN' : 'UP',
  );
  const [betAmount, setBetAmount] = useState('');
  const [betSuccess, setBetSuccess] = useState<string | null>(null);
  const [betError, setBetError] = useState<string | null>(null);
  const [sessionCountdown, setSessionCountdown] = useState<number | null>(null);

  const marketKey = data.market.market_slug;
  const clobTokenIds = useMemo(() => {
    const raw = (data.market as any).clobTokenIds;
    if (Array.isArray(raw)) return raw as string[];

    if (typeof raw === 'string') {
      const s = raw.trim();
      if (!s) return [] as string[];

      // Sometimes backend sends JSON-encoded array string like '["id1","id2"]'
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

    return [] as string[];
  }, [data.market]);
  const tokenIdsKey = useMemo(() => clobTokenIds.join('|'), [clobTokenIds]);

  const [liveOutcomePrices, setLiveOutcomePrices] = useState<number[]>(() => data.market.outcomePrices ?? []);

  // Reset displayed prices when switching markets
  useEffect(() => {
    setLiveOutcomePrices(data.market.outcomePrices ?? []);
  }, [marketKey]);

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
  const selectedPrice = liveOutcomePrices[selectedIndex] ?? data.market.outcomePrices[selectedIndex] ?? 0.5;

  const usdAmount = parseFloat(betAmount) || 0;
  const potentialPayout = selectedPrice > 0 ? usdAmount / selectedPrice : 0;
  const potentialProfit = potentialPayout - usdAmount;
  const balance = profile?.balance ?? user?.balance ?? 0;
  const predictionId = (data as { id?: string }).id;

  // Real-time outcome prices via Polymarket CLOB WebSocket (browser-safe)
  useEffect(() => {
    if (!wsEnabled) return;
    if (!clobTokenIds.length) return;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let pingTimer: number | undefined;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;

    const safeClearTimers = () => {
      if (pingTimer != null) window.clearInterval(pingTimer);
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      pingTimer = undefined;
      reconnectTimer = undefined;
    };

    const updatePriceForAsset = (assetId: string, price: number) => {
      const idx = clobTokenIds.indexOf(assetId);
      console.log('[WS] updatePriceForAsset', {
        assetId,
        idx,
        price,
        clobTokenIds,
      });
      if (idx < 0) return;
      if (!Number.isFinite(price) || price <= 0 || price > 1.0001) return;

      setLiveOutcomePrices((prev) => {
        const base = prev.length ? prev : (data.market.outcomePrices ?? []);
        const next = base.slice();
        const prevPrice = next[idx];
        if (prevPrice != null && Math.abs(prevPrice - price) < 1e-6) return prev;
        next[idx] = price;
        return next;
      });
    };

    const readWsPayloadAsText = async (payload: unknown): Promise<string | null> => {
      if (typeof payload === 'string') return payload;
      if (payload instanceof Blob) return await payload.text();
      if (payload instanceof ArrayBuffer) return new TextDecoder().decode(payload);
      if (ArrayBuffer.isView(payload)) return new TextDecoder().decode(payload.buffer);
      return null;
    };

    const connect = () => {
      if (cancelled) return;

      console.log('[WS] Opening connection', {
        url: POLYMARKET_CLOB_MARKET_WS,
        assets_ids: clobTokenIds,
        market_slug: data.market.market_slug,
      });

      ws = new WebSocket(POLYMARKET_CLOB_MARKET_WS);

      ws.onopen = () => {
        if (cancelled || !ws) return;
        reconnectAttempt = 0;
        const subscribePayload = {
          assets_ids: clobTokenIds,
          type: 'market',
          custom_feature_enabled: false,
          initial_dump: true,
          level: 2,
        } as const;

        console.log('[WS] OPEN, sending subscribe', subscribePayload);

        ws.send(JSON.stringify(subscribePayload));

        safeClearTimers();
        pingTimer = window.setInterval(() => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          ws.send('PING');
        }, 10_000);
      };

      ws.onmessage = (evt) => {
        void (async () => {
          if (cancelled) return;

          const text = await readWsPayloadAsText(evt.data);
          if (!text) {
            console.log('[WS] MESSAGE non-text payload', evt.data);
            return;
          }
          if (text === 'PONG' || text === 'PING') {
            console.log('[WS] CONTROL', text);
            return;
          }
          let msg: any;
          try {
            msg = JSON.parse(text);
          } catch {
            console.warn('[WS] Failed to parse JSON', text);
            return;
          }

          // Some responses are arrays of events; normalize to array for easier handling
          const events: any[] = Array.isArray(msg) ? msg : [msg];

          for (const ev of events) {
            const eventType: string | undefined = ev?.event_type ?? ev?.type;
            // Log mọi message nhận được (trừ PING/PONG) để debug — server chỉ gửi price_change khi có giao dịch/orderbook thay đổi
            if (eventType || ev?.price_changes) {
              console.log('[WS] RECV', eventType ?? '(no event_type)', Array.isArray(ev?.price_changes) ? `price_changes:${ev.price_changes.length}` : ev);
            }

            // Market resolved event: stop WS updates for this market
            if (eventType === 'market_resolved') {
              const market = (ev as any)?.market as string | undefined;
              if (!market || !data.market.market_slug || market === data.market.market_slug) {
                console.log('[WS] market_resolved received, closing socket');
                setWsEnabled(false);
              }
              continue;
            }

            // Price change event (array of price_changes)
            if (eventType === 'price_change' && Array.isArray(ev?.price_changes)) {
            // Chỉ lấy 1 price_change (ưu tiên size lớn nhất) rồi suy ra outcome còn lại = 1 - price
            const relevant = (ev.price_changes as any[])
              .map((c) => ({
                change: c,
                assetId: (c?.asset_id ?? c?.assetId ?? c?.asset) as string | undefined,
                side: (c?.side as string | undefined) ?? undefined,
                size: typeof c?.size === 'string' || typeof c?.size === 'number' ? Number(c.size) : NaN,
                price: typeof c?.price === 'string' || typeof c?.price === 'number' ? Number(c.price) : NaN,
              }))
              .filter(
                (x) =>
                  !!x.assetId &&
                  x.side === 'BUY' &&
                  clobTokenIds.includes(x.assetId) &&
                  Number.isFinite(x.price) &&
                  x.price >= 0 &&
                  x.price <= 1.0001,
              )
              .sort((a, b) => {
                const as = Number.isFinite(a.size) ? a.size : -1;
                const bs = Number.isFinite(b.size) ? b.size : -1;
                return bs - as;
              });

            const picked = relevant[0];
            if (!picked) continue;

            const assetId = picked.assetId!;

            // Polymarket UI: midpoint of bid-ask; if spread > 0.10 use last traded price.
            // We approximate using best_bid/best_ask carried on the same price_change message.
            const bestBidRaw = (picked.change?.best_bid ?? picked.change?.bestBid) as string | number | undefined;
            const bestAskRaw = (picked.change?.best_ask ?? picked.change?.bestAsk) as string | number | undefined;
            const bestBid = typeof bestBidRaw === 'string' || typeof bestBidRaw === 'number' ? Number(bestBidRaw) : NaN;
            const bestAsk = typeof bestAskRaw === 'string' || typeof bestAskRaw === 'number' ? Number(bestAskRaw) : NaN;

            const lastTrade = picked.price;
            let displayPrice = lastTrade;

            if (Number.isFinite(bestBid) && Number.isFinite(bestAsk) && bestBid >= 0 && bestAsk >= 0) {
              const spread = bestAsk - bestBid;
              if (Number.isFinite(spread) && spread >= 0 && spread <= 0.10) {
                displayPrice = (bestBid + bestAsk) / 2;
              } else {
                displayPrice = lastTrade;
              }
            }

            const clamped = Math.max(0, Math.min(1, displayPrice));

            console.log('[WS] PARSED MESSAGE price_change (picked)', {
              assetId,
              price: clamped,
              size: picked.size,
            });

            updatePriceForAsset(assetId, clamped);

            if (clobTokenIds.length === 2) {
              const idx = clobTokenIds.indexOf(assetId);
              if (idx >= 0) {
                const otherAssetId = clobTokenIds[1 - idx];
                updatePriceForAsset(otherAssetId, 1 - clamped);
              }
            }
            continue;
            }
          }
        })();
      };

      ws.onclose = () => {
        safeClearTimers();
        if (cancelled) return;
        const delay = Math.min(30_000, 1000 * Math.pow(2, reconnectAttempt));
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // Let onclose handle reconnect/backoff
      };
    };

    connect();

    return () => {
      cancelled = true;
      safeClearTimers();
      try {
        ws?.close();
      } catch {
        // ignore
      }
      ws = null;
    };
  }, [marketKey, tokenIdsKey, wsEnabled]);

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

  const { data: virtualBets } = useQuery({
    queryKey: ['virtual-bets'],
    queryFn: () => getVirtualBets(),
    enabled: !!user,
    refetchInterval: 15_000,
  });

  const autoSellTriggeredRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user || !predictionId || !virtualBets || !clobTokenIds.length) return;
    const upLive = upIndex >= 0 ? (liveOutcomePrices[upIndex] ?? data.market.outcomePrices[upIndex] ?? NaN) : NaN;
    const downLive = downIndex >= 0 ? (liveOutcomePrices[downIndex] ?? data.market.outcomePrices[downIndex] ?? NaN) : NaN;

    const relevantBets = virtualBets.filter((b) => b.status === 'PENDING' && b.marketSlug === marketKey);

    for (const bet of relevantBets) {
      if (autoSellTriggeredRef.current.has(bet.id)) continue;

      const livePrice = bet.direction === 'UP' ? upLive : downLive;
      if (!Number.isFinite(livePrice) || livePrice <= 0 || livePrice > 1.0001) continue;

      const entryPrice = bet.outcomePrice;
      if (!entryPrice || entryPrice <= 0) continue;

      const targetPrice = entryPrice * 1.1;
      console.log("targetPrice", { entryPrice, targetPrice });

      if (livePrice >= targetPrice) {
        console.log('[auto-sell] target reached', {
          betId: bet.id,
          direction: bet.direction,
          entryPrice,
          livePrice,
          targetPrice,
          mode: betMode,
          marketSlug: marketKey,
        });

        autoSellTriggeredRef.current.add(bet.id);

        if (betMode === 'VIRTUAL') {
          sellVirtualBet(bet.id, livePrice)
            .then(() => {
              refreshProfile();
              queryClient.invalidateQueries({ queryKey: ['virtual-bets'] });
              queryClient.invalidateQueries({ queryKey: ['bet-summary'] });
            })
            .catch((err: Error) => {
              autoSellTriggeredRef.current.delete(bet.id);
              console.error('[auto-sell] failed (virtual)', {
                betId: bet.id,
                error: err.message,
              });
            });
        } else {
          sellRealBetFromShadow(bet.id, livePrice)
            .then(() => {
              console.log('[auto-sell] real SELL placed', {
                betId: bet.id,
                livePrice,
              });
            })
            .catch((err: Error) => {
              autoSellTriggeredRef.current.delete(bet.id);
              console.error('[auto-sell] failed (real)', {
                betId: bet.id,
                error: err.message,
              });
            });
        }
      }
    }
  }, [
    user,
    predictionId,
    virtualBets,
    clobTokenIds.length,
    liveOutcomePrices,
    upIndex,
    downIndex,
    marketKey,
    refreshProfile,
    queryClient,
    data.market.outcomePrices,
    betMode,
  ]);

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
              {((liveOutcomePrices[i] ?? data.market.outcomePrices[i] ?? 0) * 100).toFixed(1)}%
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
                UP {((liveOutcomePrices[upIndex] ?? data.market.outcomePrices[upIndex] ?? 0) * 100).toFixed(1)}%
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
                DOWN {((liveOutcomePrices[downIndex] ?? data.market.outcomePrices[downIndex] ?? 0) * 100).toFixed(1)}%
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
