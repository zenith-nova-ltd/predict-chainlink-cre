/**
 * Technical indicator definitions for TAAPI.
 * Used for selectable indicators in AI Trading (Option B).
 */

/** Map TAAPI response key to output id (for multi-value indicators like bbands) */
export interface MultiValueKey {
    responseKey: string;
    outputId: string;
  }
  
  export interface IndicatorDefinition {
    /** Unique id used in session and API (e.g. ema_20, bbands) */
    id: string;
    /** i18n key for display name (libs/languages) */
    nameKey: string;
    /** TAAPI indicator endpoint name */
    taapiIndicator: string;
    /** TAAPI request params (e.g. period) */
    params: Record<string, number>;
    /** TAAPI response key for value/series (omit when using multiValueKeys) */
    valueKey?: string;
    /** If true, fetch series; otherwise single value */
    fetchSeries: boolean;
    /** When set, fetch once and fill multiple outputs (e.g. bbands upper/middle/lower) */
    multiValueKeys?: MultiValueKey[];
  }
  
  /** All indicators available for selection in AI Trading */
  export const AVAILABLE_INDICATORS: IndicatorDefinition[] = [
    {
      id: 'ema_20',
      nameKey: 'ai_indicator_ema_20',
      taapiIndicator: 'ema',
      params: { period: 20 },
      valueKey: 'value',
      fetchSeries: true,
    },
    {
      id: 'ema_50',
      nameKey: 'ai_indicator_ema_50',
      taapiIndicator: 'ema',
      params: { period: 50 },
      valueKey: 'value',
      fetchSeries: false,
    },
    {
      id: 'macd',
      nameKey: 'ai_indicator_macd',
      taapiIndicator: 'macd',
      params: {},
      valueKey: 'valueMACD',
      fetchSeries: true,
    },
    {
      id: 'rsi_7',
      nameKey: 'ai_indicator_rsi_7',
      taapiIndicator: 'rsi',
      params: { period: 7 },
      valueKey: 'value',
      fetchSeries: true,
    },
    {
      id: 'rsi_14',
      nameKey: 'ai_indicator_rsi_14',
      taapiIndicator: 'rsi',
      params: { period: 14 },
      valueKey: 'value',
      fetchSeries: true,
    },
    {
      id: 'bbands',
      nameKey: 'ai_indicator_bbands',
      taapiIndicator: 'bbands',
      params: { period: 20 },
      fetchSeries: true,
      multiValueKeys: [
        { responseKey: 'valueUpperBand', outputId: 'bbands_upper' },
        { responseKey: 'valueMiddleBand', outputId: 'bbands_middle' },
        { responseKey: 'valueLowerBand', outputId: 'bbands_lower' },
      ],
    },
    {
      id: 'atr_3',
      nameKey: 'ai_indicator_atr_3',
      taapiIndicator: 'atr',
      params: { period: 3 },
      valueKey: 'value',
      fetchSeries: false,
    },
    {
      id: 'atr_14',
      nameKey: 'ai_indicator_atr_14',
      taapiIndicator: 'atr',
      params: { period: 14 },
      valueKey: 'value',
      fetchSeries: false,
    },
  ];
  
  /** Default intraday indicator ids when user has not selected any (5m) */
  export const DEFAULT_INTRADAY_INDICATOR_IDS = ['ema_20', 'macd', 'rsi_7', 'rsi_14'];
  
  /** Default long-term indicator ids when user has not selected any (4h) */
  export const DEFAULT_LONGTERM_INDICATOR_IDS = [
    'ema_20',
    'ema_50',
    'atr_3',
    'atr_14',
    'macd',
    'rsi_14',
  ];
  
  export function getIndicatorById(id: string): IndicatorDefinition | undefined {
    return AVAILABLE_INDICATORS.find(ind => ind.id === id);
  }
  
  export function getIndicatorsByIds(ids: string[]): IndicatorDefinition[] {
    return ids
      .map(id => getIndicatorById(id))
      .filter((def): def is IndicatorDefinition => def !== undefined);
  }
  