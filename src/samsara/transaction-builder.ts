/**
 * SamsaraTransactionBuilder — constructs low-level Solana instructions for the
 * Samsara / Mayflower protocol, ported from the Dart implementation.
 *
 * Every public method returns an `Instruction` that can be fed directly into
 * a @solana/kit transaction message.
 */
import { address, type Address, type Instruction, AccountRole } from '@solana/kit';
import type { SamsaraConfig, NavTokenMarket } from './config.js';
import { SamsaraDiscriminators } from './discriminators.js';
import { writeU64LE, writeU32LE } from '../utils/bytes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand for a writable signer account meta. */
function wSigner(addr: string): { address: Address; role: AccountRole } {
  return { address: address(addr), role: AccountRole.WRITABLE_SIGNER };
}

/** Shorthand for a writable (non-signer) account meta. */
function w(addr: string): { address: Address; role: AccountRole } {
  return { address: address(addr), role: AccountRole.WRITABLE };
}

/** Shorthand for a readonly account meta. */
function r(addr: string): { address: Address; role: AccountRole } {
  return { address: address(addr), role: AccountRole.READONLY };
}

/** Shorthand for a readonly signer account meta. */
function rSigner(addr: string): { address: Address; role: AccountRole } {
  return { address: address(addr), role: AccountRole.READONLY_SIGNER };
}

/**
 * Build instruction data consisting of an 8-byte discriminator followed by a
 * single u64 argument.
 */
function discAndU64(disc: Uint8Array, value: bigint): Uint8Array {
  const data = new Uint8Array(8 + 8);
  data.set(disc, 0);
  writeU64LE(data, value, 8);
  return data;
}

/**
 * Build instruction data consisting of an 8-byte discriminator followed by
 * two u64 arguments.
 */
function discAndTwoU64(disc: Uint8Array, a: bigint, b: bigint): Uint8Array {
  const data = new Uint8Array(8 + 8 + 8);
  data.set(disc, 0);
  writeU64LE(data, a, 8);
  writeU64LE(data, b, 16);
  return data;
}

// ---------------------------------------------------------------------------
// SamsaraTransactionBuilder
// ---------------------------------------------------------------------------

export class SamsaraTransactionBuilder {
  readonly config: SamsaraConfig;

  constructor(config: SamsaraConfig) {
    this.config = config;
  }

  // -----------------------------------------------------------------------
  // 1. Init Position
  // -----------------------------------------------------------------------

  /**
   * Build an `init_personal_position` instruction (Mayflower program).
   *
   * @param user          Wallet address (signer)
   * @param market        NavTokenMarket configuration
   * @param personalPosition  PDA for the user's personal position
   * @param userShares    PDA for the user's position escrow (shares)
   * @param logAccount    Mayflower log PDA
   */
  buildInitPositionInstruction(
    user: string,
    market: NavTokenMarket,
    personalPosition: string,
    userShares: string,
    logAccount: string,
  ): Instruction {
    return {
      programAddress: address(this.config.mayflowerProgramId),
      accounts: [
        wSigner(user),
        r(user),
        r(market.marketMetadata),
        r(market.navMint),
        w(personalPosition),
        w(userShares),
        r(this.config.tokenProgram),
        r(this.config.systemProgram),
        w(logAccount),
        r(this.config.mayflowerProgramId),
      ],
      data: SamsaraDiscriminators.initPersonalPosition,
    };
  }

  // -----------------------------------------------------------------------
  // 2. Buy navToken (SOL variant)
  // -----------------------------------------------------------------------

