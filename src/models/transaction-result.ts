/** Result of a blockchain transaction. */
export interface TransactionResult {
  readonly success: boolean;
  readonly signature: string;
  readonly error?: string;
  readonly logs: string[];
}

/** Create a successful transaction result. */
export function txSuccess(signature: string, logs: string[] = []): TransactionResult {
  return { success: true, signature, logs };
}

/** Create a failed transaction result. */
export function txFailure(signature: string, error: string, logs: string[] = []): TransactionResult {
  return { success: false, signature, error, logs };
}
