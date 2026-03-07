/**
 * Market Data Types
 * Shared types for market data fetching and processing
 */

/**
 * Options for getCurrentMarketData function.
 */
export interface GetMarketDataOptions {
    /** Assets to fetch data for (e.g., ['BTC', 'ETH']) */
    asset: string;
    /** Intraday timeframe (default: '5m') */
    intradayTimeframe?: string;
    /** Long-term timeframe (default: '4h') */
    longTermTimeframe?: string;
    /** Number of results for series data (default: 10) */
    seriesResults?: number;
    /** Optional logger for errors */
    logger?: { error: (msg: string) => void; info: (msg: string) => void };
    /** Indicator ids for intraday (5m). If empty/undefined, defaults are used */
    intradayIndicatorIds?: string[];
    /** Indicator ids for long-term (4h). If empty/undefined, defaults are used */
    longTermIndicatorIds?: string[];
  }
  
  /** Dynamic intraday indicators (5m): latest values and series per indicator id */
  export interface IntradayIndicators {
    values: Record<string, number | null>;
    series: Record<string, number[]>;
  }
  
  /** Dynamic long-term indicators (4h): latest values and series per indicator id */
  export interface LongTermIndicators {
    values: Record<string, number | null>;
    series: Record<string, number[]>;
  }
  
  /** Market data for a single asset */
  export interface MarketSection {
    asset: string;
    current_price: number | null;
    timestamp: string;
    intraday: IntradayIndicators;
    long_term: LongTermIndicators;
  }
  
  /** Price history entry for caching */
  export interface PriceHistoryEntry {
    t: string;
    mid: number | null;
  }
  