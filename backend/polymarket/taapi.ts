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
}