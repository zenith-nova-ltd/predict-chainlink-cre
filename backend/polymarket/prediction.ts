import axios, { AxiosError } from 'axios';
import { TaapiClientService } from './taapi.js';
import {
  AVAILABLE_INDICATORS,
  DEFAULT_INTRADAY_INDICATOR_IDS,
  DEFAULT_LONGTERM_INDICATOR_IDS,
} from './indicators.const.js';

import type { IndicatorDefinition } from './indicators.const.js';
import type { GetMarketDataOptions, MarketSection, IntradayIndicators } from './types.js';
import dotenv from 'dotenv';
import { fetchBtcUpDownMarkets } from './polymarketAPI.js';
dotenv.config();

/** Mirrors getIndicatorsByIds from indicators.const.ts; uses AVAILABLE_INDICATORS for CJS/ESM interop. */
function getIndicatorsByIds(ids: string[]): IndicatorDefinition[] {
  return ids
    .map((id) => AVAILABLE_INDICATORS.find((ind) => ind.id === id))
    .filter((def): def is IndicatorDefinition => def !== undefined);
}

import { buildPolymarketUpDownPrompt, buildTools } from './prompts.js';
import { delay, roundOrNull, roundSeries } from '../lib/utils/utils.js';

/** Tool call + chat types (from decisionMaker.ts pattern) */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  refusal?: string | null;
  reasoning?: string | null;
  parsed?: Record<string, unknown>;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenRouterResponse {
  choices: Array<{
    message: ChatMessage;
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
    metadata?: {
      raw?: string;
      provider_name?: string;
    };
  };
}
interface ContextPayload {
  market_data: MarketSection[];
  instructions: {
    assets: string[];
    requirement: string;
  };
}
/** Up/Down decision types */
export type UpDownDirection = 'UP' | 'DOWN' | 'NO_BET';

export interface UpDownDecision {
  market_slug: string;
  direction: UpDownDirection;
  size_usd: number;
  max_loss_usd: number;
  edge_prob: number;
}

export interface UpDownAgentOutput {
  reasoning: string;
  decision: UpDownDecision;
}

/** Minimal Polymarket market snapshot passed into the agent */
export interface UpDownMarketSnapshot {
  market_slug: string;
  question: string;
  outcomes: string[];       // e.g. ["Up","Down"]
  outcomePrices: number[];  // same length, implied probs 0–1
  clobTokenIds: string[];   // CLOB token IDs for each outcome (same order)
}

/** Structured-output JSON Schema for Up/Down decision */
function buildUpDownOutputSchema() {
  return {
    type: 'object',
    properties: {
      reasoning: {
        type: 'string',
        description:
          'Long-form step-by-step analysis including TAAPI indicator interpretation and Polymarket pricing comparison',
      },
      decision: {
        type: 'object',
        description: 'Final bet decision for this Polymarket up/down market',
        properties: {
          market_slug: {
            type: 'string',
            description: 'Polymarket market slug this decision applies to',
          },
          direction: {
            type: 'string',
            enum: ['UP', 'DOWN', 'NO_BET'],
            description: 'UP, DOWN, or NO_BET',
          },
          size_usd: {
            type: 'number',
            minimum: 0,
            description: 'Bet size in USD (0 allowed when NO_BET)',
          },
          max_loss_usd: {
            type: 'number',
            minimum: 0,
            description:
              'Worst-case dollar loss if the bet loses (usually <= size_usd)',
          },
          edge_prob: {
            type: 'number',
            minimum: 0.5,
            maximum: 1,
            description:
              "Confidence (0.5–1.0) that the chosen direction wins. 0.5 = no edge (use with NO_BET). NEVER below 0.5.",
          },
        },
        required: ['market_slug', 'direction', 'size_usd', 'max_loss_usd', 'edge_prob'],
        additionalProperties: false,
      },
    },
    required: ['reasoning', 'decision'],
    additionalProperties: false,
  };
}


export class PolymarketUpDownAgent {
  private model: string;
  private apiKey: string;
  private baseUrl: string;
  private taapi: TaapiClientService;

  constructor() {
    this.model = process.env.LLM_MODEL || '';
    this.apiKey = process.env.OPENROUTER_API_KEY || '';
    this.baseUrl = `${process.env.OPENROUTER_BASE_URL}chat/completions`;
    this.taapi = new TaapiClientService();
  }