  /**
   * Build a `buy` instruction (Mayflower program).
   *
   * @param user            Wallet address (signer)
   * @param market          NavTokenMarket configuration
   * @param personalPosition PDA for the user's personal position
   * @param userShares      User's position escrow (shares) token account
   * @param userNavSol      User's navToken ATA
   * @param userWsol        User's wrapped SOL ATA
   * @param logAccount      Mayflower log PDA
   * @param inputAmount     Amount of base token to spend (lamports)
   * @param minOutput       Minimum navToken to receive (lamports)
   */
  buildBuyNavSolInstruction(
    user: string,
    market: NavTokenMarket,
    personalPosition: string,
    userShares: string,
    userNavSol: string,
    userWsol: string,
    logAccount: string,
    inputAmount: bigint,
    minOutput: bigint,
  ): Instruction {
    return {
      programAddress: address(this.config.mayflowerProgramId),
      accounts: [
        wSigner(user),
        r(this.config.mayflowerTenant),
        r(market.marketGroup),
        r(market.marketMetadata),
        w(market.mayflowerMarket),
        w(personalPosition),
        w(userShares),
        w(market.navMint),
        r(market.baseMint),
        w(userNavSol),
        w(userWsol),
        w(market.marketSolVault),
        w(market.marketNavVault),
        w(market.feeVault),
        r(this.config.tokenProgram),
        r(this.config.tokenProgram),
        w(logAccount),
        r(this.config.mayflowerProgramId),
      ],
      data: discAndTwoU64(SamsaraDiscriminators.buy, inputAmount, minOutput),
    };
  }

  // -----------------------------------------------------------------------
  // 3. Sell navToken (SOL variant)
  // -----------------------------------------------------------------------

  /**
   * Build a `sell` instruction (Mayflower program).
   *
   * @param user            Wallet address (signer)
   * @param market          NavTokenMarket configuration
   * @param personalPosition PDA for the user's personal position
   * @param userWsol        User's wrapped SOL ATA
   * @param userNavSol      User's navToken ATA
   * @param userShares      User's position escrow (shares) token account
   * @param logAccount      Mayflower log PDA
   * @param inputNav        Amount of navToken to sell (lamports)
   * @param minOutput       Minimum base token to receive (lamports)
   */
  buildSellNavSolInstruction(
    user: string,
    market: NavTokenMarket,
    personalPosition: string,
    userWsol: string,
    userNavSol: string,
    userShares: string,
    logAccount: string,
    inputNav: bigint,
    minOutput: bigint,
  ): Instruction {
    return {
      programAddress: address(this.config.mayflowerProgramId),
      accounts: [
        wSigner(user),
        r(this.config.mayflowerTenant),
        r(market.marketGroup),
        r(market.marketMetadata),
        w(market.mayflowerMarket),
        w(personalPosition),
        w(market.marketSolVault),
        w(market.marketNavVault),
        w(market.feeVault),
        w(market.navMint),
        r(market.baseMint),
        w(userWsol),
        w(userNavSol),
        w(userShares),
        r(this.config.tokenProgram),
        r(this.config.tokenProgram),
        w(logAccount),
        r(this.config.mayflowerProgramId),
      ],
      data: discAndTwoU64(SamsaraDiscriminators.sell, inputNav, minOutput),
    };
  }

  // -----------------------------------------------------------------------
  // 4. Compute Budget — set compute unit limit
  // -----------------------------------------------------------------------

  /**
   * Build a `SetComputeUnitLimit` instruction (ComputeBudget program).
   *
   * @param units  Maximum compute units for the transaction
   */
  buildSetComputeUnitLimitInstruction(units: number): Instruction {
    const data = new Uint8Array(1 + 4);
    data[0] = 2; // instruction type
    writeU32LE(data, units, 1);
    return {
      programAddress: address(this.config.computeBudgetProgram),
      accounts: [],
      data,
    };
  }

  // -----------------------------------------------------------------------
  // 5. Compute Budget — set compute unit price
  // -----------------------------------------------------------------------

  /**
   * Build a `SetComputeUnitPrice` instruction (ComputeBudget program).
   *
   * @param microLamports  Price per compute unit in micro-lamports
   */
  buildSetComputeUnitPriceInstruction(microLamports: bigint): Instruction {
    const data = new Uint8Array(1 + 8);
    data[0] = 3; // instruction type
    writeU64LE(data, microLamports, 1);
    return {
      programAddress: address(this.config.computeBudgetProgram),
      accounts: [],
      data,
    };
  }

