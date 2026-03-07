import type {
  PredictionResponse,
  PredictionHistoryEntry,
  PlaceBetRequest,
  PlaceBetResponse,
  AuthUser,
  UserProfile,
  VirtualBetRequest,
  VirtualBetResponse,
  VirtualBetEntry,
  BetSummary,
} from '../types';

const BASE = '';

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('jwt_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...getAuthHeaders(),
    },
  });
}

// ─── Auth ──────────────────────────────────────────────────────

export async function getNonce(address: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/nonce?address=${encodeURIComponent(address)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error || 'Failed to get nonce');
  }
  const data = (await res.json()) as { nonce: string };
  return data.nonce;
}

export async function verifySignature(
  address: string,
  signature: string,
): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, signature }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error || 'Verification failed');
  }
  return res.json() as Promise<{ token: string; user: AuthUser }>;
}

export async function getProfile(): Promise<UserProfile> {
  const res = await authFetch(`${BASE}/api/user/profile`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error || 'Failed to load profile');
  }
  return res.json() as Promise<UserProfile>;
}

// ─── Predictions ───────────────────────────────────────────────

export async function fetchPrediction(symbol: string): Promise<PredictionResponse> {
  const res = await authFetch(`${BASE}/api/predict?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<PredictionResponse>;
}

export async function fetchPredictionHistory(): Promise<PredictionHistoryEntry[]> {
  const token = localStorage.getItem('jwt_token');
  if (!token) return [];

  const res = await authFetch(`${BASE}/api/predictions`);
  if (!res.ok) {
    throw new Error(`Failed to load history (${res.status})`);
  }
  return res.json() as Promise<PredictionHistoryEntry[]>;
}

export async function placeBet(params: PlaceBetRequest): Promise<PlaceBetResponse> {
  const res = await fetch(`${BASE}/api/place-bet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = (await res.json()) as PlaceBetResponse;
  if (!res.ok) {
    throw new Error(data.error || `Place bet failed (${res.status})`);
  }
  return data;
}

// ─── Virtual Bets ──────────────────────────────────────────────

export async function placeVirtualBet(params: VirtualBetRequest): Promise<VirtualBetResponse> {
  const res = await authFetch(`${BASE}/api/virtual-bet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = (await res.json()) as VirtualBetResponse & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Virtual bet failed (${res.status})`);
  }
  return data;
}

export async function getVirtualBets(status?: string): Promise<VirtualBetEntry[]> {
  const url = status
    ? `${BASE}/api/virtual-bets?status=${encodeURIComponent(status)}`
    : `${BASE}/api/virtual-bets`;
  const res = await authFetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load bets (${res.status})`);
  }
  return res.json() as Promise<VirtualBetEntry[]>;
}

export async function getBetSummary(): Promise<BetSummary> {
  const res = await authFetch(`${BASE}/api/virtual-bets/summary`);
  if (!res.ok) {
    throw new Error(`Failed to load summary (${res.status})`);
  }
  return res.json() as Promise<BetSummary>;
}
