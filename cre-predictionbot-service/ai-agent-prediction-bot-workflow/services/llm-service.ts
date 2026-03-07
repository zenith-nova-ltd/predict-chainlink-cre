import { 
  HTTPClient, 
  type Runtime, 
  type HTTPSendRequester,
  consensusIdenticalAggregation
} from "@chainlink/cre-sdk";

type LLMConfig = {
  schedule: string;
  authorizedEVMAddress: string;
};

// Base64 encoding (QuickJS doesn't have btoa)
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    const b3 = i + 2 < len ? bytes[i + 2] : 0;
    
    result += BASE64_CHARS[b1 >> 2];
    result += BASE64_CHARS[((b1 & 3) << 4) | (b2 >> 4)];
    result += i + 1 < len ? BASE64_CHARS[((b2 & 15) << 2) | (b3 >> 6)] : '=';
    result += i + 2 < len ? BASE64_CHARS[b3 & 63] : '=';
  }
  
  return result;
}

// LLM Request Payload (matches OpenRouter format)
export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LLMRequestPayload = {
  model: string;
  messages: LLMMessage[];
  response_format?: Record<string, any>;
};

export type PredictionDecision = {
  market_slug: string;
  direction: "UP" | "DOWN" | "NO_BET";
  size_usd: number;
  max_loss_usd: number;
  edge_prob: number;
};

export type PredictionDecisionResponse = {
  reasoning: string;
  decision: PredictionDecision;
};

export class LLMService {
  private apiKey: string;
  private baseUrl = "https://openrouter.ai/api/v1/chat/completions";

  constructor(apiKey?: string) {
    // API key from config (config is populated from env when running locally, e.g. OPENROUTER_API_KEY)
    this.apiKey = apiKey || "";
  }

  /**
   * Send a request to the LLM with the full payload (OpenRouter format)
   * Returns the raw content from the LLM response
   */
  sendRequest(
    runtime: Runtime<LLMConfig>,
    payload: LLMRequestPayload
  ): string | null {
    const httpClient = new HTTPClient();
    const apiKey = this.apiKey;
    const baseUrl = this.baseUrl;

    const fetchAndParse = (sendRequester: HTTPSendRequester): string => {
      try {
        // Encode body as base64 string (required by CRE SDK)
        const bodyString = JSON.stringify(payload);
        const bodyBytes = new TextEncoder().encode(bodyString);
        const bodyBase64 = toBase64(bodyBytes);
        
        const req = {
          url: baseUrl,
          method: "POST" as const,
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: bodyBase64,
        };

        const resp = sendRequester.sendRequest(req).result();

        if (resp.statusCode !== 200) {
          const errorBody = new TextDecoder().decode(resp.body);
          return JSON.stringify({ error: `HTTP ${resp.statusCode}: ${errorBody}` });
        }

        const bodyText = new TextDecoder().decode(resp.body);
        const data = JSON.parse(bodyText);

        // Extract the content from OpenRouter response
        if (data.choices && data.choices[0] && data.choices[0].message) {
          const content = data.choices[0].message.content;
          if (content) {
            return content;
          }
        }

        return JSON.stringify({ error: "No content in response", raw: data });
      } catch (error: any) {
        return JSON.stringify({ error: error.message || String(error) });
      }
    };

    try {
      const result = httpClient
        .sendRequest(runtime, fetchAndParse, consensusIdenticalAggregation<string>())()
        .result();

      // Check for error in response
      try {
        const parsed = JSON.parse(result);
        if (parsed.error) {
          runtime.log(`LLM error: ${parsed.error}`);
          return null;
        }
      } catch {
        // Not JSON error format, return as-is
      }

      return result;
    } catch (error: any) {
      runtime.log(`sendRequest error: ${error.message || error}`);
      return null;
    }
  }

  /**
   * Send request and parse as PredictionDecisionResponse
   */
  getPredictionDecision(
    runtime: Runtime<LLMConfig>,
    payload: LLMRequestPayload
  ): PredictionDecisionResponse | null {
    const response = this.sendRequest(runtime, payload);
    
    if (!response) {
      return null;
    }

    try {
      return JSON.parse(response) as PredictionDecisionResponse;
    } catch (error: any) {
      runtime.log(`Failed to parse prediction decision: ${error.message || error}`);
      return null;
    }
  }

  /**
   * Send data to a custom server endpoint
   */
  sendToServer(
    runtime: Runtime<LLMConfig>,
    serverUrl: string,
    data: Record<string, any>,
    headers?: Record<string, string>
  ): { success: boolean; response?: string; error?: string } {
    const httpClient = new HTTPClient();

    const fetchAndParse = (sendRequester: HTTPSendRequester): string => {
      try {
        const bodyString = JSON.stringify(data);
        const bodyBytes = new TextEncoder().encode(bodyString);
        const bodyBase64 = toBase64(bodyBytes);
        
        const req = {
          url: serverUrl,
          method: "POST" as const,
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: bodyBase64,
        };

        const resp = sendRequester.sendRequest(req).result();

        if (resp.statusCode >= 200 && resp.statusCode < 300) {
          const bodyText = new TextDecoder().decode(resp.body);
          return JSON.stringify({ success: true, response: bodyText });
        } else {
          const errorBody = new TextDecoder().decode(resp.body);
          return JSON.stringify({ success: false, error: `HTTP ${resp.statusCode}: ${errorBody}` });
        }
      } catch (error: any) {
        return JSON.stringify({ success: false, error: error.message || String(error) });
      }
    };

    try {
      const resultJson = httpClient
        .sendRequest(runtime, fetchAndParse, consensusIdenticalAggregation<string>())()
        .result();

      return JSON.parse(resultJson);
    } catch (error: any) {
      runtime.log(`sendToServer error: ${error.message || error}`);
      return { success: false, error: error.message || String(error) };
    }
  }
}
