/**
 * SamsaraClient — Client for fetching data from and building transactions for
 * the Samsara / Mayflower protocol (navTokens).
 *
 * Ported from the Dart implementation at nirvana_solana/lib/src/samsara/samsara_client.dart.
 */
import {
  address,
  getAddressDecoder,
  type Address,
  type Instruction,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  getTransactionEncoder,
  blockhash,
} from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';

import type { SolanaRpcClient, AccountInfo } from '../rpc/solana-rpc-client.js';
import {
  type SamsaraConfig,
  SAMSARA_MAINNET_CONFIG,
  type NavTokenMarket,
  NAV_TOKEN_MARKETS,
  WELL_KNOWN_MINTS,
} from './config.js';
import { SamsaraPda, MayflowerPda } from './pda.js';
import { SamsaraTransactionBuilder } from './transaction-builder.js';
import type { TransactionPriceResult } from '../models/transaction-price-result.js';
import {
  base64Decode,
  base64Encode,
  readU64LE,
  decodeRustDecimal,
  fromLamports,
  toLamports,
} from '../utils/bytes.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const PRANA_DECIMALS = 6;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Tracks which indices in the getMultipleAccounts result belong to a market. */
interface MarketSlice {
  market: NavTokenMarket;
  navAtaIndex: number;
  escrowIndex: number;
  baseAtaIndex: number | null;
  pranaEscrowIndex: number;
  govAccountIndex: number;
  personalPositionIndex: number;
}

