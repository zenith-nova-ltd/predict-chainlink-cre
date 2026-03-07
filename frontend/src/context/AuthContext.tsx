import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { getNonce, verifySignature, getProfile } from '../api/prediction';
import type { AuthUser, UserProfile } from '../types';

interface AuthState {
  user: AuthUser | null;
  profile: UserProfile | null;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    const token = localStorage.getItem('jwt_token');
    if (!token) return;
    try {
      const p = await getProfile();
      setProfile(p);
      setUser((prev) => (prev ? { ...prev, balance: p.balance } : null));
    } catch {
      // token expired or invalid
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('jwt_token');
    const savedUser = localStorage.getItem('auth_user');
    if (token && savedUser) {
      try {
        setUser(JSON.parse(savedUser) as AuthUser);
        refreshProfile();
      } catch {
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('auth_user');
      }
    }
  }, [refreshProfile]);

  // Keep wallet/header balance in sync with server-side updates (e.g. settlement cron).
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => {
      refreshProfile();
    }, 15_000);
    return () => clearInterval(id);
  }, [user, refreshProfile]);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError('MetaMask not found. Please install MetaMask extension.');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[];

      const address = accounts[0];
      if (!address) throw new Error('No account selected');

      const nonce = await getNonce(address);
      const message = `Sign this message to login to Prediction Bot.\n\nNonce: ${nonce}`;

      const signature = (await window.ethereum.request({
        method: 'personal_sign',
        params: [message, address],
      })) as string;

      const { token, user: authUser } = await verifySignature(address, signature);

      localStorage.setItem('jwt_token', token);
      localStorage.setItem('auth_user', JSON.stringify(authUser));
      setUser(authUser);
      await refreshProfile();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect';
      if (msg.includes('User rejected') || msg.includes('user rejected')) {
        setError('Connection cancelled by user');
      } else {
        setError(msg);
      }
    } finally {
      setIsConnecting(false);
    }
  }, [refreshProfile]);

  const disconnect = useCallback(() => {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('auth_user');
    setUser(null);
    setProfile(null);
    setError(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, profile, isConnecting, error, connect, disconnect, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