  /**
   * Decide UP / DOWN / NO_BET for a single Polymarket market.
   *
   * @param assetSymbol e.g. "BTC"
   * @param market Polymarket snapshot (question, outcomes, prices)
   */
  async decideUpDown(
    assetSymbol: string,
    market: UpDownMarketSnapshot,
    context: string
  ): Promise<UpDownAgentOutput> {
    const systemPrompt = buildPolymarketUpDownPrompt(
      market.market_slug,
      assetSymbol,
      market.outcomes,
      market.outcomePrices
    );

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: context },
    ];

      const payload: Record<string, unknown> = {
        model: this.model,
        messages,
      };

        payload.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'polymarket_updown_decision',
            strict: true,
            schema: buildUpDownOutputSchema(),
          },
        };

      let respJson: OpenRouterResponse;
      try {
        respJson = await this.callLLM(payload);
      } catch (error) {
        const axiosError = error as AxiosError<OpenRouterResponse>;
        if (axiosError.response?.data) {
          console.error('[prediction] LLM API error response:', axiosError.response.data);
        }
        throw error;
      }

      const choice = respJson.choices && respJson.choices[0];
      if (!choice || !choice.message || typeof choice.message.content !== 'string') {
        throw new Error(
          'Invalid LLM response: choice or message is missing or malformed.'
        );
      }

      const message = choice.message;
      // Final response
      if (typeof message.content !== 'string') {
        throw new Error('Invalid LLM response: content is not a string.');
      }

      messages.push(message);
      return this.parseUpDownResponse(message, market.market_slug);
  }

  private async callLLM(payload: Record<string, unknown>) {
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'polymarket-updown-agent',
    };

    const response = await axios.post(this.baseUrl, payload, {
      headers,
      timeout: 60000,
    });

    if (response.status !== 200) {
      const errorText =
        typeof response.data === 'object'
          ? JSON.stringify(response.data)
          : response.data;
      throw new Error(`LLM API error: ${response.status} - ${errorText}`);
    }

    return response.data as OpenRouterResponse;
  }

  /**
   * Parse final LLM message into UpDownAgentOutput.
   */
  private parseUpDownResponse(
    message: ChatMessage,
    defaultSlug: string
  ): UpDownAgentOutput {
    let parsed: Record<string, unknown>;

    if (message.parsed && typeof message.parsed === 'object') {
      parsed = message.parsed;
    } else {
      const content = message.content || '{}';
      parsed = JSON.parse(content);
    }

    const reasoning = (parsed.reasoning as string) || '';
    const decisionRaw = parsed.decision as Record<string, unknown> | undefined;
    if (!decisionRaw || typeof decisionRaw !== 'object') {
      throw new Error("Missing or invalid 'decision' field in LLM output");
    }

    let direction = (decisionRaw.direction as UpDownDirection) || 'NO_BET';
    let edgeProb = Number(decisionRaw.edge_prob) || 0.5;
    let sizeUsd = Number(decisionRaw.size_usd) || 0;

    if (edgeProb < 0.5 && direction !== 'NO_BET') {
      direction = 'NO_BET';
      sizeUsd = 0;
      edgeProb = 0.5;
    }

    const decision: UpDownDecision = {
      market_slug: String(decisionRaw.market_slug || defaultSlug),
      direction,
      size_usd: sizeUsd,
      max_loss_usd: direction === 'NO_BET' ? 0 : Number(decisionRaw.max_loss_usd) || 0,
      edge_prob: edgeProb,
    };

    return { reasoning, decision };
  }

   /**
   * Fetch current market data for all specified assets.
   * Combines technical indicators from TAAPI with price/funding data from Hyperliquid.
   */
   async getCurrentMarketData(options: GetMarketDataOptions): Promise<MarketSection[]> {
    const {
      asset,
      intradayTimeframe = '5m',
      longTermTimeframe = '4h',
      seriesResults = 10,
      logger,
      intradayIndicatorIds,
      longTermIndicatorIds,
    } = options;

    const intradayDefs = getIndicatorsByIds(
      intradayIndicatorIds?.length ? intradayIndicatorIds : DEFAULT_INTRADAY_INDICATOR_IDS
    );
    const longTermDefs = getIndicatorsByIds(
      longTermIndicatorIds?.length ? longTermIndicatorIds : DEFAULT_LONGTERM_INDICATOR_IDS
    );

    const marketSections: MarketSection[] = [];

      try {
        const section = await this.fetchAssetMarketData(
          asset,
          intradayTimeframe,
          longTermTimeframe,
          seriesResults,
          intradayDefs,
          longTermDefs
        );
        marketSections.push(section);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (logger) {
          logger.error(`Data gather error ${asset}: ${errorMessage}`);
        }
        // Continue to next asset on error
      }

    return marketSections;
  }

  buildUserContext(params: {
    marketData: MarketSection[];
    assets: string[];
  }): string {
  
    const payload: ContextPayload = {
      market_data: params.marketData,
      instructions: {
        assets: params.assets,
        requirement: 'Decide actions for all assets and return a strict JSON array matching the schema.',
      },
    };
    
    return JSON.stringify(payload);
  }
  /**
   * Fetch market data for a single asset.
   */
