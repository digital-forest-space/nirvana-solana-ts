/** User's personal account information in Nirvana protocol. */
export interface PersonalAccountInfo {
  readonly address: string;
  readonly anaDebt: number;
  readonly stakedAna: number;
  readonly claimablePrana: number;
  readonly stakedPrana: number;
  /** Claimable ANA revenue share (from simulation). */
  readonly claimableAna?: number;
  /** Claimable NIRV revenue share (from simulation). */
  readonly claimableNirv?: number;
  readonly lastUpdated: Date;
}

/** Create a copy of PersonalAccountInfo with claimable revenue share values. */
export function withClaimableRevshare(
  info: PersonalAccountInfo,
  claimableAna: number,
  claimableNirv: number,
): PersonalAccountInfo {
  return { ...info, claimableAna, claimableNirv };
}