  // -----------------------------------------------------------------------
  // 6. System Program — transfer
  // -----------------------------------------------------------------------

  /**
   * Build a `Transfer` instruction (System program).
   *
   * @param from      Source wallet (signer)
   * @param to        Destination address
   * @param lamports  Amount to transfer in lamports
   */
  buildTransferInstruction(
    from: string,
    to: string,
    lamports: bigint,
  ): Instruction {
    const data = new Uint8Array(4 + 8);
    writeU32LE(data, 2, 0); // instruction type
    writeU64LE(data, lamports, 4);
    return {
      programAddress: address(this.config.systemProgram),
      accounts: [wSigner(from), w(to)],
      data,
    };
  }

  // -----------------------------------------------------------------------
  // 7. Token Program — SyncNative
  // -----------------------------------------------------------------------

  /**
   * Build a `SyncNative` instruction (Token program).
   *
   * @param tokenAccount  The wrapped SOL token account to sync
   */
  buildSyncNativeInstruction(tokenAccount: string): Instruction {
    return {
      programAddress: address(this.config.tokenProgram),
      accounts: [w(tokenAccount)],
      data: new Uint8Array([17]),
    };
  }

  // -----------------------------------------------------------------------
  // 8. Token Program — CloseAccount
  // -----------------------------------------------------------------------

  /**
   * Build a `CloseAccount` instruction (Token program).
   *
   * @param account      Token account to close
   * @param destination  Destination for remaining SOL rent
   * @param owner        Owner of the token account (signer)
   */
  buildCloseAccountInstruction(
    account: string,
    destination: string,
    owner: string,
  ): Instruction {
    return {
      programAddress: address(this.config.tokenProgram),
      accounts: [w(account), w(destination), rSigner(owner)],
      data: new Uint8Array([9]),
    };
  }

  // -----------------------------------------------------------------------
  // 9. Init Gov Account (Samsara program)
  // -----------------------------------------------------------------------

  /**
   * Build an `init_gov_account` instruction (Samsara program).
   *
   * @param payer         Fee payer (signer)
   * @param owner         Owner of the governance account
   * @param market        NavTokenMarket configuration
   * @param pranaEscrow   PDA for the prANA escrow
   * @param govAccount    PDA for the governance account
   * @param logCounter    Samsara log counter PDA
   */
  buildInitGovAccountInstruction(
    payer: string,
    owner: string,
    market: NavTokenMarket,
    pranaEscrow: string,
    govAccount: string,
    logCounter: string,
  ): Instruction {
    return {
      programAddress: address(this.config.samsaraProgramId),
      accounts: [
        wSigner(payer),
        w(owner),
        r(this.config.samsaraTenant),
        r(this.config.pranaMint),
        r(market.samsaraMarket),
        w(pranaEscrow),
        w(govAccount),
        r(this.config.tokenProgram),
        r(this.config.systemProgram),
        w(logCounter),
        r(this.config.samsaraProgramId),
      ],
      data: SamsaraDiscriminators.initGovAccount,
    };
  }

  // -----------------------------------------------------------------------
  // 10. Deposit prANA (Samsara program)
  // -----------------------------------------------------------------------

