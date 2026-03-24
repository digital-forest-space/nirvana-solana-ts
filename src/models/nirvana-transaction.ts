/** Types of Nirvana protocol transactions. */
export type NirvanaTransactionType =
  | 'buy'
  | 'sell'
  | 'stake'
  | 'unstake'
  | 'borrow'
  | 'repay'
  | 'realize'
  | 'claimPrana'
  | 'claimRevenueShare'
  | 'unknown';

/** Represents a token amount with currency. */
export interface TokenAmount {
  readonly amount: number;
  readonly currency: string;
}

/** Parsed information about a Nirvana protocol transaction. */
export interface NirvanaTransaction {
  readonly signature: string;
  readonly type: NirvanaTransactionType;
  /** Tokens received (list for multi-token receives, e.g., realize). */
  readonly received: TokenAmount[];
  /** Tokens sent (list for multi-token sends, e.g., realize burns prANA + pays NIRV/USDC). */
  readonly sent: TokenAmount[];
  readonly fee?: TokenAmount;
  readonly timestamp: Date;
  readonly userAddress: string;
}

/** Calculate price per ANA if applicable for the transaction type. */
export function pricePerAna(tx: NirvanaTransaction): number | undefined {
  if (tx.type === 'buy' && tx.received.length > 0 && tx.sent.length > 0) {
    const anaReceived = tx.received.find((t) => t.currency === 'ANA');
    const payment = tx.sent[0];
    if (anaReceived && payment && anaReceived.amount > 0) {
      return payment.amount / anaReceived.amount;
    }
  }
  if (tx.type === 'sell' && tx.received.length > 0 && tx.sent.length > 0) {
    const anaSent = tx.sent.find((t) => t.currency === 'ANA');
    const payment = tx.received[0];
    if (anaSent && payment && anaSent.amount > 0) {
      return payment.amount / anaSent.amount;
    }
  }
  if (tx.type === 'realize' && tx.received.length > 0 && tx.sent.length > 0) {
    const anaReceived = tx.received.find((t) => t.currency === 'ANA');
    const payment = tx.sent.find((t) => t.currency === 'NIRV' || t.currency === 'USDC');
    if (anaReceived && payment && anaReceived.amount > 0) {
      return payment.amount / anaReceived.amount;
    }
  }
  return undefined;
}
