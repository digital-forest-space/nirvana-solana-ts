import { address, type Address, type Instruction, AccountRole } from '@solana/kit';
import { type NirvanaConfig, NIRVANA_MAINNET_CONFIG } from '../models/config.js';
import { NirvanaDiscriminators } from './discriminators.js';
import { writeU64LE } from '../utils/bytes.js';

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/**
 * Builds raw Solana instructions for the Nirvana V2 protocol.
 *
 * Each method returns an {@link Instruction} that can be added to a
 * transaction message. No signing or sending is performed here.
 */
export class NirvanaTransactionBuilder {
  private readonly config: NirvanaConfig;

  constructor(config: NirvanaConfig = NIRVANA_MAINNET_CONFIG) {
    this.config = config;
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private programAddress(): Address {
    return address(this.config.programId);
  }

  // ── 1. Buy Exact 2 ──────────────────────────────────────────────────

  /**
   * Build a `buy_exact2` instruction.
   *
   * @param user          - Wallet / fee-payer (signer, writable)
   * @param paymentSource - User's USDC (or NIRV) token account
   * @param userAna       - User's ANA token account
   * @param amount        - USDC amount in lamports (u64)
   * @param minAna        - Minimum ANA to receive (u64, slippage guard)
   */
  buildBuyExact2Instruction(
    user: string,
    paymentSource: string,
    userAna: string,
    amount: bigint,
    minAna: bigint,
  ): Instruction {
    const data = new Uint8Array(8 + 8 + 8);
    data.set(NirvanaDiscriminators.buyExact2, 0);
    writeU64LE(data, amount, 8);
    writeU64LE(data, minAna, 16);

    return {
      programAddress: this.programAddress(),
      accounts: [
        { address: address(user), role: AccountRole.WRITABLE_SIGNER },
        { address: address(this.config.tenantAccount), role: AccountRole.WRITABLE },
        { address: address(this.config.priceCurve), role: AccountRole.READONLY },
        { address: address(this.config.anaMint), role: AccountRole.WRITABLE },
        { address: address(this.config.nirvMint), role: AccountRole.WRITABLE },
        { address: address(this.config.usdcMint), role: AccountRole.READONLY },
        { address: address(this.config.tenantUsdcVault), role: AccountRole.WRITABLE },
        { address: address(this.config.tenantAnaVault), role: AccountRole.WRITABLE },
        { address: address(this.config.escrowRevNirv), role: AccountRole.WRITABLE },
        { address: address(paymentSource), role: AccountRole.WRITABLE },
        { address: address(userAna), role: AccountRole.WRITABLE },
        { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
        { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
      ],
      data,
    };
  }

  // ── 2. Sell ──────────────────────────────────────────────────────────

  /**
   * Build a `sell2` instruction.
   *
   * @param user      - Wallet / fee-payer (signer, writable)
   * @param userDest  - User's USDC destination token account
   * @param userAna   - User's ANA token account
   * @param anaAmount - ANA amount to sell (u64)
   * @param minOutput - Minimum output (u64, slippage guard)
   */
  buildSellInstruction(
    user: string,
    userDest: string,
    userAna: string,
    anaAmount: bigint,
    minOutput: bigint,
  ): Instruction {
    const data = new Uint8Array(8 + 8 + 8);
    data.set(NirvanaDiscriminators.sell2, 0);
    writeU64LE(data, anaAmount, 8);
    writeU64LE(data, minOutput, 16);

    return {
      programAddress: this.programAddress(),
      accounts: [
        { address: address(user), role: AccountRole.WRITABLE_SIGNER },
        { address: address(this.config.tenantAccount), role: AccountRole.WRITABLE },
        { address: address(this.config.priceCurve), role: AccountRole.WRITABLE },
        { address: address(this.config.anaMint), role: AccountRole.WRITABLE },
        { address: address(userDest), role: AccountRole.WRITABLE },
        { address: address(this.config.escrowRevNirv), role: AccountRole.WRITABLE },
        { address: address(this.config.tenantUsdcVault), role: AccountRole.WRITABLE },
        { address: address(this.config.tenantAnaVault), role: AccountRole.WRITABLE },
        { address: address(userAna), role: AccountRole.WRITABLE },
        { address: address(this.config.nirvMint), role: AccountRole.READONLY },
        { address: address(this.config.usdcMint), role: AccountRole.READONLY },
        { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
        { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
      ],
      data,
    };
  }

  // ── 3. Deposit ANA ──────────────────────────────────────────────────

  /**
   * Build a `deposit_ana` instruction (stake ANA).
   *
   * @param user            - Wallet / fee-payer (signer, writable)
   * @param personalAccount - User's personal account PDA
   * @param userAna         - User's ANA token account
   * @param amount          - ANA amount to deposit (u64)
   */
  buildDepositAnaInstruction(
    user: string,
    personalAccount: string,
    userAna: string,
    amount: bigint,
  ): Instruction {
    const vaultAnaAccount = 'GUEs3s1j1gvQ2F7xMXh6vHnB5t1bQG4zev1qEfWJKEea';

    const data = new Uint8Array(8 + 8);
    data.set(NirvanaDiscriminators.depositAna, 0);
    writeU64LE(data, amount, 8);

    return {
      programAddress: this.programAddress(),
      accounts: [
        { address: address(user), role: AccountRole.WRITABLE_SIGNER },
        { address: address(this.config.tenantAccount), role: AccountRole.WRITABLE },
        { address: address(personalAccount), role: AccountRole.WRITABLE },
        { address: address(userAna), role: AccountRole.WRITABLE },
        { address: address(vaultAnaAccount), role: AccountRole.WRITABLE },
        { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
      ],
      data,
    };
  }

  // ── 4. Withdraw ANA ─────────────────────────────────────────────────

  /**
   * Build a `withdraw_ana` instruction (unstake ANA).
   *
   * @param user            - Wallet / fee-payer (signer, writable)
   * @param personalAccount - User's personal account PDA
   * @param userAna         - User's ANA token account
   * @param amount          - ANA amount to withdraw (u64)
   */
  buildWithdrawAnaInstruction(
    user: string,
    personalAccount: string,
    userAna: string,
    amount: bigint,
  ): Instruction {
    const vaultAnaAccount = 'GUEs3s1j1gvQ2F7xMXh6vHnB5t1bQG4zev1qEfWJKEea';

    const data = new Uint8Array(8 + 8);
    data.set(NirvanaDiscriminators.withdrawAna, 0);
    writeU64LE(data, amount, 8);

    return {
      programAddress: this.programAddress(),
      accounts: [
        { address: address(user), role: AccountRole.WRITABLE_SIGNER },
        { address: address(this.config.tenantAccount), role: AccountRole.WRITABLE },
        { address: address(personalAccount), role: AccountRole.WRITABLE },
        { address: address(userAna), role: AccountRole.WRITABLE },
        { address: address(this.config.escrowRevNirv), role: AccountRole.WRITABLE },
        { address: address(vaultAnaAccount), role: AccountRole.WRITABLE },
        { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
      ],
      data,
    };
  }

  // ── 5. Init Personal Account ────────────────────────────────────────

  /**
   * Build an `init_personal_account` instruction.
   *
   * @param user            - Wallet / fee-payer (signer, writable)
   * @param personalAccount - PDA for the new personal account (writable)
   */
  buildInitPersonalAccountInstruction(
    user: string,
    personalAccount: string,
  ): Instruction {
    const systemProgram = '11111111111111111111111111111111';

    const data = new Uint8Array(8);
    data.set(NirvanaDiscriminators.initPersonalAccount, 0);

    return {
      programAddress: this.programAddress(),
      accounts: [
        { address: address(user), role: AccountRole.WRITABLE_SIGNER },
        { address: address(this.config.tenantAccount), role: AccountRole.READONLY },
        { address: address(user), role: AccountRole.READONLY },
        { address: address(personalAccount), role: AccountRole.WRITABLE },
        { address: address(systemProgram), role: AccountRole.READONLY },
      ],
      data,
    };
  }

  // ── 6. Borrow NIRV ──────────────────────────────────────────────────

  /**
   * Build a `borrow_nirv` instruction.
   *
   * @param user            - Wallet / fee-payer (signer, writable)
   * @param personalAccount - User's personal account PDA
   * @param userNirv        - User's NIRV token account
   * @param amount          - NIRV amount to borrow (u64)
   */
  buildBorrowNirvInstruction(
    user: string,
    personalAccount: string,
    userNirv: string,
    amount: bigint,
  ): Instruction {
    const escrowNirvAccount = 'v2EeX2VjgsMbwokj6UDmAm691oePzrcvKpK5DT7LwbQ';

    const data = new Uint8Array(8 + 8);
    data.set(NirvanaDiscriminators.borrowNirv, 0);
    writeU64LE(data, amount, 8);

    return {
      programAddress: this.programAddress(),
      accounts: [
        { address: address(user), role: AccountRole.WRITABLE_SIGNER },
        { address: address(this.config.tenantAccount), role: AccountRole.WRITABLE },
        { address: address(personalAccount), role: AccountRole.WRITABLE },
        { address: address(userNirv), role: AccountRole.WRITABLE },
        { address: address(this.config.nirvMint), role: AccountRole.WRITABLE },
        { address: address(escrowNirvAccount), role: AccountRole.WRITABLE },
        { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
      ],
      data,
    };
  }

  // ── 7. Realize ──────────────────────────────────────────────────────

  /**
   * Build a `realize` instruction (convert prANA to ANA).
   *
   * @param user          - Wallet / fee-payer (signer, writable)
   * @param paymentSource - User's USDC (or NIRV) token account
   * @param userPrana     - User's prANA token account
   * @param userAna       - User's ANA token account
   * @param pranaAmount   - prANA amount to realize (u64)
   */
  buildRealizeInstruction(
    user: string,
    paymentSource: string,
    userPrana: string,
    userAna: string,
    pranaAmount: bigint,
  ): Instruction {
    const data = new Uint8Array(8 + 8);
    data.set(NirvanaDiscriminators.realize, 0);
    writeU64LE(data, pranaAmount, 8);

    return {
      programAddress: this.programAddress(),
      accounts: [
        { address: address(user), role: AccountRole.WRITABLE_SIGNER },
        { address: address(this.config.tenantAccount), role: AccountRole.WRITABLE },
        { address: address(this.config.priceCurve), role: AccountRole.WRITABLE },
        { address: address(this.config.anaMint), role: AccountRole.WRITABLE },
        { address: address(this.config.usdcMint), role: AccountRole.READONLY },
        { address: address(this.config.nirvMint), role: AccountRole.WRITABLE },
        { address: address(this.config.pranaMint), role: AccountRole.WRITABLE },
        { address: address(paymentSource), role: AccountRole.WRITABLE },
        { address: address(userPrana), role: AccountRole.WRITABLE },
        { address: address(userAna), role: AccountRole.WRITABLE },
        { address: address(this.config.escrowRevNirv), role: AccountRole.WRITABLE },
        { address: address(this.config.tenantUsdcVault), role: AccountRole.WRITABLE },
        { address: address(this.config.tenantAnaVault), role: AccountRole.WRITABLE },
        { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
        { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
      ],
      data,
    };
  }

  // ── 8. Repay ────────────────────────────────────────────────────────

  /**
   * Build a `repay` instruction (burn NIRV to reduce debt).
   *
   * @param user            - Wallet / fee-payer (signer, writable)
   * @param personalAccount - User's personal account PDA
   * @param userNirv        - User's NIRV token account
   * @param amount          - NIRV amount to repay (u64)
   */
  buildRepayInstruction(
    user: string,
    personalAccount: string,
    userNirv: string,
    amount: bigint,
  ): Instruction {
    const data = new Uint8Array(8 + 8);
    data.set(NirvanaDiscriminators.repay, 0);
    writeU64LE(data, amount, 8);

    return {
      programAddress: this.programAddress(),
      accounts: [
        { address: address(user), role: AccountRole.WRITABLE_SIGNER },
        { address: address(this.config.tenantAccount), role: AccountRole.WRITABLE },
        { address: address(personalAccount), role: AccountRole.WRITABLE },
        { address: address(userNirv), role: AccountRole.WRITABLE },
        { address: address(this.config.nirvMint), role: AccountRole.WRITABLE },
        { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
      ],
      data,
    };
  }

  // ── 9. Refresh Price Curve ──────────────────────────────────────────

  /**
   * Build a `refresh_price_curve` instruction.
   *
   * @param timestamp - Unix timestamp (u64)
   */
  buildRefreshPriceCurveInstruction(timestamp: bigint): Instruction {
    const data = new Uint8Array(8 + 8 + 1);
    data.set(NirvanaDiscriminators.refreshPriceCurve, 0);
    writeU64LE(data, timestamp, 8);
    data[16] = 0x01;

    return {
      programAddress: this.programAddress(),
      accounts: [
        { address: address(this.config.tenantAccount), role: AccountRole.WRITABLE },
        { address: address(this.config.anaMint), role: AccountRole.READONLY },
        { address: address(this.config.priceCurve), role: AccountRole.WRITABLE },
      ],
      data,
    };
  }

  // ── 10. Refresh Personal Account ────────────────────────────────────

  /**
   * Build a `refresh_personal_account` instruction.
   *
   * @param personalAccount - User's personal account PDA
   */
  buildRefreshPersonalAccountInstruction(
    personalAccount: string,
  ): Instruction {
    const data = new Uint8Array(8);
    data.set(NirvanaDiscriminators.refreshPersonalAccount, 0);

    return {
      programAddress: this.programAddress(),
      accounts: [
        { address: address(this.config.tenantAccount), role: AccountRole.WRITABLE },
        { address: address(personalAccount), role: AccountRole.WRITABLE },
      ],
      data,
    };
  }

  // ── 11. Claim prANA ─────────────────────────────────────────────────

  /**
   * Build a `claim_prana` instruction.
   *
   * @param user            - Wallet / fee-payer (signer, writable)
   * @param userPrana       - User's prANA token account
   * @param personalAccount - User's personal account PDA
   */
  buildClaimPranaInstruction(
    user: string,
    userPrana: string,
    personalAccount: string,
  ): Instruction {
    const data = new Uint8Array(8);
    data.set(NirvanaDiscriminators.claimPrana, 0);

    return {
      programAddress: this.programAddress(),
      accounts: [
        { address: address(user), role: AccountRole.WRITABLE_SIGNER },
        { address: address(this.config.tenantAccount), role: AccountRole.WRITABLE },
        { address: address(this.config.pranaMint), role: AccountRole.WRITABLE },
        { address: address(userPrana), role: AccountRole.WRITABLE },
        { address: address(personalAccount), role: AccountRole.WRITABLE },
        { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
      ],
      data,
    };
  }

  // ── 12. Claim Revenue Share ─────────────────────────────────────────

  /**
   * Build a `claim_revenue_share` instruction.
   *
   * @param user            - Wallet / fee-payer (signer, writable)
   * @param personalAccount - User's personal account PDA
   * @param userAna         - User's ANA token account
   * @param userNirv        - User's NIRV token account
   */
  buildClaimRevenueShareInstruction(
    user: string,
    personalAccount: string,
    userAna: string,
    userNirv: string,
  ): Instruction {
    const data = new Uint8Array(8);
    data.set(NirvanaDiscriminators.claimRevenueShare, 0);

    return {
      programAddress: this.programAddress(),
      accounts: [
        { address: address(user), role: AccountRole.WRITABLE_SIGNER },
        { address: address(personalAccount), role: AccountRole.WRITABLE },
        { address: address(this.config.tenantAccount), role: AccountRole.WRITABLE },
        { address: address(this.config.escrowNirvAccount), role: AccountRole.WRITABLE },
        { address: address(this.config.escrowRevNirv), role: AccountRole.WRITABLE },
        { address: address(userAna), role: AccountRole.WRITABLE },
        { address: address(userNirv), role: AccountRole.WRITABLE },
        { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
      ],
      data,
    };
  }
}
