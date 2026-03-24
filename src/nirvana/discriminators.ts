/**
 * Anchor instruction discriminators for the Nirvana V2 protocol.
 *
 * Each discriminator is the first 8 bytes of `sha256('global:<instruction_name>')`.
 * They are used as the instruction identifier prefix in Solana transaction data.
 */
export const NirvanaDiscriminators = {
  /** `buy_exact2` — Buy ANA with USDC or NIRV. */
  buyExact2: new Uint8Array([109, 5, 199, 243, 164, 233, 19, 152]),

  /** `sell2` — Sell ANA for USDC or NIRV. */
  sell2: new Uint8Array([47, 191, 120, 1, 28, 35, 253, 79]),

  /** `deposit_ana` — Stake ANA into the protocol. */
  depositAna: new Uint8Array([68, 100, 197, 87, 22, 85, 190, 78]),

  /** `withdraw_ana` — Unstake ANA from the protocol. */
  withdrawAna: new Uint8Array([93, 87, 203, 252, 78, 187, 97, 82]),

  /** `init_personal_account` — Create a user's personal account PDA. */
  initPersonalAccount: new Uint8Array([104, 99, 107, 177, 104, 196, 189, 188]),

  /** `borrow_nirv` — Borrow NIRV against staked ANA. */
  borrowNirv: new Uint8Array([155, 1, 43, 62, 79, 104, 66, 42]),

  /** `realize` — Convert prANA to ANA by paying USDC or NIRV. */
  realize: new Uint8Array([64, 34, 113, 17, 141, 79, 61, 38]),

  /** `repay` — Repay NIRV debt by burning NIRV. */
  repay: new Uint8Array([28, 158, 130, 191, 125, 127, 195, 94]),

  /** `refresh_price_curve` — Update protocol price state. */
  refreshPriceCurve: new Uint8Array([205, 200, 207, 206, 57, 131, 162, 126]),

  /** `refresh_personal_account` — Sync accrued prANA rewards. */
  refreshPersonalAccount: new Uint8Array([54, 112, 82, 14, 216, 131, 165, 126]),

  /** `claim_prana` — Claim accumulated prANA rewards. */
  claimPrana: new Uint8Array([47, 124, 203, 241, 4, 53, 226, 166]),

  /** `claim_revenue_share` — Claim accumulated ANA + NIRV revenue. */
  claimRevenueShare: new Uint8Array([69, 140, 105, 250, 40, 226, 233, 116]),

  /** `stage_rev_prana` — Stage revenue prANA for claiming. */
  stageRevPrana: new Uint8Array([66, 99, 75, 75, 81, 176, 254, 169]),

  // ── Account discriminators ─────────────────────────────────────────

  /** Tenant account discriminator — identifies Nirvana tenant accounts. */
  tenant: new Uint8Array([61, 43, 215, 51, 232, 242, 209, 170]),
} as const;

/** All Nirvana V2 protocol discriminators keyed by instruction name. */
export const NIRVANA_DISCRIMINATOR_MAP: Record<string, Uint8Array> = {
  buy_exact2: NirvanaDiscriminators.buyExact2,
  sell2: NirvanaDiscriminators.sell2,
  deposit_ana: NirvanaDiscriminators.depositAna,
  withdraw_ana: NirvanaDiscriminators.withdrawAna,
  init_personal_account: NirvanaDiscriminators.initPersonalAccount,
  borrow_nirv: NirvanaDiscriminators.borrowNirv,
  realize: NirvanaDiscriminators.realize,
  repay: NirvanaDiscriminators.repay,
  refresh_price_curve: NirvanaDiscriminators.refreshPriceCurve,
  refresh_personal_account: NirvanaDiscriminators.refreshPersonalAccount,
  claim_prana: NirvanaDiscriminators.claimPrana,
  claim_revenue_share: NirvanaDiscriminators.claimRevenueShare,
  stage_rev_prana: NirvanaDiscriminators.stageRevPrana,
};
