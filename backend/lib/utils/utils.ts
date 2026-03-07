/**
 * Round a number to specified decimals, returning null if input is null/undefined.
 */
export function roundOrNull(value: number | null | undefined, decimals: number): number | null {
    if (value === null || value === undefined || isNaN(value)) {
      return null;
    }
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }
  
  /**
   * Round all numbers in an array.
   */
  export function roundSeries(values: (number | null | undefined)[], decimals: number): number[] {
    return values
      .filter((v): v is number => v !== null && v !== undefined && !isNaN(v))
      .map(v => Math.round(v * Math.pow(10, decimals)) / Math.pow(10, decimals));
  }
  export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }


  interface RetryOptions {
    maxAttempts?: number;
    backoffBase?: number;
    retryOn?: (error: any) => boolean;
  }
  
  export async function retry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const { maxAttempts = 3, backoffBase = 500 } = options;
    
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        
        if (attempt < maxAttempts) {
          const delayMs = backoffBase * Math.pow(2, attempt - 1);
          await delay(delayMs);
        }
      }
    }
    
    throw lastError;
  }