/** Parsed fields from a MarketMeta on-chain account. */
interface ParsedMarketMeta {
  mayflowerMarket: string;
  marketMetadata: string;
  baseMint: string;
  navMint: string;
  marketGroup: string;
  baseVault: string;
  navVault: string;
  feeVault: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const addressDecoder = getAddressDecoder();

/** Decode base64 account data from an AccountInfo. Returns empty Uint8Array if null. */
function decodeAccountData(account: AccountInfo | null): Uint8Array {
  if (!account || !account.data) return new Uint8Array(0);
  return base64Decode(account.data);
}

/** Convert 32 raw bytes to a base58 address string. */
function bytesToAddress(bytes: Uint8Array): string {
  return addressDecoder.decode(bytes) as string;
}

/**
 * Parse an SPL token amount from raw account data.
 * SPL token account layout stores the amount as a u64 at byte offset 64.
 */
function parseTokenAmountFromAccountData(
  account: AccountInfo | null,
  decimals: number,
): number {
  if (!account || !account.data) return 0.0;

  const bytes = base64Decode(account.data);
  if (bytes.length < 72) return 0.0; // offset 64 + 8 bytes for u64

  const amount = readU64LE(bytes, 64);
  return fromLamports(amount, decimals);
}

/**
 * Parse deposited navToken shares from a PersonalPosition's raw account data.
 * PersonalPosition layout: u64 at byte offset 104.
 */
function parsePersonalPositionShares(
  account: AccountInfo | null,
  navDecimals: number,
): number {
  if (!account || !account.data) return 0.0;

  const bytes = base64Decode(account.data);
  if (bytes.length < 112) return 0.0;

  const sharesLamports = readU64LE(bytes, 104);
  return fromLamports(sharesLamports, navDecimals);
}

/**
 * Parse borrow debt from a PersonalPosition's raw account data.
 *
 * PersonalPosition layout (~120 bytes, Mayflower program):
 *   - Bytes 0-7: discriminator
 *   - Bytes 8-39: pubkey (field 1)
 *   - Bytes 40-71: pubkey (field 2)
 *   - Bytes 72-103: pubkey (field 3)
 *   - Bytes 104-111: u64 (deposited navToken shares)
 *   - Bytes 112-119: u64 (debt in base token lamports)
 */
function parsePersonalPositionDebt(
  account: AccountInfo | null,
  baseDecimals: number,
): number {
  if (!account || !account.data) return 0.0;

  const bytes = base64Decode(account.data);
  if (bytes.length < 120) return 0.0;

  const debtLamports = readU64LE(bytes, 112);
  return fromLamports(debtLamports, baseDecimals);
}

/** Parse SPL Mint decimals (u8 at byte offset 44). */
function parseMintDecimals(account: AccountInfo | null): number {
  if (!account || !account.data) return 9;

  const bytes = base64Decode(account.data);
  if (bytes.length < 45) return 9;
  return bytes[44];
}

/**
 * Parse floor price from a Mayflower Market account's raw data.
 * Floor price is a Rust Decimal at byte offset 104.
 */
function parseFloorPriceFromAccount(
  account: AccountInfo | null,
  market: NavTokenMarket,
): number {
  if (!account || !account.data) {
    throw new Error(
      `Mayflower Market account not found: ${market.mayflowerMarket}`,
    );
  }

  const bytes = base64Decode(account.data);
  const floorPriceOffset = 104;
  const decimalLength = 16;

  if (bytes.length < floorPriceOffset + decimalLength) {
    throw new Error(
      `Mayflower Market data too short: ${bytes.length} bytes, need at least ${floorPriceOffset + decimalLength}`,
    );
  }

  const floorPrice = decodeRustDecimal(bytes, floorPriceOffset);

  if (floorPrice <= 0 || floorPrice > 1000) {
    throw new Error(`${market.name} floor price out of range: ${floorPrice}`);
  }

  return floorPrice;
}

/**
 * Derive an associated token address using @solana-program/token's PDA derivation.
 */
async function deriveAta(owner: string, mint: string): Promise<string> {
  const [ata] = await findAssociatedTokenPda({
    owner: address(owner),
    mint: address(mint),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  return ata as string;
}

/**
 * Build a serialized unsigned transaction (with null signatures) from instructions.
 *
 * Uses the @solana/kit functional transaction API:
 * createTransactionMessage -> set fee payer -> set blockhash -> append instructions -> compile
 *
 * The compiled transaction has null signatures for all signers, which the
 * getTransactionEncoder encodes as 64 zero-bytes per signer.
 */
function buildUnsignedTransactionBytes(options: {
  instructions: Instruction[];
  feePayer: string;
  recentBlockhash: string;
}): Uint8Array {
  const { instructions, feePayer, recentBlockhash } = options;

  // Build the transaction message using functional composition
  const txMessage = appendTransactionMessageInstructions(
    instructions,
    setTransactionMessageLifetimeUsingBlockhash(
      {
        blockhash: blockhash(recentBlockhash),
        lastValidBlockHeight: BigInt(Number.MAX_SAFE_INTEGER),
      },
      setTransactionMessageFeePayer(
        address(feePayer),
        createTransactionMessage({ version: 0 }),
      ),
    ),
  );

  // Compile to a Transaction object (messageBytes + signatures map with null values)
  const compiled = compileTransaction(txMessage as Parameters<typeof compileTransaction>[0]);

  // Encode the full transaction (compact-array of signatures + message bytes)
  const encoder = getTransactionEncoder();
  return new Uint8Array(encoder.encode(compiled));
}

// ---------------------------------------------------------------------------
// SamsaraClient
// ---------------------------------------------------------------------------

/** Client for fetching data from and building transactions for Samsara protocol (navTokens). */
export class SamsaraClient {
  private readonly _rpcClient: SolanaRpcClient;
  private readonly _config: SamsaraConfig;

  constructor(options: {
    rpcClient: SolanaRpcClient;
    config?: SamsaraConfig;
  }) {
    this._rpcClient = options.rpcClient;
    this._config = options.config ?? SAMSARA_MAINNET_CONFIG;
  }

  /** Create a SamsaraClient from an existing RPC client. */
  static fromRpcClient(
    rpcClient: SolanaRpcClient,
    config?: SamsaraConfig,
  ): SamsaraClient {
    return new SamsaraClient({ rpcClient, config });
  }

  // -----------------------------------------------------------------------
  // Balance Fetching
  // -----------------------------------------------------------------------

  /**
   * Fetches the user's navToken balances (wallet + staked), base token
   * balance, deposited prANA, unclaimed rewards, and debt for a market
   * using a single batched RPC call.
   *
   * Returns a map with keys:
   *   - `'{name}'` (e.g., `'navSOL'`): unstaked navToken in user's wallet
   *   - `'{name}_deposited'`: navToken deposited in the Mayflower escrow
   *   - `'{baseName}'` (e.g., `'SOL'`): user's base token balance
   *   - `'prANA_deposited'`: prANA deposited in this market's gov account
   *   - `'rewards_unclaimed'`: unclaimed revenue in base token units
   *   - `'debt'`: borrowed base token debt
   *
   * Balances are in human-readable units (e.g., 1.5 SOL, not lamports).
   */
  async fetchMarketBalances(options: {
    userPubkey: string;
    market: NavTokenMarket;
    batchSize?: number;
  }): Promise<Record<string, number>> {
    const { userPubkey, market, batchSize = 30 } = options;

    const mayflowerPda = new MayflowerPda(this._config.mayflowerProgramId);
    const samsaraPda = new SamsaraPda(this._config.samsaraProgramId);

    // Derive all addresses locally (pure PDA math, no RPC)
    const navAta = await deriveAta(userPubkey, market.navMint);

    const personalPositionKey = await mayflowerPda.personalPosition(
      market.marketMetadata,
      userPubkey,
    );
    const escrow = await mayflowerPda.personalPositionEscrow(
      personalPositionKey as string,
    );
    const personalPosition = personalPositionKey as string;

    // Derive Samsara gov account and prANA escrow
    const govAccountKey = await samsaraPda.personalGovAccount(
      market.samsaraMarket,
      userPubkey,
    );
    const pranaEscrow = await samsaraPda.personalGovPranaEscrow(
      govAccountKey as string,
    );
    const govAccount = govAccountKey as string;

    const isNativeSol = market.baseMint === NATIVE_SOL_MINT;

    // Build account list for batch fetch
    const addresses: string[] = [userPubkey, navAta, escrow as string];
    let baseAtaIdx: number | null = null;
    if (!isNativeSol) {
      const baseAta = await deriveAta(userPubkey, market.baseMint);
      baseAtaIdx = addresses.length;
      addresses.push(baseAta);
    }
    const pranaEscrowIdx = addresses.length;
    addresses.push(pranaEscrow as string);
    const govAccountIdx = addresses.length;
    addresses.push(govAccount);
    const personalPositionIdx = addresses.length;
    addresses.push(personalPosition);

    // Single batched RPC call
    const accounts = await this._rpcClient.getMultipleAccounts(addresses, {
      batchSize,
    });

    // Parse results
    const walletAccount = accounts[0];
    const navAtaAccount = accounts[1];
    const escrowAccount = accounts[2];

    // Base token balance
    let baseBalance: number;
    if (isNativeSol) {
      const lamports = walletAccount?.lamports ?? 0;
      baseBalance = lamports / 10 ** market.baseDecimals;
    } else {
      const baseAtaAccount = accounts[baseAtaIdx!];
      baseBalance = parseTokenAmountFromAccountData(
        baseAtaAccount,
        market.baseDecimals,
      );
    }

    return {
      [market.name]: parseTokenAmountFromAccountData(
        navAtaAccount,
        market.navDecimals,
      ),
      [`${market.name}_deposited`]: parseTokenAmountFromAccountData(
        escrowAccount,
        market.navDecimals,
      ),
      [market.baseName]: baseBalance,
      prANA_deposited: parseTokenAmountFromAccountData(
        accounts[pranaEscrowIdx],
        PRANA_DECIMALS,
      ),
      rewards_unclaimed: await this.getClaimableRewardsViaSimulation({
        userPubkey,
        market,
      }),
      debt: parsePersonalPositionDebt(
        accounts[personalPositionIdx],
        market.baseDecimals,
      ),
    };
  }

  /**
   * Fetches balances for all navToken markets in a single batched RPC call.
   *
   * Returns a map keyed by market name, where each value is the same
   * balance map returned by fetchMarketBalances.
   */
  async fetchAllMarketBalances(options: {
    userPubkey: string;
    markets?: NavTokenMarket[];
    batchSize?: number;
  }): Promise<Record<string, Record<string, number>>> {
    const {
      userPubkey,
      markets: marketsArg,
      batchSize = 30,
    } = options;
    const allMarkets = marketsArg ?? Object.values(NAV_TOKEN_MARKETS);

    const mayflowerPda = new MayflowerPda(this._config.mayflowerProgramId);
    const samsaraPda = new SamsaraPda(this._config.samsaraProgramId);

    // Derive all addresses locally for all markets
    const addresses: string[] = [userPubkey]; // wallet always first
    const marketSlices: MarketSlice[] = [];

    for (const market of allMarkets) {
      const startIndex = addresses.length;

      const navAta = await deriveAta(userPubkey, market.navMint);
      addresses.push(navAta); // +0

      const personalPositionKey = await mayflowerPda.personalPosition(
        market.marketMetadata,
        userPubkey,
      );
      const escrow = await mayflowerPda.personalPositionEscrow(
        personalPositionKey as string,
      );
      addresses.push(escrow as string); // +1

      let nextOffset = 2;
      let baseAtaOffset: number | null = null;
      if (market.baseMint !== NATIVE_SOL_MINT) {
        const baseAta = await deriveAta(userPubkey, market.baseMint);
        addresses.push(baseAta);
        baseAtaOffset = nextOffset;
        nextOffset++;
      }

      // Derive Samsara gov account and prANA escrow
      const govAccountKey = await samsaraPda.personalGovAccount(
        market.samsaraMarket,
        userPubkey,
      );
      const pranaEscrow = await samsaraPda.personalGovPranaEscrow(
        govAccountKey as string,
      );
      addresses.push(pranaEscrow as string);
      const pranaEscrowOffset = nextOffset;
      nextOffset++;

      addresses.push(govAccountKey as string);
      const govAccountOffset = nextOffset;
      nextOffset++;

      addresses.push(personalPositionKey as string);
      const personalPositionOffset = nextOffset;

      marketSlices.push({
        market,
        navAtaIndex: startIndex,
        escrowIndex: startIndex + 1,
        baseAtaIndex:
          baseAtaOffset != null ? startIndex + baseAtaOffset : null,
        pranaEscrowIndex: startIndex + pranaEscrowOffset,
        govAccountIndex: startIndex + govAccountOffset,
        personalPositionIndex: startIndex + personalPositionOffset,
      });
    }

    // Single RPC call for all markets
    const accounts = await this._rpcClient.getMultipleAccounts(addresses, {
      batchSize,
    });
    const walletAccount = accounts[0];

    // Parse results per market
    const results: Record<string, Record<string, number>> = {};
    for (const slice of marketSlices) {
      const { market } = slice;
      const navAtaAccount = accounts[slice.navAtaIndex];
      const escrowAccount = accounts[slice.escrowIndex];

      let baseBalance: number;
      if (slice.baseAtaIndex != null) {
        baseBalance = parseTokenAmountFromAccountData(
          accounts[slice.baseAtaIndex],
          market.baseDecimals,
        );
      } else {
        // Native SOL -- read lamports from wallet
        const lamports = walletAccount?.lamports ?? 0;
        baseBalance = lamports / 10 ** market.baseDecimals;
      }

      results[market.name] = {
        [market.name]: parseTokenAmountFromAccountData(
          navAtaAccount,
          market.navDecimals,
        ),
        [`${market.name}_deposited`]: parseTokenAmountFromAccountData(
          escrowAccount,
          market.navDecimals,
        ),
        [market.baseName]: baseBalance,
        prANA_deposited: parseTokenAmountFromAccountData(
          accounts[slice.pranaEscrowIndex],
          PRANA_DECIMALS,
        ),
        rewards_unclaimed: await this.getClaimableRewardsViaSimulation({
          userPubkey,
          market,
        }),
        debt: parsePersonalPositionDebt(
          accounts[slice.personalPositionIndex],
          market.baseDecimals,
        ),
      };
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Rewards via Simulation
  // -----------------------------------------------------------------------

  /**
   * Gets claimable prANA revenue for a market by simulating a
   * collectRevPrana transaction and reading the post-state token balance.
   *
   * Simulates without signing -- the RPC node replaces the blockhash
   * and skips signature verification.
   *
   * Returns 0.0 if the user has no govAccount or no claimable rewards.
   */
  async getClaimableRewardsViaSimulation(options: {
    userPubkey: string;
    market: NavTokenMarket;
  }): Promise<number> {
    const { userPubkey, market } = options;

    const samsaraPda = new SamsaraPda(this._config.samsaraProgramId);
    const txBuilder = new SamsaraTransactionBuilder(this._config);

    // Derive PDAs
    const govAccountKey = await samsaraPda.personalGovAccount(
      market.samsaraMarket,
      userPubkey,
    );
    const cashEscrowKey = await samsaraPda.marketCashEscrow(
      market.samsaraMarket,
    );
    const samLogCounterKey = await samsaraPda.logCounter();

    // Cash destination: user's base token ATA (wSOL ATA for SOL markets)
    const cashDst = await deriveAta(userPubkey, market.baseMint);

    // Build instructions
    const instructions: Instruction[] = [];

    // CreateATA idempotent -- ensures the destination exists
    instructions.push(
      txBuilder.buildCreateAtaIdempotentInstruction(
        userPubkey,
        cashDst,
        userPubkey,
        market.baseMint,
      ),
    );

    // collectRevPrana -- claims revenue into cashDst
    instructions.push(
      txBuilder.buildCollectRevPranaInstruction(
        userPubkey,
        market,
        govAccountKey as string,
        cashEscrowKey as string,
        cashDst,
        samLogCounterKey as string,
      ),
    );

    // Build and serialize the transaction (unsigned, for simulation only)
    const blockhash = await this._rpcClient.getLatestBlockhash();
    const txBytes = buildUnsignedTransactionBytes({
      instructions,
      feePayer: userPubkey,
      recentBlockhash: blockhash,
    });
    const txBase64 = base64Encode(txBytes);

    // Simulate and read post-state of cashDst
    const simResult = await this._rpcClient.simulateTransactionWithAccounts(
      txBase64,
      [cashDst],
    );

    // Check for simulation errors
    if (simResult['err'] != null) {
      return 0.0;
    }

    // Parse post-state balance from the cashDst account
    const simAccounts = simResult['accounts'] as
      | Array<Record<string, unknown>>
      | undefined;
    if (!simAccounts || simAccounts.length === 0) return 0.0;

    const postState = simAccounts[0];
    if (!postState || !postState['data']) return 0.0;

    const dataArray = postState['data'] as string[] | undefined;
    if (!dataArray || dataArray.length === 0) return 0.0;

    const base64Data = dataArray[0];
    if (!base64Data) return 0.0;

    const bytes = base64Decode(base64Data);
    if (bytes.length < 72) return 0.0;

    const postBalance = readU64LE(bytes, 64);
    return fromLamports(postBalance, market.baseDecimals);
  }

  // -----------------------------------------------------------------------
  // Floor Price
  // -----------------------------------------------------------------------

  /**
   * Fetches the floor price for a navToken market from on-chain data.
   *
   * Reads the Mayflower Market account and decodes the floor price stored
   * as a Rust Decimal at byte offset 104.
   *
   * Returns the floor price in base token units (e.g., SOL per navSOL).
   */
  async fetchFloorPrice(options: {
    market: NavTokenMarket;
  }): Promise<number> {
    const { market } = options;
    const accountInfo = await this._rpcClient.getAccountInfo(
      market.mayflowerMarket,
    );
    return parseFloorPriceFromAccount(accountInfo, market);
  }

  /**
   * Fetches floor prices for multiple markets in a single batched RPC call.
   *
   * Returns a map of market name to floor price in base token units.
   */
  async fetchAllFloorPrices(options: {
    markets: NavTokenMarket[];
    batchSize?: number;
  }): Promise<Record<string, number>> {
    const { markets, batchSize = 30 } = options;
    const addresses = markets.map((m) => m.mayflowerMarket);
    const accounts = await this._rpcClient.getMultipleAccounts(addresses, {
      batchSize,
    });

    const results: Record<string, number> = {};
    for (let i = 0; i < markets.length; i++) {
      results[markets[i].name] = parseFloorPriceFromAccount(
        accounts[i],
        markets[i],
      );
    }
    return results;
  }

  // -----------------------------------------------------------------------
  // Borrow Capacity
  // -----------------------------------------------------------------------

  /**
   * Fetches the user's borrow capacity for a navToken market.
   *
   * Reads the on-chain PersonalPosition (deposited navToken shares + current
   * debt) and the market's floor price to compute the borrow limit.
   *
   * Max borrow = deposited navTokens * floor price (100% LTV against floor).
   *
   * Returns `{ deposited, debt, limit, available }` in base token units.
   * Returns null if the user has no position.
   */
  async fetchBorrowCapacity(options: {
    userPubkey: string;
    market: NavTokenMarket;
  }): Promise<Record<string, number> | null> {
    const { userPubkey, market } = options;

    const mayflowerPda = new MayflowerPda(this._config.mayflowerProgramId);

    // Derive personal position PDA
    const personalPositionKey = await mayflowerPda.personalPosition(
      market.marketMetadata,
      userPubkey,
    );

    // Batch-fetch personal position + mayflower market in one RPC call
    const accounts = await this._rpcClient.getMultipleAccounts([
      personalPositionKey as string,
      market.mayflowerMarket,
    ]);

    const positionAccount = accounts[0];
    if (!positionAccount || !positionAccount.data) {
      return null;
    }

    // Parse deposited shares and debt
    const deposited = parsePersonalPositionShares(
      positionAccount,
      market.navDecimals,
    );
    const debt = parsePersonalPositionDebt(
      positionAccount,
      market.baseDecimals,
    );

    // Parse floor price from market account
    const floorPrice = parseFloorPriceFromAccount(accounts[1], market);

    const limit = deposited * floorPrice;
    const available = limit > debt ? limit - debt : 0.0;

    return { deposited, debt, limit, available };
  }

  /**
   * Estimates the borrow capacity from a buy, without making any RPC calls.
   *
   * Buy gives navTokens at market price, borrow limit uses floor price:
   *   navTokens = inputBaseAmount / marketPrice
   *   maxBorrow = navTokens * floorPrice
   *
   * All amounts are in human-readable units.
   */
  static estimateBorrowCapacityAfterBuy(options: {
    inputBaseAmount: number;
    marketPrice: number;
    floorPrice: number;
  }): Record<string, number> {
    const { inputBaseAmount, marketPrice, floorPrice } = options;
    const estimatedNavTokens = inputBaseAmount / marketPrice;
    const borrowLimit = estimatedNavTokens * floorPrice;

    return { estimatedNavTokens, borrowLimit };
  }

  // -----------------------------------------------------------------------
  // Market Discovery
  // -----------------------------------------------------------------------

  /**
   * Discovers all navToken markets from on-chain Mayflower program data.
   *
   * Algorithm (3 RPC calls):
   * 1. getProgramAccounts for all MarketLinear accounts (304 bytes)
   * 2. getMultipleAccounts to batch-fetch MarketMeta accounts (488 bytes)
   * 3. getMultipleAccounts to batch-fetch SPL Mint accounts for decimals
   *
   * PDAs (samsaraMarket, authorityPda) are derived locally with no RPC.
   */
  async discoverMarkets(options?: {
    batchSize?: number;
  }): Promise<NavTokenMarket[]> {
    const batchSize = options?.batchSize ?? 30;

    const samsaraPda = new SamsaraPda(this._config.samsaraProgramId);
    const mayflowerPda = new MayflowerPda(this._config.mayflowerProgramId);

    // 1. Fetch all MarketLinear accounts (304 bytes)
    const marketLinearAccounts = await this._rpcClient.getProgramAccounts(
      this._config.mayflowerProgramId,
      { dataSize: 304 },
    );

    if (marketLinearAccounts.length === 0) return [];

    // Extract marketMetadata pubkey (offset 8-40) from each MarketLinear
    const metadataAddresses: string[] = [];
    const mayflowerMarketPubkeys: string[] = [];
    for (const item of marketLinearAccounts) {
      const bytes = decodeAccountData(item.account);
      if (bytes.length < 40) continue;
      metadataAddresses.push(bytesToAddress(bytes.slice(8, 40)));
      mayflowerMarketPubkeys.push(item.pubkey);
    }

    // 2. Batch-fetch all MarketMeta accounts (488 bytes)
    const metaAccounts = await this._rpcClient.getMultipleAccounts(
      metadataAddresses,
      { batchSize },
    );

    // Parse MarketMeta fields and collect unique mints
    const mintSet = new Set<string>();
    const parsedMetas: ParsedMarketMeta[] = [];

    for (let i = 0; i < metaAccounts.length; i++) {
      const metaAccount = metaAccounts[i];
      if (!metaAccount) continue;

      const bytes = decodeAccountData(metaAccount);
      if (bytes.length < 296) continue;

      const baseMint = bytesToAddress(bytes.slice(8, 40));
      const navMint = bytesToAddress(bytes.slice(40, 72));
      const marketGroup = bytesToAddress(bytes.slice(104, 136));
      const baseVault = bytesToAddress(bytes.slice(200, 232));
      const navVault = bytesToAddress(bytes.slice(232, 264));
      const feeVault = bytesToAddress(bytes.slice(264, 296));

      mintSet.add(baseMint);
      mintSet.add(navMint);

      parsedMetas.push({
        mayflowerMarket: mayflowerMarketPubkeys[i],
        marketMetadata: metadataAddresses[i],
        baseMint,
        navMint,
        marketGroup,
        baseVault,
        navVault,
        feeVault,
      });
    }

    // 3. Batch-fetch SPL Mint accounts for decimals
    const mintList = [...mintSet];
    const mintAccounts = await this._rpcClient.getMultipleAccounts(mintList, {
      batchSize,
    });
    const mintDecimals: Record<string, number> = {};
    for (let i = 0; i < mintList.length; i++) {
      mintDecimals[mintList[i]] = parseMintDecimals(mintAccounts[i]);
    }

    // 4. Derive PDAs and build NavTokenMarket objects
    const markets: NavTokenMarket[] = [];
    for (const meta of parsedMetas) {
      const samsaraMarketKey = await samsaraPda.market(meta.marketMetadata);
      const authorityPdaKey = await mayflowerPda.liqVaultMain(
        meta.marketMetadata,
      );

      // Resolve names from well-known mints
      const navInfo = WELL_KNOWN_MINTS[meta.navMint];
      const baseInfo = WELL_KNOWN_MINTS[meta.baseMint];
      const name =
        navInfo?.symbol ?? `nav_${meta.navMint.substring(0, 8)}`;
      const baseName =
        baseInfo?.symbol ?? meta.baseMint.substring(0, 8);

      markets.push({
        name,
        baseName,
        baseMint: meta.baseMint,
        navMint: meta.navMint,
        samsaraMarket: samsaraMarketKey as string,
        mayflowerMarket: meta.mayflowerMarket,
        marketMetadata: meta.marketMetadata,
        marketGroup: meta.marketGroup,
        marketSolVault: meta.baseVault,
        marketNavVault: meta.navVault,
        feeVault: meta.feeVault,
        authorityPda: authorityPdaKey as string,
        baseDecimals: mintDecimals[meta.baseMint] ?? 9,
        navDecimals: mintDecimals[meta.navMint] ?? 9,
      });
    }

    return markets;
  }

  // -----------------------------------------------------------------------
  // Price Fetching
  // -----------------------------------------------------------------------

  /**
   * Fetches the latest navToken price by parsing a recent buy/sell transaction.
   *
   * Returns price in base token units per navToken (e.g., SOL per navSOL).
   */
  async fetchLatestNavTokenPrice(options: {
    market: NavTokenMarket;
    afterSignature?: string;
    beforeSignature?: string;
    pageSize?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    maxRetries?: number;
  }): Promise<TransactionPriceResult> {
    const {
      market,
      afterSignature,
      beforeSignature,
      pageSize = 20,
      initialDelayMs = 500,
      maxDelayMs = 10000,
      maxRetries = 5,
    } = options;

    try {
      // Query signatures for the market account
      const signatures = await this._rpcClient.getSignaturesForAddress(
        market.mayflowerMarket,
        {
          limit: pageSize,
          until: afterSignature,
          before: beforeSignature,
        },
      );

      if (signatures.length === 0) {
        if (afterSignature != null) {
          return { status: 'reachedAfterLimit' };
        }
        return {
          status: 'error',
          errorMessage: `No transactions found for ${market.name} market`,
        };
      }

      let txIndex = 0;
      let txChecked = 0;
      let retryCount = 0;
      let currentDelayMs = initialDelayMs;
      let lastCheckedSig: string | undefined;
      const newestSig = signatures[0];

      while (txIndex < signatures.length && txChecked < pageSize) {
        const sig = signatures[txIndex];
        lastCheckedSig = sig;

        try {
          if (txChecked > 0 && currentDelayMs > 0) {
            await new Promise((r) => setTimeout(r, currentDelayMs));
          }

          const result = await this._parseNavTokenTransactionPrice(
            sig,
            market,
          );
          return {
            status: 'found',
            price: result.price!,
            signature: sig,
            newestCheckedSignature: newestSig,
            fee: result.fee,
            currency: result.currency,
          };
        } catch (e) {
          const errorMsg = String(e);

          if (errorMsg.includes('429') && retryCount < maxRetries) {
            retryCount++;
            currentDelayMs = Math.min(
              currentDelayMs * 2,
              maxDelayMs,
            );
            await new Promise((r) => setTimeout(r, currentDelayMs));
            continue;
          }

          retryCount = 0;
          currentDelayMs = initialDelayMs;
          txIndex++;
          txChecked++;
        }
      }

      if (txIndex >= signatures.length && afterSignature != null) {
        return { status: 'reachedAfterLimit' };
      }

      if (lastCheckedSig != null) {
        return {
          status: 'limitReached',
          signature: lastCheckedSig,
          newestCheckedSignature: newestSig,
        };
      }

      return {
        status: 'error',
        errorMessage: `No recent ${market.name} buy/sell transactions found`,
      };
    } catch (e) {
      return {
        status: 'error',
        errorMessage: String(e),
      };
    }
  }

  /**
   * Fetches the latest navToken price with automatic paging.
   */
  async fetchLatestNavTokenPriceWithPaging(options: {
    market: NavTokenMarket;
    afterSignature?: string;
    maxPages?: number;
    pageSize?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    maxRetries?: number;
  }): Promise<TransactionPriceResult> {
    const {
      market,
      maxPages = 10,
      pageSize = 20,
      initialDelayMs = 500,
      maxDelayMs = 10000,
      maxRetries = 5,
    } = options;
    let { afterSignature } = options;

    let beforeSignature: string | undefined;
    let lastSignature: string | undefined;
    let newestCheckedSig: string | undefined;

    for (let page = 1; page <= maxPages; page++) {
      const result = await this.fetchLatestNavTokenPrice({
        market,
        afterSignature,
        beforeSignature,
        pageSize,
        initialDelayMs,
        maxDelayMs,
        maxRetries,
      });

      if (page === 1 && result.newestCheckedSignature) {
        newestCheckedSig = result.newestCheckedSignature;
      }

      if (result.status !== 'limitReached') {
        return result;
      }

      lastSignature = result.signature;
      beforeSignature = result.signature;
      afterSignature = undefined;
    }

    return {
      status: 'limitReached',
      signature: lastSignature!,
      newestCheckedSignature: newestCheckedSig!,
    };
  }

  /**
   * Parses a Mayflower transaction to extract navToken price.
   *
   * For buy: price = base spent / navToken received
   * For sell: price = base received / navToken spent
   */
  private async _parseNavTokenTransactionPrice(
    signature: string,
    market: NavTokenMarket,
  ): Promise<TransactionPriceResult> {
    const txData = await this._rpcClient.getTransaction(signature);

    const meta = txData['meta'] as Record<string, unknown> | undefined;
    if (!meta) {
      throw new Error('Transaction metadata not found');
    }

    if (meta['err'] != null) {
      throw new Error('Transaction failed');
    }

    const preTokenBalances =
      (meta['preTokenBalances'] as Array<Record<string, unknown>>) ?? [];
    const postTokenBalances =
      (meta['postTokenBalances'] as Array<Record<string, unknown>>) ?? [];

    // navToken: net change across all accounts (non-zero because mint/burn)
    const navChange = this._getTokenBalanceChangeByOwner(
      preTokenBalances,
      postTokenBalances,
      market.navMint,
      null,
    );

    // Base token: use the vault's change (owner = marketMetadata PDA)
    const baseChange = this._getTokenBalanceChangeByOwner(
      preTokenBalances,
      postTokenBalances,
      market.baseMint,
      market.marketMetadata,
    );

    if (navChange === 0.0 || baseChange === 0.0) {
      throw new Error(`Not a ${market.name} buy/sell transaction`);
    }

    // price = abs(base vault change) / abs(nav change)
    const price = Math.abs(baseChange) / Math.abs(navChange);

    return {
      status: 'found',
      price,
      signature,
      currency: market.baseName,
    };
  }

  /**
   * Gets the balance change for a specific mint filtered by token account owner.
   */
  private _getTokenBalanceChangeByOwner(
    preTokenBalances: Array<Record<string, unknown>>,
    postTokenBalances: Array<Record<string, unknown>>,
    mint: string,
    owner: string | null,
  ): number {
    const preAmounts = new Map<number, number>();
    const postAmounts = new Map<number, number>();
    const allIndices = new Set<number>();

    for (const balance of preTokenBalances) {
      if (balance['mint'] !== mint) continue;
      if (owner != null && balance['owner'] !== owner) continue;
      const index = balance['accountIndex'] as number;
      const uiTokenAmount = balance['uiTokenAmount'] as
        | Record<string, unknown>
        | undefined;
      const amount = parseFloat(
        (uiTokenAmount?.['uiAmountString'] as string) ?? '0',
      );
      preAmounts.set(index, amount);
      allIndices.add(index);
    }

    for (const balance of postTokenBalances) {
      if (balance['mint'] !== mint) continue;
      if (owner != null && balance['owner'] !== owner) continue;
      const index = balance['accountIndex'] as number;
      const uiTokenAmount = balance['uiTokenAmount'] as
        | Record<string, unknown>
        | undefined;
      const amount = parseFloat(
        (uiTokenAmount?.['uiAmountString'] as string) ?? '0',
      );
      postAmounts.set(index, amount);
      allIndices.add(index);
    }

    let totalChange = 0.0;
    for (const index of allIndices) {
      const pre = preAmounts.get(index) ?? 0.0;
      const post = postAmounts.get(index) ?? 0.0;
      totalChange += post - pre;
    }

    return totalChange;
  }

  // -----------------------------------------------------------------------
  // Debug / Dump Helpers
  // -----------------------------------------------------------------------

  /**
   * Dumps all u64 fields from a GovAccount for offset discovery.
   * Returns a map of offset to raw u64 value.
   */
  static dumpGovAccountFields(
    account: AccountInfo | null,
  ): Record<number, bigint> {
    const fields: Record<number, bigint> = {};
    if (!account || !account.data) return fields;

    const bytes = base64Decode(account.data);
    if (bytes.length < 72) return fields;

    for (let offset = 72; offset + 8 <= bytes.length; offset += 8) {
      fields[offset] = readU64LE(bytes, offset);
    }
    return fields;
  }

  /**
   * Dumps all u64 fields from a PersonalPosition for offset discovery.
   * Returns a map of offset to raw u64 value.
   */
  static dumpPersonalPositionFields(
    account: AccountInfo | null,
  ): Record<number, bigint> {
    const fields: Record<number, bigint> = {};
    if (!account || !account.data) return fields;

    const bytes = base64Decode(account.data);
    if (bytes.length < 72) return fields;

    for (let offset = 72; offset + 8 <= bytes.length; offset += 8) {
      fields[offset] = readU64LE(bytes, offset);
    }
    return fields;
  }

  // -----------------------------------------------------------------------
  // Transaction Builders
  // -----------------------------------------------------------------------

  /**
   * Build an unsigned deposit prANA transaction for a Samsara market.
   *
   * Automatically initializes the govAccount if it doesn't exist yet.
   * Returns serialized transaction bytes ready for wallet signing.
   */
  async buildUnsignedDepositPranaTransaction(options: {
    userPubkey: string;
    market: NavTokenMarket;
    pranaAmount: number;
    recentBlockhash: string;
  }): Promise<Uint8Array> {
    const { userPubkey, market, pranaAmount, recentBlockhash } = options;

    const pda = new SamsaraPda(this._config.samsaraProgramId);
    const txBuilder = new SamsaraTransactionBuilder(this._config);

    // 1. Derive PDAs
    const govAccount = await pda.personalGovAccount(
      market.samsaraMarket,
      userPubkey,
    );
    const pranaEscrow = await pda.personalGovPranaEscrow(
      govAccount as string,
    );
    const logCounter = await pda.logCounter();

    // 2. Check if govAccount exists on-chain
    const govAccountInfo = await this._rpcClient.getAccountInfo(
      govAccount as string,
    );
    const needsInit = !govAccountInfo || !govAccountInfo.data;

    // 3. Find user's prANA ATA
    const pranaSrc = await this._rpcClient.getAssociatedTokenAddress(
      userPubkey,
      this._config.pranaMint,
    );

    // 4. Build instruction list
    const instructions: Instruction[] = [
      txBuilder.buildSetComputeUnitLimitInstruction(200000),
      txBuilder.buildSetComputeUnitPriceInstruction(50000n),
    ];

    if (needsInit) {
      instructions.push(
        txBuilder.buildInitGovAccountInstruction(
          userPubkey,
          userPubkey,
          market,
          pranaEscrow as string,
          govAccount as string,
          logCounter as string,
        ),
      );
    }

    const pranaLamports = toLamports(pranaAmount, PRANA_DECIMALS);
    instructions.push(
      txBuilder.buildDepositPranaInstruction(
        userPubkey,
        market,
        govAccount as string,
        pranaSrc,
        pranaEscrow as string,
        logCounter as string,
        pranaLamports,
      ),
    );

    // 5. Compile and return unsigned tx
    return buildUnsignedTransactionBytes({
      instructions,
      feePayer: userPubkey,
      recentBlockhash,
    });
  }

  /**
   * Build an unsigned buy navToken transaction for a Mayflower market.
   *
   * Wraps SOL into wSOL, buys navToken via Mayflower, then closes the wSOL
   * account to return dust. Automatically initializes the personal position
   * if the user hasn't interacted with this market before.
   *
   * Returns serialized transaction bytes ready for wallet signing.
   */
  async buildUnsignedBuyNavSolTransaction(options: {
    userPubkey: string;
    market: NavTokenMarket;
    inputLamports: bigint;
    recentBlockhash: string;
    minOutputLamports?: bigint;
    computeUnitLimit?: number;
    computeUnitPrice?: bigint;
  }): Promise<Uint8Array> {
    const {
      userPubkey,
      market,
      inputLamports,
      recentBlockhash,
      minOutputLamports = 0n,
      computeUnitLimit = 400000,
      computeUnitPrice = 280000n,
    } = options;

    const mayflowerPda = new MayflowerPda(this._config.mayflowerProgramId);
    const txBuilder = new SamsaraTransactionBuilder(this._config);

    // 1. Derive user ATAs
    const userWsolAta = await this._rpcClient.getAssociatedTokenAddress(
      userPubkey,
      market.baseMint,
    );
    const userNavAta = await this._rpcClient.getAssociatedTokenAddress(
      userPubkey,
      market.navMint,
    );

    // 2. Derive Mayflower PDAs
    const personalPositionKey = await mayflowerPda.personalPosition(
      market.marketMetadata,
      userPubkey,
    );
    const userSharesKey = await mayflowerPda.personalPositionEscrow(
      personalPositionKey as string,
    );
    const logAccount = (await mayflowerPda.logAccount()) as string;

    const personalPosition = personalPositionKey as string;
    const userShares = userSharesKey as string;

    // 3. Check if personal position exists on-chain
    const positionInfo =
      await this._rpcClient.getAccountInfo(personalPosition);
    const needsInit = !positionInfo || !positionInfo.data;

    // 4. Build instruction list
    const instructions: Instruction[] = [
      txBuilder.buildSetComputeUnitLimitInstruction(computeUnitLimit),
      txBuilder.buildSetComputeUnitPriceInstruction(computeUnitPrice),

      // Create wSOL ATA (idempotent)
      txBuilder.buildCreateAtaIdempotentInstruction(
        userPubkey,
        userWsolAta,
        userPubkey,
        market.baseMint,
      ),

      // Transfer SOL to wSOL ATA
      txBuilder.buildTransferInstruction(
        userPubkey,
        userWsolAta,
        inputLamports,
      ),

      // Sync native (wrap SOL)
      txBuilder.buildSyncNativeInstruction(userWsolAta),

      // Create navToken ATA (idempotent)
      txBuilder.buildCreateAtaIdempotentInstruction(
        userPubkey,
        userNavAta,
        userPubkey,
        market.navMint,
      ),
    ];

    // Init personal position if first-time user
    if (needsInit) {
      instructions.push(
        txBuilder.buildInitPositionInstruction(
          userPubkey,
          market,
          personalPosition,
          userShares,
          logAccount,
        ),
      );
    }

    // Mayflower buy navToken
    instructions.push(
      txBuilder.buildBuyNavSolInstruction(
        userPubkey,
        market,
        personalPosition,
        userShares,
        userNavAta,
        userWsolAta,
        logAccount,
        inputLamports,
        minOutputLamports,
      ),
    );

    // Close wSOL account (return dust to user)
    instructions.push(
      txBuilder.buildCloseAccountInstruction(
        userWsolAta,
        userPubkey,
        userPubkey,
      ),
    );

    // 5. Compile and return unsigned tx
    return buildUnsignedTransactionBytes({
      instructions,
      feePayer: userPubkey,
      recentBlockhash,
    });
  }

  /**
   * Build an unsigned sell navToken transaction for a Mayflower market.
   *
   * Sells navToken for base token (SOL). Creates a temporary wSOL account
   * to receive the output, then closes it to unwrap back to native SOL.
   *
   * Returns serialized transaction bytes ready for wallet signing.
   */
  async buildUnsignedSellNavSolTransaction(options: {
    userPubkey: string;
    market: NavTokenMarket;
    inputNavLamports: bigint;
    recentBlockhash: string;
    minOutputLamports?: bigint;
    computeUnitLimit?: number;
    computeUnitPrice?: bigint;
  }): Promise<Uint8Array> {
    const {
      userPubkey,
      market,
      inputNavLamports,
      recentBlockhash,
      minOutputLamports = 0n,
      computeUnitLimit = 400000,
      computeUnitPrice = 280000n,
    } = options;

    const mayflowerPda = new MayflowerPda(this._config.mayflowerProgramId);
    const txBuilder = new SamsaraTransactionBuilder(this._config);

    // 1. Derive user ATAs
    const userWsolAta = await this._rpcClient.getAssociatedTokenAddress(
      userPubkey,
      market.baseMint,
    );
    const userNavAta = await this._rpcClient.getAssociatedTokenAddress(
      userPubkey,
      market.navMint,
    );

    // 2. Derive Mayflower PDAs
    const personalPositionKey = await mayflowerPda.personalPosition(
      market.marketMetadata,
      userPubkey,
    );
    const userSharesKey = await mayflowerPda.personalPositionEscrow(
      personalPositionKey as string,
    );
    const logAccount = (await mayflowerPda.logAccount()) as string;

    const personalPosition = personalPositionKey as string;
    const userShares = userSharesKey as string;

    // 3. Build instruction list
    const instructions: Instruction[] = [
      txBuilder.buildSetComputeUnitLimitInstruction(computeUnitLimit),
      txBuilder.buildSetComputeUnitPriceInstruction(computeUnitPrice),

      // Create wSOL ATA (idempotent) - for receiving sell output
      txBuilder.buildCreateAtaIdempotentInstruction(
        userPubkey,
        userWsolAta,
        userPubkey,
        market.baseMint,
      ),

      // Transfer 0 lamports to wSOL ATA (ensure account exists)
      txBuilder.buildTransferInstruction(userPubkey, userWsolAta, 0n),

      // Sync native (activate wSOL)
      txBuilder.buildSyncNativeInstruction(userWsolAta),

      // Create navToken ATA (idempotent)
      txBuilder.buildCreateAtaIdempotentInstruction(
        userPubkey,
        userNavAta,
        userPubkey,
        market.navMint,
      ),

      // Mayflower sell navToken
      txBuilder.buildSellNavSolInstruction(
        userPubkey,
        market,
        personalPosition,
        userWsolAta,
        userNavAta,
        userShares,
        logAccount,
        inputNavLamports,
        minOutputLamports,
      ),

      // Close wSOL account (unwrap to native SOL)
      txBuilder.buildCloseAccountInstruction(
        userWsolAta,
        userPubkey,
        userPubkey,
      ),
    ];

    // 4. Compile and return unsigned tx
    return buildUnsignedTransactionBytes({
      instructions,
      feePayer: userPubkey,
      recentBlockhash,
    });
  }

  /**
   * Build an unsigned borrow transaction for a Mayflower market.
   *
   * Borrows the market's base token (e.g., SOL for navSOL) against the user's
   * deposited prANA. For native SOL markets, wraps/unwraps via a temporary
   * wSOL account.
   *
   * Returns serialized transaction bytes ready for wallet signing.
   */
  async buildUnsignedBorrowTransaction(options: {
    userPubkey: string;
    market: NavTokenMarket;
    borrowLamports: bigint;
    recentBlockhash: string;
    computeUnitLimit?: number;
    computeUnitPrice?: bigint;
  }): Promise<Uint8Array> {
    const {
      userPubkey,
      market,
      borrowLamports,
      recentBlockhash,
      computeUnitLimit = 200000,
      computeUnitPrice = 500000n,
    } = options;

    const mayflowerPda = new MayflowerPda(this._config.mayflowerProgramId);
    const txBuilder = new SamsaraTransactionBuilder(this._config);

    // 1. Derive user's base token ATA
    const userBaseAta = await this._rpcClient.getAssociatedTokenAddress(
      userPubkey,
      market.baseMint,
    );

    // 2. Derive Mayflower PDAs
    const personalPositionKey = await mayflowerPda.personalPosition(
      market.marketMetadata,
      userPubkey,
    );
    const personalPosition = personalPositionKey as string;
    const logAccount = (await mayflowerPda.logAccount()) as string;

    const isNativeSol = market.baseMint === NATIVE_SOL_MINT;

    // 3. Build instruction list
    const instructions: Instruction[] = [
      txBuilder.buildSetComputeUnitLimitInstruction(computeUnitLimit),
      txBuilder.buildSetComputeUnitPriceInstruction(computeUnitPrice),

      // Create base token ATA (idempotent)
      txBuilder.buildCreateAtaIdempotentInstruction(
        userPubkey,
        userBaseAta,
        userPubkey,
        market.baseMint,
      ),
    ];

    if (isNativeSol) {
      // Transfer 0 lamports + sync native (ensure wSOL account is active)
      instructions.push(
        txBuilder.buildTransferInstruction(userPubkey, userBaseAta, 0n),
        txBuilder.buildSyncNativeInstruction(userBaseAta),
      );
    }

    // Mayflower borrow base token
    instructions.push(
      txBuilder.buildBorrowInstruction(
        userPubkey,
        market,
        userBaseAta,
        personalPosition,
        logAccount,
        borrowLamports,
      ),
    );

    if (isNativeSol) {
      // Close wSOL account (unwrap to native SOL)
      instructions.push(
        txBuilder.buildCloseAccountInstruction(
          userBaseAta,
          userPubkey,
          userPubkey,
        ),
      );
    }

    // 4. Compile and return unsigned tx
    return buildUnsignedTransactionBytes({
      instructions,
      feePayer: userPubkey,
      recentBlockhash,
    });
  }

  /**
   * Build an unsigned atomic buy + borrow transaction for a Mayflower market.
   *
   * Combines buying navToken and borrowing base token into a single
   * transaction requiring only one user signature.
   *
   * Automatically initializes the personal position if the user hasn't
   * interacted with this market before.
   *
   * Returns serialized transaction bytes ready for wallet signing.
   */
  async buildUnsignedBuyAndBorrowTransaction(options: {
    userPubkey: string;
    market: NavTokenMarket;
    inputLamports: bigint;
    borrowLamports: bigint;
    recentBlockhash: string;
    minOutputLamports?: bigint;
    computeUnitLimit?: number;
    computeUnitPrice?: bigint;
  }): Promise<Uint8Array> {
    const {
      userPubkey,
      market,
      inputLamports,
      borrowLamports,
      recentBlockhash,
      minOutputLamports = 0n,
      computeUnitLimit = 600000,
      computeUnitPrice = 500000n,
    } = options;

    const mayflowerPda = new MayflowerPda(this._config.mayflowerProgramId);
    const txBuilder = new SamsaraTransactionBuilder(this._config);

    // 1. Derive user ATAs (base token ATA shared between buy and borrow)
    const userBaseAta = await this._rpcClient.getAssociatedTokenAddress(
      userPubkey,
      market.baseMint,
    );
    const userNavAta = await this._rpcClient.getAssociatedTokenAddress(
      userPubkey,
      market.navMint,
    );

    // 2. Derive Mayflower PDAs
    const personalPositionKey = await mayflowerPda.personalPosition(
      market.marketMetadata,
      userPubkey,
    );
    const userSharesKey = await mayflowerPda.personalPositionEscrow(
      personalPositionKey as string,
    );
    const logAccount = (await mayflowerPda.logAccount()) as string;

    const personalPosition = personalPositionKey as string;
    const userShares = userSharesKey as string;

    // 3. Check if personal position exists on-chain
    const positionInfo =
      await this._rpcClient.getAccountInfo(personalPosition);
    const needsInit = !positionInfo || !positionInfo.data;

    const isNativeSol = market.baseMint === NATIVE_SOL_MINT;

    // 4. Build combined instruction list
    const instructions: Instruction[] = [
      txBuilder.buildSetComputeUnitLimitInstruction(computeUnitLimit),
      txBuilder.buildSetComputeUnitPriceInstruction(computeUnitPrice),

      // Create base token ATA (idempotent) -- shared between buy and borrow
      txBuilder.buildCreateAtaIdempotentInstruction(
        userPubkey,
        userBaseAta,
        userPubkey,
        market.baseMint,
      ),
    ];

    if (isNativeSol) {
      // Wrap SOL for buy input
      instructions.push(
        txBuilder.buildTransferInstruction(
          userPubkey,
          userBaseAta,
          inputLamports,
        ),
        txBuilder.buildSyncNativeInstruction(userBaseAta),
      );
    }

    // Create navToken ATA (idempotent)
    instructions.push(
      txBuilder.buildCreateAtaIdempotentInstruction(
        userPubkey,
        userNavAta,
        userPubkey,
        market.navMint,
      ),
    );

    // Init personal position if first-time user
    if (needsInit) {
      instructions.push(
        txBuilder.buildInitPositionInstruction(
          userPubkey,
          market,
          personalPosition,
          userShares,
          logAccount,
        ),
      );
    }

    // Buy navToken (takes base token, mints + auto-deposits navToken)
    instructions.push(
      txBuilder.buildBuyNavSolInstruction(
        userPubkey,
        market,
        personalPosition,
        userShares,
        userNavAta,
        userBaseAta,
        logAccount,
        inputLamports,
        minOutputLamports,
      ),
    );

    // Borrow base token against deposited navToken collateral
    instructions.push(
      txBuilder.buildBorrowInstruction(
        userPubkey,
        market,
        userBaseAta,
        personalPosition,
        logAccount,
        borrowLamports,
      ),
    );

    if (isNativeSol) {
      // Close wSOL account (unwrap buy dust + borrowed SOL to native)
      instructions.push(
        txBuilder.buildCloseAccountInstruction(
          userBaseAta,
          userPubkey,
          userPubkey,
        ),
      );
    }

    // 5. Compile and return unsigned tx
    return buildUnsignedTransactionBytes({
      instructions,
      feePayer: userPubkey,
      recentBlockhash,
    });
  }

  /**
   * Build an unsigned deposit navToken transaction for a Mayflower market.
   *
   * Deposits navToken from the user's wallet ATA into the market's personal
   * position escrow. No wSOL wrapping needed.
   *
   * Returns serialized transaction bytes ready for wallet signing.
   */
  async buildUnsignedDepositNavTokenTransaction(options: {
    userPubkey: string;
    market: NavTokenMarket;
    depositLamports: bigint;
    recentBlockhash: string;
    computeUnitLimit?: number;
    computeUnitPrice?: bigint;
  }): Promise<Uint8Array> {
    const {
      userPubkey,
      market,
      depositLamports,
      recentBlockhash,
      computeUnitLimit = 200000,
      computeUnitPrice = 500000n,
    } = options;

    const mayflowerPda = new MayflowerPda(this._config.mayflowerProgramId);
    const txBuilder = new SamsaraTransactionBuilder(this._config);

    // 1. Derive user's navToken ATA
    const userNavAta = await this._rpcClient.getAssociatedTokenAddress(
      userPubkey,
      market.navMint,
    );

    // 2. Derive Mayflower PDAs
    const personalPositionKey = await mayflowerPda.personalPosition(
      market.marketMetadata,
      userPubkey,
    );
    const userSharesKey = await mayflowerPda.personalPositionEscrow(
      personalPositionKey as string,
    );
    const personalPosition = personalPositionKey as string;
    const userShares = userSharesKey as string;

    // 3. Build instruction list
    const instructions: Instruction[] = [
      txBuilder.buildSetComputeUnitLimitInstruction(computeUnitLimit),
      txBuilder.buildSetComputeUnitPriceInstruction(computeUnitPrice),

      // Create navToken ATA (idempotent)
      txBuilder.buildCreateAtaIdempotentInstruction(
        userPubkey,
        userNavAta,
        userPubkey,
        market.navMint,
      ),

      // Mayflower deposit navToken
      txBuilder.buildDepositNavTokenInstruction(
        userPubkey,
        market,
        personalPosition,
        userShares,
        userNavAta,
        market.authorityPda,
        depositLamports,
      ),
    ];

    // 4. Compile and return unsigned tx
    return buildUnsignedTransactionBytes({
      instructions,
      feePayer: userPubkey,
      recentBlockhash,
    });
  }

  /**
   * Build an unsigned withdraw navToken transaction for a Mayflower market.
   *
   * Withdraws navToken from the market's personal position escrow back to
   * the user's wallet ATA. No wSOL wrapping needed.
   *
   * Returns serialized transaction bytes ready for wallet signing.
   */
  async buildUnsignedWithdrawNavTokenTransaction(options: {
    userPubkey: string;
    market: NavTokenMarket;
    withdrawLamports: bigint;
    recentBlockhash: string;
    computeUnitLimit?: number;
    computeUnitPrice?: bigint;
  }): Promise<Uint8Array> {
    const {
      userPubkey,
      market,
      withdrawLamports,
      recentBlockhash,
      computeUnitLimit = 200000,
      computeUnitPrice = 500000n,
    } = options;

    const mayflowerPda = new MayflowerPda(this._config.mayflowerProgramId);
    const txBuilder = new SamsaraTransactionBuilder(this._config);

    // 1. Derive user's navToken ATA
    const userNavAta = await this._rpcClient.getAssociatedTokenAddress(
      userPubkey,
      market.navMint,
    );

    // 2. Derive Mayflower PDAs
    const personalPositionKey = await mayflowerPda.personalPosition(
      market.marketMetadata,
      userPubkey,
    );
    const userSharesKey = await mayflowerPda.personalPositionEscrow(
      personalPositionKey as string,
    );
    const personalPosition = personalPositionKey as string;
    const userShares = userSharesKey as string;

    // 3. Build instruction list
    const instructions: Instruction[] = [
      txBuilder.buildSetComputeUnitLimitInstruction(computeUnitLimit),
      txBuilder.buildSetComputeUnitPriceInstruction(computeUnitPrice),

      // Create navToken ATA (idempotent)
      txBuilder.buildCreateAtaIdempotentInstruction(
        userPubkey,
        userNavAta,
        userPubkey,
        market.navMint,
      ),

      // Mayflower withdraw navToken
      txBuilder.buildWithdrawNavTokenInstruction(
        userPubkey,
        market,
        personalPosition,
        userShares,
        userNavAta,
        market.authorityPda,
        withdrawLamports,
      ),
    ];

    // 4. Compile and return unsigned tx
    return buildUnsignedTransactionBytes({
      instructions,
      feePayer: userPubkey,
      recentBlockhash,
    });
  }

  /**
   * Build an unsigned claim rewards transaction for a Samsara market.
   *
   * Claims all accrued prANA revenue (paid in base token, e.g., SOL).
   * No amount parameter -- claims everything available.
   * For native SOL markets, wraps/unwraps via a temporary wSOL account.
   *
   * Returns serialized transaction bytes ready for wallet signing.
   */
  async buildUnsignedClaimRewardsTransaction(options: {
    userPubkey: string;
    market: NavTokenMarket;
    recentBlockhash: string;
    computeUnitLimit?: number;
    computeUnitPrice?: bigint;
  }): Promise<Uint8Array> {
    const {
      userPubkey,
      market,
      recentBlockhash,
      computeUnitLimit = 200000,
      computeUnitPrice = 500000n,
    } = options;

    const samsaraPda = new SamsaraPda(this._config.samsaraProgramId);
    const txBuilder = new SamsaraTransactionBuilder(this._config);

    // 1. Derive user's base token ATA
    const userBaseAta = await this._rpcClient.getAssociatedTokenAddress(
      userPubkey,
      market.baseMint,
    );

    // 2. Derive Samsara PDAs
    const govAccount = await samsaraPda.personalGovAccount(
      market.samsaraMarket,
      userPubkey,
    );
    const cashEscrow = await samsaraPda.marketCashEscrow(
      market.samsaraMarket,
    );
    const logCounter = await samsaraPda.logCounter();

    const isNativeSol = market.baseMint === NATIVE_SOL_MINT;

    // 3. Build instruction list
    const instructions: Instruction[] = [
      txBuilder.buildSetComputeUnitLimitInstruction(computeUnitLimit),
      txBuilder.buildSetComputeUnitPriceInstruction(computeUnitPrice),

      // Create base token ATA (idempotent)
      txBuilder.buildCreateAtaIdempotentInstruction(
        userPubkey,
        userBaseAta,
        userPubkey,
        market.baseMint,
      ),
    ];

    if (isNativeSol) {
      // Transfer 0 lamports + sync native (ensure wSOL account is active)
      instructions.push(
        txBuilder.buildTransferInstruction(userPubkey, userBaseAta, 0n),
        txBuilder.buildSyncNativeInstruction(userBaseAta),
      );
    }

    // Samsara collect revenue (claim rewards)
    instructions.push(
      txBuilder.buildCollectRevPranaInstruction(
        userPubkey,
        market,
        govAccount as string,
        cashEscrow as string,
        userBaseAta,
        logCounter as string,
      ),
    );

    if (isNativeSol) {
      // Close wSOL account (unwrap to native SOL)
      instructions.push(
        txBuilder.buildCloseAccountInstruction(
          userBaseAta,
          userPubkey,
          userPubkey,
        ),
      );
    }

    // 4. Compile and return unsigned tx
    return buildUnsignedTransactionBytes({
      instructions,
      feePayer: userPubkey,
      recentBlockhash,
    });
  }

  /**
   * Build an unsigned Mayflower repay transaction.
   *
   * Repays borrowed base token (e.g., SOL) back to the market.
   * For native SOL markets, wraps SOL to wSOL before repay and unwraps after.
   *
   * Returns serialized transaction bytes ready for wallet signing.
   */
  async buildUnsignedRepayTransaction(options: {
    userPubkey: string;
    market: NavTokenMarket;
    repayLamports: bigint;
    recentBlockhash: string;
    computeUnitLimit?: number;
    computeUnitPrice?: bigint;
  }): Promise<Uint8Array> {
    const {
      userPubkey,
      market,
      repayLamports,
      recentBlockhash,
      computeUnitLimit = 200000,
      computeUnitPrice = 500000n,
    } = options;

    const mayflowerPda = new MayflowerPda(this._config.mayflowerProgramId);
    const txBuilder = new SamsaraTransactionBuilder(this._config);

    // 1. Derive user's base token ATA
    const userBaseAta = await this._rpcClient.getAssociatedTokenAddress(
      userPubkey,
      market.baseMint,
    );

    // 2. Derive Mayflower PDAs
    const personalPositionKey = await mayflowerPda.personalPosition(
      market.marketMetadata,
      userPubkey,
    );
    const personalPosition = personalPositionKey as string;

    const isNativeSol = market.baseMint === NATIVE_SOL_MINT;

    // 3. Build instruction list
    const instructions: Instruction[] = [
      txBuilder.buildSetComputeUnitLimitInstruction(computeUnitLimit),
      txBuilder.buildSetComputeUnitPriceInstruction(computeUnitPrice),

      // Create base token ATA (idempotent)
      txBuilder.buildCreateAtaIdempotentInstruction(
        userPubkey,
        userBaseAta,
        userPubkey,
        market.baseMint,
      ),
    ];

    if (isNativeSol) {
      // Transfer repay amount to wSOL + sync native
      instructions.push(
        txBuilder.buildTransferInstruction(
          userPubkey,
          userBaseAta,
          repayLamports,
        ),
        txBuilder.buildSyncNativeInstruction(userBaseAta),
      );
    }

    // Mayflower repay base token
    instructions.push(
      txBuilder.buildRepayInstruction(
        userPubkey,
        market,
        personalPosition,
        userBaseAta,
        market.authorityPda,
        repayLamports,
      ),
    );

    if (isNativeSol) {
      // Close wSOL account (unwrap to native SOL)
      instructions.push(
        txBuilder.buildCloseAccountInstruction(
          userBaseAta,
          userPubkey,
          userPubkey,
        ),
      );
    }

    // 4. Compile and return unsigned tx
    return buildUnsignedTransactionBytes({
      instructions,
      feePayer: userPubkey,
      recentBlockhash,
    });
  }
}
