import type { ReactNode } from 'react';
import { useState } from 'react';
import WalletConnect from './WalletConnect';

export default function Layout({ children }: { children: ReactNode }) {
  const [showPredictInfo, setShowPredictInfo] = useState(false);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto max-w-5xl flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-600 font-bold text-sm">
              TP
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">AI Prediction (Powered by Chainlink CRE)</h1>
            </div>
          </div>
          <WalletConnect />
        </div>
      </header>

      <main className="relative mx-auto max-w-5xl px-4 py-8 space-y-8">
        {children}

        <div className="fixed right-4 top-24 z-20">
          <button
            type="button"
            onClick={() => setShowPredictInfo((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full border border-gray-700 bg-gray-900/80 px-3 py-1.5 text-[11px] text-gray-200 shadow-lg shadow-black/40 hover:bg-gray-800 hover:text-white transition"
          >
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-semibold">
              i
            </span>
            <span>{showPredictInfo ? 'Hide Predict / Auto help' : 'Predict / Auto help'}</span>
          </button>

          {showPredictInfo && (
            <div className="mt-2 w-72 rounded-xl border border-gray-800 bg-gray-950/95 p-3 text-[11px] text-gray-300 shadow-xl shadow-black/60">
              <p className="mb-1 font-semibold text-gray-100">How Predict & Auto work</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>
                  <span className="font-semibold text-indigo-300">Predict</span> runs the AI analysis once
                  and generates a recommendation for the currently selected token.
                </li>
                <li>
                  <span className="font-semibold text-emerald-300">Auto</span> repeats Predict automatically
                  every cycle and places a virtual bet based on the recommendation (if your balance is sufficient).
                </li>
              </ul>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
