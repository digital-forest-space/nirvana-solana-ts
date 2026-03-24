/** Status of the price lookup result. */
export type PriceResultStatus =
  /** Successfully found a buy/sell transaction with price. */
  | 'found'
  /** Reached the afterSignature limit — no new buy/sell transactions. Use cached price. */
  | 'reachedAfterLimit'
  /** Checked all transactions in batch but none were buy/sell. Page deeper with signature. */
  | 'limitReached'
  /** Network or RPC error occurred. */
  | 'error';

/** Result of looking up ANA price from a recent transaction. */
export interface TransactionPriceResult {
  /** The calculated price (defined when status === 'found'). */
  readonly price?: number;
  /**
   * Context-dependent signature:
   * - found: the buy/sell tx signature (for price caching)
   * - limitReached: the oldest checked signature (use as beforeSignature to page)
   * - reachedAfterLimit / error: undefined
   */
  readonly signature?: string;
  /**
   * The newest transaction signature that was checked (for checkpoint caching).
   * Use this as `afterSignature` on next fetch to skip already-parsed transactions.
   */
  readonly newestCheckedSignature?: string;
  /** Fee paid in the transaction. */
  readonly fee?: number;
  /** Currency used (USDC, NIRV). */
  readonly currency?: string;
  /** Status of the lookup. */
  readonly status: PriceResultStatus;
  /** Error message if status === 'error'. */
  readonly errorMessage?: string;
}

/** Whether a price was found. */
export function hasPrice(result: TransactionPriceResult): boolean {
  return result.status === 'found' && result.price != null;
}

/** Whether the app should use its cached price. */
export function shouldUseCached(result: TransactionPriceResult): boolean {
  return result.status === 'reachedAfterLimit';
}

/** Whether the app should retry with paging. */
export function shouldRetryWithPaging(result: TransactionPriceResult): boolean {
  return result.status === 'limitReached';
}
