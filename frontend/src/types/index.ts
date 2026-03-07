export interface PredictionMarket {
  market_slug: string;
  question: string;
  outcomes: string[];
  outcomePrices: number[];
  clobTokenIds: string[];
}

export interface PredictionDecision {
  market_slug: string;
  direction: 'UP' | 'DOWN' | 'NO_BET';
  size_usd: number;
  max_loss_usd: number;
  edge_prob: number;
}

export interface PredictionResponse {
  symbol: string;
  timestamp: string;
  market: PredictionMarket;
  current_price: number | null;
  prediction: PredictionDecision;
  reasoning: string;
}

export interface PredictionHistoryEntry extends PredictionResponse {
  id: string;
}

export interface PlaceBetRequest {
  tokenId: string;
  price: number;
  size: number;
  side: 'BUY' | 'SELL';
}

export interface PlaceBetResponse {
  success: boolean;
  order: unknown;
  error?: string;
}

export interface AuthUser {
  id: string;
  address: string;
  balance: number;
}

export interface UserProfile {
  id: string;
  address: string;
  balance: number;
  totalBets: number;
  settledBets: number;
  wonBets: number;
  totalPnl: number;
  winRate: number;
}

export interface VirtualBetRequest {
  predictionId: string;
  direction: 'UP' | 'DOWN';
  amount: number;
}

export interface VirtualBetResponse {
  id: string;
  marketSlug: string;
  direction: 'UP' | 'DOWN';
  amount: number;
  outcomePrice: number;
  potentialPayout: number;
  status: 'PENDING' | 'WON' | 'LOST' | 'CANCELLED';
  balance: number;
}

export interface VirtualBetEntry {
  id: string;
  marketSlug: string;
  direction: 'UP' | 'DOWN';
  amount: number;
  outcomePrice: number;
  potentialPayout: number;
  status: 'PENDING' | 'WON' | 'LOST' | 'CANCELLED';
  pnl: number | null;
  settledAt: string | null;
  createdAt: string;
  prediction: {
    symbol: string;
    question: string;
    direction: string;
    currentPrice: number | null;
    edgeProb: number | null;
  };
}

export interface BetSummary {
  balance: number;
  totalBets: number;
  pendingBets: number;
  settledBets: number;
  wonBets: number;
  lostBets: number;
  totalPnl: number;
  winRate: number;
}
