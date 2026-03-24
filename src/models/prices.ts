/** Nirvana token prices. */
export interface NirvanaPrices {
  /** Current ANA token price. */
  readonly ana: number;
  /** Floor price (from PriceCurve2). */
  readonly floor: number;
  /** prANA price (derived: ana - floor). */
  readonly prana: number;
  /** When the prices were fetched. */
  readonly updatedAt: Date;
}
