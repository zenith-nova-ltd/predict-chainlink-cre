import axios from 'axios';
import { retry } from '../lib/utils/utils.js';
import dotenv from 'dotenv';
dotenv.config();
export class TaapiClientService {
  private apiKey: string;
  private baseUrl = process.env.TAAPI_URL;

  constructor() {
    this.apiKey = process.env.TAAPI_API_KEY || '';
  }

  async fetchSeries(
    indicator: string,
    symbol: string,
    interval: string,
    results = 10,
    params: Record<string, unknown> = {},
    valueKey = 'value'
  ): Promise<number[]> {
    try {
      const data = await this.getHistoricalIndicator(indicator, symbol, interval, results, params);
      if (data && valueKey in data && Array.isArray(data[valueKey])) {
        return data[valueKey].map((v: number) => 
          typeof v === 'number' ? Math.round(v * 10000) / 10000 : v
        );
      }
      return [];
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[taapi] fetchSeries error:', error instanceof Error ? error.message : error);
      }
      return [];
    }
  }

  async fetchValue(
    indicator: string,
    symbol: string,
    interval: string,
    params: Record<string, unknown> = {},
    key = 'value'
  ): Promise<number | null> {
    try {
      const data = await retry(() => 
        axios.get(`${this.baseUrl}${indicator}`, {
          params: {
            secret: this.apiKey,
            exchange: 'binance',
            symbol,
            interval,
            ...params,
          },
          timeout: 10000,
        })
      );
      const val = data.data[key];
      return typeof val === 'number' ? Math.round(val * 10000) / 10000 : null;
    } catch {
      return null;
    }
  }

  async getHistoricalData(
    indicator: string,
    symbol: string,
    interval: string,
    results: number,
    params: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    try {
      const response = await retry(() =>
        axios.get(`${this.baseUrl}${indicator}`, {
          params: {
            secret: this.apiKey,
            exchange: 'binance',
            symbol,
            interval,
            results,
            ...params,
          },
          timeout: 10000,
        })
      );
      return (response.data as Record<string, unknown>) ?? {};
    } catch {
      return {};
    }
  }
  private async getHistoricalIndicator(
    indicator: string,
    symbol: string,
    interval: string,
    results: number,
    params: Record<string, unknown>
  ) {
    const response = await retry(() =>
      axios.get(`${this.baseUrl}${indicator}`, {
        params: {
          secret: this.apiKey,
          exchange: 'binance',
          symbol,
          interval,
          results,
          ...params,
        },
        timeout: 10000,
      })
    );
    return response.data;
  }

  /**
   * Fetch multiple indicators in a single HTTP request via TAAPI Bulk endpoint.
   * Max 20 indicators per call. Each indicator can optionally request up to 20 results (series).
   */
  async fetchBulk(
    symbol: string,
    interval: string,
    indicators: Array<{ id: string; indicator: string; [key: string]: unknown }>
  ): Promise<Array<{ id: string; result: Record<string, unknown>; errors: unknown[] }>> {
    const bulkUrl = `${this.baseUrl}bulk`;
    const response = await retry(
      () =>
        axios.post(
          bulkUrl,
          {
            secret: this.apiKey,
            construct: {
              exchange: 'binance',
              symbol,
              interval,
              indicators,
            },
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000,
          }
        ),
      {
        maxAttempts: 3,
        backoffBase: 750,
        retryOn: (err: any) => {
          const code = err?.code;
          const status = err?.response?.status;
          return (
            code === 'ECONNRESET' ||
            code === 'ETIMEDOUT' ||
            code === 'EAI_AGAIN' ||
            code === 'ENOTFOUND' ||
            (typeof status === 'number' && (status === 429 || status >= 500))
          );
        },
      }
    );
    return response.data?.data ?? [];
  }
}