  /**
   * Build a `deposit_prana` instruction (Samsara program).
   *
   * @param depositor     Depositor wallet (signer)
   * @param market        NavTokenMarket configuration
   * @param govAccount    PDA for the governance account
   * @param pranaSrc      Depositor's prANA token account
   * @param pranaEscrow   PDA for the prANA escrow
   * @param logCounter    Samsara log counter PDA
   * @param amount        Amount of prANA to deposit (lamports)
   */
  buildDepositPranaInstruction(
    depositor: string,
    market: NavTokenMarket,
    govAccount: string,
    pranaSrc: string,
    pranaEscrow: string,
    logCounter: string,
    amount: bigint,
  ): Instruction {
    return {
      programAddress: address(this.config.samsaraProgramId),
      accounts: [
        wSigner(depositor),
        r(this.config.samsaraTenant),
        w(market.samsaraMarket),
        w(govAccount),
        r(this.config.pranaMint),
        w(pranaSrc),
        w(pranaEscrow),
        r(this.config.tokenProgram),
        w(logCounter),
        r(this.config.samsaraProgramId),
      ],
      data: discAndU64(SamsaraDiscriminators.depositPrana, amount),
    };
  }

  // -----------------------------------------------------------------------
  // 11. Borrow (Mayflower program)
  // -----------------------------------------------------------------------

  /**
   * Build a `borrow` instruction (Mayflower program).
   *
   * @param user            Wallet address (signer)
   * @param market          NavTokenMarket configuration
   * @param userBaseToken   User's base token ATA
   * @param personalPosition PDA for the user's personal position
   * @param logAccount      Mayflower log PDA
   * @param amount          Amount to borrow (lamports)
   */
  buildBorrowInstruction(
    user: string,
    market: NavTokenMarket,
    userBaseToken: string,
    personalPosition: string,
    logAccount: string,
    amount: bigint,
  ): Instruction {
    return {
      programAddress: address(this.config.mayflowerProgramId),
      accounts: [
        wSigner(user),
        r(this.config.mayflowerTenant),
        r(market.marketGroup),
        r(market.marketMetadata),
        w(market.marketSolVault),
        w(market.marketNavVault),
        w(market.feeVault),
        r(market.baseMint),
        w(userBaseToken),
        w(market.mayflowerMarket),
        w(personalPosition),
        r(this.config.tokenProgram),
        w(logAccount),
        r(this.config.mayflowerProgramId),
      ],
      data: discAndU64(SamsaraDiscriminators.borrow, amount),
    };
  }

  // -----------------------------------------------------------------------
  // 12. Repay (Mayflower program)
  // -----------------------------------------------------------------------

  /**
   * Build a `repay` instruction (Mayflower program).
   *
   * @param user            Wallet address (signer)
   * @param market          NavTokenMarket configuration
   * @param personalPosition PDA for the user's personal position
   * @param userBaseToken   User's base token ATA
   * @param authorityPda    Market authority PDA
   * @param amount          Amount to repay (lamports)
   */
  buildRepayInstruction(
    user: string,
    market: NavTokenMarket,
    personalPosition: string,
    userBaseToken: string,
    authorityPda: string,
    amount: bigint,
  ): Instruction {
    return {
      programAddress: address(this.config.mayflowerProgramId),
      accounts: [
        wSigner(user),
        r(market.marketMetadata),
        w(market.mayflowerMarket),
        w(personalPosition),
        r(market.baseMint),
        w(userBaseToken),
        w(market.marketSolVault),
        r(this.config.tokenProgram),
        w(authorityPda),
        r(this.config.mayflowerProgramId),
      ],
      data: discAndU64(SamsaraDiscriminators.repay, amount),
    };
  }

  // -----------------------------------------------------------------------
  // 13. Deposit navToken (Mayflower program)
  // -----------------------------------------------------------------------

