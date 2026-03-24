/**
 * Anchor instruction discriminators for the Samsara / Mayflower protocol.
 *
 * Each discriminator is the first 8 bytes of `sha256('global:<instruction_name>')`.
 */
export const SamsaraDiscriminators = {
  /** `init_personal_position` — Create navToken personal position PDA. */
  initPersonalPosition: new Uint8Array([146, 163, 167, 48, 30, 216, 179, 88]),

  /** `buy` (BuyWithExactCashInAndDeposit) — Buy navToken with base token. */
  buy: new Uint8Array([30, 205, 124, 67, 20, 142, 236, 136]),

  /** `sell` (SellWithExactTokenIn) — Sell navToken for base token. */
  sell: new Uint8Array([223, 239, 212, 254, 255, 120, 53, 1]),

  /** `deposit_prana` — Deposit prANA to a market's govAccount. */
  depositPrana: new Uint8Array([167, 25, 30, 117, 67, 213, 8, 210]),

  /** `withdraw_prana` — Withdraw prANA from a market's govAccount. */
  withdrawPrana: new Uint8Array([82, 134, 30, 249, 3, 225, 239, 26]),

  /** `init_gov_account` — Initialize a user's govAccount for a market. */
  initGovAccount: new Uint8Array([16, 49, 201, 21, 187, 43, 241, 78]),

  /** `borrow` — Borrow base token from a Mayflower market against deposited prANA. */
  borrow: new Uint8Array([228, 253, 131, 202, 207, 116, 89, 18]),

  /** `repay` — Repay borrowed base token to a Mayflower market. */
  repay: new Uint8Array([234, 103, 67, 82, 208, 234, 219, 166]),

  /** `deposit` — Deposit navToken into personal position escrow. */
  deposit: new Uint8Array([242, 35, 198, 137, 82, 225, 242, 182]),

  /** `withdraw` — Withdraw navToken from personal position escrow. */
  withdraw: new Uint8Array([183, 18, 70, 156, 148, 109, 161, 34]),

  /** `collect_rev_prana` — Collect accumulated revenue from prANA deposits. */
  collectRevPrana: new Uint8Array([69, 140, 105, 250, 40, 226, 233, 116]),
} as const;

/** All Samsara / Mayflower discriminators keyed by instruction name. */
export const SAMSARA_DISCRIMINATOR_MAP: Record<string, Uint8Array> = {
  init_personal_position: SamsaraDiscriminators.initPersonalPosition,
  buy: SamsaraDiscriminators.buy,
  sell: SamsaraDiscriminators.sell,
  deposit_prana: SamsaraDiscriminators.depositPrana,
  withdraw_prana: SamsaraDiscriminators.withdrawPrana,
  init_gov_account: SamsaraDiscriminators.initGovAccount,
  borrow: SamsaraDiscriminators.borrow,
  repay: SamsaraDiscriminators.repay,
  deposit: SamsaraDiscriminators.deposit,
  withdraw: SamsaraDiscriminators.withdraw,
  collect_rev_prana: SamsaraDiscriminators.collectRevPrana,
};