private async fetchAssetMarketData(
  asset: string,
  intradayTimeframe: string,
  longTermTimeframe: string,
  seriesResults: number,
  intradayDefs: IndicatorDefinition[],
  longTermDefs: IndicatorDefinition[]
): Promise<MarketSection> {

  const symbol = `${asset}/USDT`;

  const [intradayData, longTermData, currentPrice] = await Promise.all([
    this.fetchIndicatorsByDefs(asset, intradayTimeframe, seriesResults, intradayDefs),
    this.fetchIndicatorsByDefs(asset, longTermTimeframe, seriesResults, longTermDefs),
    this.taapi.fetchValue('price', symbol, intradayTimeframe, {}, 'value'),
  ]);

  return {
    asset,
    current_price: currentPrice,
    timestamp: new Date().toISOString(),
    intraday: intradayData,
    long_term: longTermData,
  };
}
/**
   * Fetch indicators by definitions; sequential calls to reduce TAAPI rate limit.
   */
private async fetchIndicatorsByDefs(
  asset: string,
  timeframe: string,
  seriesResults: number,
  defs: IndicatorDefinition[]
): Promise<IntradayIndicators> {
  const values: Record<string, number | null> = {};
  const series: Record<string, number[]> = {};
  const symbol = `${asset}/USDT`;

  for (const def of defs) {
    await delay(1000);
    if (def.multiValueKeys?.length) {
      const data = await this.taapi.getHistoricalData(
        def.taapiIndicator,
        symbol,
        timeframe,
        seriesResults,
        def.params as Record<string, unknown>
      );
      for (const { responseKey, outputId } of def.multiValueKeys) {
        const raw = data[responseKey];
        const arr = Array.isArray(raw)
          ? raw.map((v: unknown) => (typeof v === 'number' ? v : 0))
          : typeof raw === 'number'
            ? [raw]
            : [];
        series[outputId] = roundSeries(arr, 2);
        values[outputId] = roundOrNull(arr[arr.length - 1] ?? null, 2);
      }
    } else if (def.fetchSeries && def.valueKey) {
      const arr = await this.taapi.fetchSeries(
        def.taapiIndicator,
        symbol,
        timeframe,
        seriesResults,
        def.params as Record<string, unknown>,
        def.valueKey
      );
      series[def.id] = roundSeries(arr, 2);
      values[def.id] = roundOrNull(arr[arr.length - 1] ?? null, 2);
    } else if (def.valueKey) {
      const val = await this.taapi.fetchValue(
        def.taapiIndicator,
        symbol,
        timeframe,
        def.params as Record<string, unknown>,
        def.valueKey
      );
      values[def.id] = roundOrNull(val, 2);
    }
  }

  return { values, series };
}

  /**
   * End-to-end prediction: fetch indicators, find the current 15-min Polymarket
   * market for the given symbol, and return the LLM's UP/DOWN/NO_BET decision.
   */
  async predict(symbol: string): Promise<{
    market: UpDownMarketSnapshot;
    marketData: MarketSection[];
    result: UpDownAgentOutput;
  }> {
    const asset = symbol.toUpperCase();

    const marketData = await this.getCurrentMarketData({ asset });

    const context = this.buildUserContext({
      marketData,
      assets: [asset],
    });

    const FIFTEEN_MINUTES = 15 * 60;
    const now = Math.floor(Date.now() / 1000);
    const roundedTimestamp = Math.floor(now / FIFTEEN_MINUTES) * FIFTEEN_MINUTES;

    const slug = `${asset.toLowerCase()}-updown-15m-${roundedTimestamp}`;
    const markets = await fetchBtcUpDownMarkets({ slug });

    if (!markets || markets.length === 0 || !markets[0]) {
      throw new Error(`No Polymarket market found for slug: ${slug}`);
    }

    const m = markets[0];
    const snapshot: UpDownMarketSnapshot = {
      market_slug: m.slug,
      question: m.question,
      outcomes: m.outcomes.map((o: { label: string }) => o.label),
      outcomePrices: m.outcomes.map((o: { price: number }) => o.price),
      clobTokenIds: m.clobTokenIds ?? [],
    };

    const result = await this.decideUpDown(asset, snapshot, context);

    return { market: snapshot, marketData, result };
  }
}



