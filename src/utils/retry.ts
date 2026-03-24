/**
 * Retry utility with exponential backoff.
 */

export interface RetryOptions {
  /** Maximum number of attempts (default: 5) */
  maxAttempts?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelay?: number;
  /** Maximum delay cap in milliseconds (default: 30000) */
  maxDelay?: number;
  /** Multiplier for each retry (default: 2.0) */
  backoffMultiplier?: number;
  /** Optional predicate to determine if error is retryable */
  retryIf?: (error: Error) => boolean;
}

/** Execute an async operation with exponential backoff retry. */
export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 5,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2.0,
    retryIf,
  } = options;

  let attempt = 0;
  let delay = initialDelay;

  while (true) {
    attempt++;
    try {
      return await operation();
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      const isRetryable = retryIf == null || retryIf(error);

      if (!isRetryable || attempt >= maxAttempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(Math.round(delay * backoffMultiplier), maxDelay);
    }
  }
}

/** Check if an error is a rate limit (429) error. */
export function isRateLimitError(error: Error): boolean {
  const msg = error.message;
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('Too many requests');
}

/** Check if an error is a transient "not found" error. */
export function isNotFoundError(error: Error): boolean {
  const msg = error.message;
  return msg.includes('not found') || msg.includes('Not found');
}

/** Check if error is retryable (rate limit or transient not found). */
export function isRetryableError(error: Error): boolean {
  return isRateLimitError(error) || isNotFoundError(error);
}
