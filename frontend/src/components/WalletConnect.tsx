import { useAuth } from '../context/AuthContext';

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function WalletConnect() {
  const { user, profile, isConnecting, error, connect, disconnect } = useAuth();

  if (user) {
    return (
      <div className="flex items-center gap-3">
        <div className="text-right hidden sm:block">
          <p className="text-xs text-gray-400">Balance</p>
          <p className="text-sm font-semibold font-mono text-emerald-400">
            ${(profile?.balance ?? user.balance).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-xs font-mono text-gray-300">{shortenAddress(user.address)}</span>
        </div>
        <button
          onClick={disconnect}
          className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-xs text-gray-400 hover:text-white hover:border-gray-600 transition"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {error && (
        <span className="text-xs text-red-400 max-w-48 truncate">{error}</span>
      )}
      <button
        onClick={connect}
        disabled={isConnecting}
        className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium transition disabled:opacity-50"
      >
        {isConnecting ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Connecting...
          </>
        ) : (
          <>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v6z" />
              <circle cx="16" cy="10" r="1" fill="currentColor" />
            </svg>
            Connect Wallet
          </>
        )}
      </button>
    </div>
  );
}