  /**
   * Build a `deposit` (navToken) instruction (Mayflower program).
   *
   * @param user            Wallet address (signer)
   * @param market          NavTokenMarket configuration
   * @param personalPosition PDA for the user's personal position
   * @param userShares      User's position escrow (shares) token account
   * @param userNavToken    User's navToken ATA
   * @param authorityPda    Market authority PDA
   * @param amount          Amount of navToken to deposit (lamports)
   */
  buildDepositNavTokenInstruction(
    user: string,
    market: NavTokenMarket,
    personalPosition: string,
    userShares: string,
    userNavToken: string,
    authorityPda: string,
    amount: bigint,
  ): Instruction {
    return {
      programAddress: address(this.config.mayflowerProgramId),
      accounts: [
        wSigner(user),
        r(market.marketMetadata),
        r(market.navMint),
        w(market.mayflowerMarket),
        w(personalPosition),
        w(userShares),
        w(userNavToken),
        r(this.config.tokenProgram),
        w(authorityPda),
        r(this.config.mayflowerProgramId),
      ],
      data: discAndU64(SamsaraDiscriminators.deposit, amount),
    };
  }

  // -----------------------------------------------------------------------
  // 14. Withdraw navToken (Mayflower program)
  // -----------------------------------------------------------------------

  /**
   * Build a `withdraw` (navToken) instruction (Mayflower program).
   *
   * Same account layout as deposit, different discriminator.
   *
   * @param user            Wallet address (signer)
   * @param market          NavTokenMarket configuration
   * @param personalPosition PDA for the user's personal position
   * @param userShares      User's position escrow (shares) token account
   * @param userNavToken    User's navToken ATA
   * @param authorityPda    Market authority PDA
   * @param amount          Amount of navToken to withdraw (lamports)
   */
  buildWithdrawNavTokenInstruction(
    user: string,
    market: NavTokenMarket,
    personalPosition: string,
    userShares: string,
    userNavToken: string,
    authorityPda: string,
    amount: bigint,
  ): Instruction {
    return {
      programAddress: address(this.config.mayflowerProgramId),
      accounts: [
        wSigner(user),
        r(market.marketMetadata),
        r(market.navMint),
        w(market.mayflowerMarket),
        w(personalPosition),
        w(userShares),
        w(userNavToken),
        r(this.config.tokenProgram),
        w(authorityPda),
        r(this.config.mayflowerProgramId),
      ],
      data: discAndU64(SamsaraDiscriminators.withdraw, amount),
    };
  }

  // -----------------------------------------------------------------------
  // 15. Collect Revenue prANA (Samsara program)
  // -----------------------------------------------------------------------

  /**
   * Build a `collect_rev_prana` instruction (Samsara program).
   *
   * @param user          Wallet address (signer)
   * @param market        NavTokenMarket configuration
   * @param govAccount    PDA for the governance account
   * @param cashEscrow    Market cash escrow PDA
   * @param cashDst       Destination token account for collected revenue
   * @param logCounter    Samsara log counter PDA
   */
  buildCollectRevPranaInstruction(
    user: string,
    market: NavTokenMarket,
    govAccount: string,
    cashEscrow: string,
    cashDst: string,
    logCounter: string,
  ): Instruction {
    return {
      programAddress: address(this.config.samsaraProgramId),
      accounts: [
        wSigner(user),
        w(market.samsaraMarket),
        w(govAccount),
        w(cashEscrow),
        w(cashDst),
        r(market.baseMint),
        r(this.config.tokenProgram),
        w(logCounter),
        r(this.config.samsaraProgramId),
      ],
      data: SamsaraDiscriminators.collectRevPrana,
    };
  }

  // -----------------------------------------------------------------------
  // 16. Create ATA (idempotent)
  // -----------------------------------------------------------------------

  /**
   * Build a `CreateIdempotent` instruction (Associated Token program).
   *
   * @param payer   Fee payer (signer)
   * @param ata     The associated token account address
   * @param owner   Owner of the ATA
   * @param mint    Token mint
   */
  buildCreateAtaIdempotentInstruction(
    payer: string,
    ata: string,
    owner: string,
    mint: string,
  ): Instruction {
    return {
      programAddress: address(this.config.associatedTokenProgram),
      accounts: [
        wSigner(payer),
        w(ata),
        r(owner),
        r(mint),
        r(this.config.systemProgram),
        r(this.config.tokenProgram),
      ],
      data: new Uint8Array([1]),
    };
  }
}
