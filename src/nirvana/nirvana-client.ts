import {
  address,
  AccountRole,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  getBase64EncodedWireTransaction,
  type Instruction,
  type Blockhash,
} from '@solana/kit';

import type { SolanaRpcClient } from '../rpc/solana-rpc-client.js';
import { DefaultSolanaRpcClient } from '../rpc/solana-rpc-client.js';
import { type NirvanaConfig, NIRVANA_MAINNET_CONFIG } from '../models/config.js';
import type { NirvanaPrices } from '../models/prices.js';
import type { PersonalAccountInfo } from '../models/personal-account-info.js';
import type { TransactionPriceResult } from '../models/transaction-price-result.js';
import type {
  NirvanaTransaction,
  NirvanaTransactionType,
  TokenAmount,
} from '../models/nirvana-transaction.js';
import { NirvanaTransactionBuilder } from './transaction-builder.js';
import { NirvanaAccountResolver, type NirvanaUserAccounts } from './account-resolver.js';
import { NirvanaDiscriminators } from './discriminators.js';
import { retry, isRetryableError } from '../utils/retry.js';
import {
  base64Decode,
  readU64LE,
  toLamports,
  fromLamports,
} from '../utils/bytes.js';

// ── Internal types ──────────────────────────────────────────────────────

interface PriceData {
  anaMarket: number;
  anaFloor: number;
  prana: number;
}

interface BalanceChange {
  mint: string;
  change: number;
  owner: string;
}

// ── Main client ─────────────────────────────────────────────────────────

/** Main client for interacting with Nirvana V2 protocol. */
export class NirvanaClient {
  private readonly rpcClient: SolanaRpcClient;
  private readonly transactionBuilder: NirvanaTransactionBuilder;
  private readonly accountResolver: NirvanaAccountResolver;
  private readonly config: NirvanaConfig;

  constructor(options: {
    rpcClient: SolanaRpcClient;
    config?: NirvanaConfig;
  }) {
    this.rpcClient = options.rpcClient;
    this.config = options.config ?? NIRVANA_MAINNET_CONFIG;
    this.transactionBuilder = new NirvanaTransactionBuilder(this.config);
    this.accountResolver = new NirvanaAccountResolver(this.rpcClient, this.config);
  }

  /**
   * Create a NirvanaClient from just an RPC URL string.
   * This is the recommended way to create a client for most use cases.
   */
  static fromRpcUrl(url: string, config?: NirvanaConfig): NirvanaClient {
    const rpcClient = new DefaultSolanaRpcClient(url);
    return new NirvanaClient({ rpcClient, config });
  }

  // ── Price fetching ──────────────────────────────────────────────────

  /** Fetches current ANA token prices from the Nirvana V2 protocol. */
  async fetchPrices(): Promise<NirvanaPrices> {
    try {
      const [transactionPrice, floorPrice] = await Promise.all([
        this.fetchLatestAnaPrice(),
        this.fetchFloorPrice(),
      ]);

      if (transactionPrice.status !== 'found' || transactionPrice.price == null) {
        throw new Error(`Failed to get ANA price: ${transactionPrice.status}`);
      }

      const ana = transactionPrice.price;
      const floor = floorPrice;
      const prana = ana - floor;

      return {
        ana,
        floor,
        prana,
        updatedAt: new Date(),
      };
    } catch (e) {
      throw new Error(`Failed to fetch Nirvana prices: ${e}`);
    }
  }

  /** Fetches the floor price from on-chain data. */
  async fetchFloorPrice(): Promise<number> {
    const priceCurveData = await this.fetchPriceCurveAccountData();
    return this.decodeFloorPriceFromPriceCurve(priceCurveData);
  }

  /**
   * Fetches the latest ANA price from a recent buy/sell transaction.
   *
   * @param options.afterSignature  - Only check signatures newer than this (exclusive).
   * @param options.beforeSignature - Only check signatures older than this (exclusive).
   * @param options.pageSize        - Signatures per page (default 20).
   * @param options.initialDelayMs  - Initial delay between fetches (default 500).
   * @param options.maxDelayMs      - Max delay after backoff (default 10000).
   * @param options.maxRetries      - Max retries per tx on rate limit (default 5).
   */
  async fetchLatestAnaPrice(options?: {
    afterSignature?: string;
    beforeSignature?: string;
    pageSize?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    maxRetries?: number;
  }): Promise<TransactionPriceResult> {
    const {
      afterSignature,
      beforeSignature,
      pageSize = 20,
      initialDelayMs = 500,
      maxDelayMs = 10000,
      maxRetries = 5,
    } = options ?? {};

    try {
      const signatures = await this.rpcClient.getSignaturesForAddress(
        this.config.programId,
        { limit: pageSize, until: afterSignature, before: beforeSignature },
      );

      if (signatures.length === 0) {
        if (afterSignature != null) {
          return { status: 'reachedAfterLimit' };
        }
        return { status: 'error', errorMessage: 'No transactions found for program' };
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
            await delay(currentDelayMs);
          }

          const result = await this.parseTransactionPrice(sig);

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
            currentDelayMs = Math.min(currentDelayMs * 2, maxDelayMs);
            await delay(currentDelayMs);
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

      return { status: 'error', errorMessage: 'No recent ANA buy/sell transactions found' };
    } catch (e) {
      return { status: 'error', errorMessage: String(e) };
    }
  }

  /**
   * Fetches the latest ANA price with automatic paging.
   * Convenience wrapper around fetchLatestAnaPrice that handles the paging loop.
   */
  async fetchLatestAnaPriceWithPaging(options?: {
    afterSignature?: string;
    maxPages?: number;
    pageSize?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    maxRetries?: number;
  }): Promise<TransactionPriceResult> {
    let {
      afterSignature,
      maxPages = 10,
      pageSize = 20,
      initialDelayMs = 500,
      maxDelayMs = 10000,
      maxRetries = 5,
    } = options ?? {};

    let beforeSignature: string | undefined;
    let lastSignature: string | undefined;
    let newestCheckedSig: string | undefined;

    for (let page = 1; page <= maxPages; page++) {
      const result = await this.fetchLatestAnaPrice({
        afterSignature,
        beforeSignature,
        pageSize,
        initialDelayMs,
        maxDelayMs,
        maxRetries,
      });

      if (page === 1 && result.newestCheckedSignature != null) {
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

  // ── Account info ────────────────────────────────────────────────────

  /** Get user's personal account information. */
  async getPersonalAccountInfo(options: {
    userPubkey: string;
  }): Promise<PersonalAccountInfo | null> {
    const { userPubkey } = options;
    const personalAccount = await this.accountResolver.derivePersonalAccount(userPubkey);

    try {
      const accountInfo = await this.rpcClient.getAccountInfo(personalAccount);
      if (!accountInfo || !accountInfo.data) return null;

      const accountData = base64Decode(accountInfo.data);

      // Parse PersonalAccount data structure
      // Skip discriminator (8) + field_0 (32) + field_1 (32) = 72 bytes
      let offset = 72;

      const anaDebt = fromLamports(readU64LE(accountData, offset), 6);
      offset += 8;

      const stakedAna = fromLamports(readU64LE(accountData, offset), 6);
      offset += 8;

      // Skip fields 2-5 (4 * 8 = 32 bytes)
      offset += 32;

      // Read field 6 (claimable prANA)
      const claimablePrana = fromLamports(readU64LE(accountData, offset), 6);
      offset += 8;

      // Skip fields 7-13 (7 * 8 = 56 bytes)
      offset += 56;

      // Read field 14 (staked prANA)
      const stakedPrana = fromLamports(readU64LE(accountData, offset), 6);

      return {
        address: personalAccount,
        anaDebt,
        stakedAna,
        claimablePrana,
        stakedPrana,
        lastUpdated: new Date(),
      };
    } catch (e) {
      throw new Error(`Failed to get personal account info: ${e}`);
    }
  }

  /**
   * Get the user's NIRV borrow capacity: debt, limit, and available.
   * Returns null if the user has no staking position.
   */
  async getBorrowCapacity(options: {
    userPubkey: string;
  }): Promise<{ debt: number; limit: number; available: number } | null> {
    const personalInfo = await this.getPersonalAccountInfo(options);
    if (personalInfo == null) return null;

    const floorPrice = await this.fetchFloorPrice();
    const debt = personalInfo.anaDebt;
    const limit = personalInfo.stakedAna * floorPrice;
    const available = limit > debt ? limit - debt : 0;

    return { debt, limit, available };
  }

  /** Get user's token balances (ANA, NIRV, USDC, prANA). */
  async getUserBalances(options: {
    userPubkey: string;
  }): Promise<Record<string, number>> {
    return this.accountResolver.getUserBalances(options.userPubkey);
  }

  /** Resolve user's token account addresses (ATAs). */
  async resolveUserAccounts(options: {
    userPubkey: string;
  }): Promise<NirvanaUserAccounts> {
    return this.accountResolver.resolveUserAccounts(options.userPubkey);
  }

  /** Derive user's personal account PDA address (deterministic). */
  async derivePersonalAccount(options: {
    userPubkey: string;
  }): Promise<string> {
    return this.accountResolver.derivePersonalAccount(options.userPubkey);
  }

  /** Get a recent blockhash for transaction construction. */
  async getLatestBlockhash(): Promise<string> {
    return this.rpcClient.getLatestBlockhash();
  }

  // ── Claimable amounts ───────────────────────────────────────────────

  /**
   * Get claimable prANA amount via simulation.
   *
   * Simulates the `refresh_personal_account` instruction and reads the
   * claimable amount from the post-simulation PersonalAccount at offset 120.
   */
  async getClaimablePrana(options: {
    userPubkey: string;
  }): Promise<number> {
    const { userPubkey } = options;
    const personalAccount = await this.accountResolver.derivePersonalAccount(userPubkey);
    const personalAccountInfo = await this.rpcClient.getAccountInfo(personalAccount);
    if (!personalAccountInfo || !personalAccountInfo.data) {
      return 0;
    }

    // Build refresh_personal_account instruction
    const instruction = this.transactionBuilder.buildRefreshPersonalAccountInstruction(
      personalAccount,
    );

    // Build unsigned transaction for simulation
    const txBase64 = await this.buildSimulationTransaction({
      instruction,
      feePayer: userPubkey,
    });

    // Simulate with post-state account data
    const simResult = await this.rpcClient.simulateTransactionWithAccounts(
      txBase64,
      [personalAccount],
    );

    if ((simResult as Record<string, unknown>)['err'] != null) {
      return 0;
    }

    const accounts = (simResult as Record<string, unknown>)['accounts'] as Array<Record<string, unknown>> | undefined;
    if (!accounts || accounts.length === 0) {
      return 0;
    }

    const postAccount = accounts[0];
    if (!postAccount || !postAccount['data']) {
      return 0;
    }

    const postDataArr = postAccount['data'] as string[];
    const postData = base64Decode(postDataArr[0]);
    if (postData.length < 128) {
      return 0;
    }

    const claimableRaw = readU64LE(postData, 120);
    return fromLamports(claimableRaw, 6);
  }

  /**
   * Get claimable revenue share amounts (from on-chain PersonalAccount fields).
   *
   * These values are populated after `stage_rev_prana` is called.
   * Use getClaimableRevshareViaSimulation for a preview without affecting state.
   */
  async getClaimableRevshare(options: {
    userPubkey: string;
  }): Promise<{ ANA: number; NIRV: number }> {
    const { userPubkey } = options;
    const personalAccount = await this.accountResolver.derivePersonalAccount(userPubkey);
    const accountInfo = await this.rpcClient.getAccountInfo(personalAccount);
    if (!accountInfo || !accountInfo.data) {
      return { ANA: 0, NIRV: 0 };
    }

    const accountData = base64Decode(accountInfo.data);
    if (accountData.length < 272) {
      return { ANA: 0, NIRV: 0 };
    }

    // field_21 (offset 224): staged claimable ANA (u64)
    // field_26 (offset 264): staged claimable NIRV (u64)
    const stagedAna = readU64LE(accountData, 224);
    const stagedNirv = readU64LE(accountData, 264);

    return {
      ANA: fromLamports(stagedAna, 6),
      NIRV: fromLamports(stagedNirv, 6),
    };
  }

  /**
   * Get claimable revenue share via simulation (doesn't modify state).
   *
   * Simulates `stage_rev_prana` to calculate what would be claimable
   * without actually staging. Useful for previewing amounts.
   */
  async getClaimableRevshareViaSimulation(options: {
    userPubkey: string;
  }): Promise<{ ANA: number; NIRV: number }> {
    const { userPubkey } = options;
    const personalAccount = await this.accountResolver.derivePersonalAccount(userPubkey);
    const personalAccountInfo = await this.rpcClient.getAccountInfo(personalAccount);
    if (!personalAccountInfo || !personalAccountInfo.data) {
      return { ANA: 0, NIRV: 0 };
    }

    // Build stage_rev_prana instruction manually (not in transaction builder)
    const data = new Uint8Array(8);
    data.set(NirvanaDiscriminators.stageRevPrana, 0);

    const instruction: Instruction = {
      programAddress: address(this.config.programId),
      accounts: [
        { address: address(personalAccount), role: AccountRole.WRITABLE },
        { address: address(this.config.tenantAccount), role: AccountRole.READONLY },
      ],
      data,
    };

    const txBase64 = await this.buildSimulationTransaction({
      instruction,
      feePayer: userPubkey,
    });

    const simResult = await this.rpcClient.simulateTransaction(txBase64);

    if ((simResult as Record<string, unknown>)['err'] != null) {
      return { ANA: 0, NIRV: 0 };
    }

    // Extract return data
    let returnBytes: Uint8Array | null = null;

    const returnData = (simResult as Record<string, unknown>)['returnData'] as Record<string, unknown> | undefined;
    if (returnData?.['data'] != null) {
      const dataList = returnData['data'] as string[];
      if (dataList.length > 0) {
        returnBytes = base64Decode(dataList[0]);
      }
    }

    // Fallback: extract from logs
    if (returnBytes == null) {
      const logs = (simResult as Record<string, unknown>)['logs'] as string[] | undefined;
      if (logs) {
        for (const log of logs) {
          if (log.startsWith(`Program return: ${this.config.programId} `)) {
            const parts = log.split(' ');
            if (parts.length >= 4) {
              returnBytes = base64Decode(parts[parts.length - 1]);
              break;
            }
          }
        }
      }
    }

    if (returnBytes == null || returnBytes.length < 128) {
      return { ANA: 0, NIRV: 0 };
    }

    // Parse return data: offset 96 = claimable ANA, offset 120 = claimable NIRV
    const claimableAna = fromLamports(readU64LE(returnBytes, 96), 6);
    const claimableNirv = fromLamports(readU64LE(returnBytes, 120), 6);

    return { ANA: claimableAna, NIRV: claimableNirv };
  }

  // ── Transaction parsing ─────────────────────────────────────────────

  /**
   * Parse a Nirvana protocol transaction to extract details.
   * Uses retry with exponential backoff for transient errors.
   */
  async parseTransaction(options: {
    signature: string;
  }): Promise<NirvanaTransaction> {
    const { signature } = options;

    const txData = await retry(
      () => this.rpcClient.getTransaction(signature),
      { maxAttempts: 5, initialDelay: 2000, retryIf: isRetryableError },
    );

    const meta = txData['meta'] as Record<string, unknown> | undefined;
    if (!meta) {
      throw new Error('Transaction metadata not found');
    }
    if (meta['err'] != null) {
      throw new Error(`Transaction failed: ${JSON.stringify(meta['err'])}`);
    }

    // Get timestamp
    const blockTime = txData['blockTime'] as number | undefined;
    const timestamp = blockTime != null
      ? new Date(blockTime * 1000)
      : new Date();

    // Get account keys and user address
    const transaction = txData['transaction'] as Record<string, unknown> | undefined;
    const message = transaction?.['message'] as Record<string, unknown> | undefined;
    const accountKeys = (message?.['accountKeys'] as unknown[]) ?? [];

    let userAddress = '';
    if (accountKeys.length > 0) {
      const firstKey = accountKeys[0];
      userAddress = typeof firstKey === 'string'
        ? firstKey
        : (firstKey as Record<string, unknown>)['pubkey'] as string ?? '';
    }

    // Identify transaction type from instruction discriminator
    const instructions = (message?.['instructions'] as unknown[]) ?? [];
    let txType: NirvanaTransactionType = 'unknown';

    for (const instr of instructions) {
      const instruction = instr as Record<string, unknown>;
      const programId = instruction['programId'] as string | undefined;
      if (programId !== this.config.programId) continue;

      const instrData = instruction['data'] as string | undefined;
      if (!instrData) continue;

      const dataBytes = decodeBase58(instrData);
      if (dataBytes.length < 8) continue;

      const discriminator = dataBytes.slice(0, 8);
      txType = this.identifyTransactionType(discriminator);
      if (txType !== 'unknown') break;
    }

    // Extract token balance changes
    const preTokenBalances = (meta['preTokenBalances'] as unknown[]) ?? [];
    const postTokenBalances = (meta['postTokenBalances'] as unknown[]) ?? [];
    const allChanges = this.extractBalanceChanges(preTokenBalances, postTokenBalances);

    // Build account->mint map
    const accountToMint = this.buildAccountToMintMap(accountKeys, preTokenBalances, postTokenBalances);

    // Separate by owner
    const tenantChanges = allChanges.filter((c) => c.owner === this.config.tenantAccount);
    const userChanges = allChanges.filter((c) => c.owner !== this.config.tenantAccount);

    // Get balance changes for each token
    let anaChange = this.getChangeForMint(userChanges, this.config.anaMint);
    let nirvChange = this.getChangeForMint(userChanges, this.config.nirvMint);
    let usdcChange = this.getChangeForMint(userChanges, this.config.usdcMint);
    const pranaChange = this.getChangeForMint(userChanges, this.config.pranaMint);

    // Parse inner instructions for burn/mint operations (fallback)
    const innerInstructions = (meta['innerInstructions'] as unknown[]) ?? [];
    const burnMintChanges = this.parseBurnMintOperations(instructions, innerInstructions);
    const feeTransfers = this.parseFeeTransfers(instructions, innerInstructions, accountToMint, userAddress);

    if (anaChange === 0) {
      anaChange = burnMintChanges['ANA'] ?? 0;
    }
    if (nirvChange === 0) {
      nirvChange = burnMintChanges['NIRV'] ?? 0;
    }

    // Determine received and sent
    const received: TokenAmount[] = [];
    const sent: TokenAmount[] = [];
    let fee: TokenAmount | undefined;

    const buildFeeFromTransfers = (fees: Record<string, number>): TokenAmount | undefined => {
      for (const [currency, amount] of Object.entries(fees)) {
        if (amount > 0) {
          return { amount, currency };
        }
      }
      return undefined;
    };

    switch (txType) {
      case 'buy':
        if (anaChange > 0) received.push({ amount: anaChange, currency: 'ANA' });
        if (nirvChange < 0) sent.push({ amount: Math.abs(nirvChange), currency: 'NIRV' });
        else if (usdcChange < 0) sent.push({ amount: Math.abs(usdcChange), currency: 'USDC' });
        fee = buildFeeFromTransfers(feeTransfers);
        break;

      case 'sell':
        if (anaChange < 0) sent.push({ amount: Math.abs(anaChange), currency: 'ANA' });
        if (usdcChange > 0) received.push({ amount: usdcChange, currency: 'USDC' });
        else if (nirvChange > 0) received.push({ amount: nirvChange, currency: 'NIRV' });
        fee = buildFeeFromTransfers(feeTransfers);
        break;

      case 'stake':
        if (anaChange < 0) sent.push({ amount: Math.abs(anaChange), currency: 'ANA' });
        break;

      case 'unstake':
        if (anaChange > 0) received.push({ amount: anaChange, currency: 'ANA' });
        fee = buildFeeFromTransfers(feeTransfers);
        break;

      case 'borrow':
        if (nirvChange > 0) received.push({ amount: nirvChange, currency: 'NIRV' });
        fee = buildFeeFromTransfers(feeTransfers);
        break;

      case 'repay':
        if (nirvChange < 0) sent.push({ amount: Math.abs(nirvChange), currency: 'NIRV' });
        break;

      case 'realize':
        if (pranaChange < 0) sent.push({ amount: Math.abs(pranaChange), currency: 'prANA' });
        if (nirvChange < 0) sent.push({ amount: Math.abs(nirvChange), currency: 'NIRV' });
        else if (usdcChange < 0) sent.push({ amount: Math.abs(usdcChange), currency: 'USDC' });
        if (anaChange > 0) received.push({ amount: anaChange, currency: 'ANA' });
        break;

      case 'claimPrana':
        if (pranaChange > 0) received.push({ amount: pranaChange, currency: 'prANA' });
        break;

      case 'claimRevenueShare':
        if (anaChange > 0) received.push({ amount: anaChange, currency: 'ANA' });
        if (nirvChange > 0) received.push({ amount: nirvChange, currency: 'NIRV' });
        break;

      case 'unknown':
      default:
        if (anaChange > 0) received.push({ amount: anaChange, currency: 'ANA' });
        else if (anaChange < 0) sent.push({ amount: Math.abs(anaChange), currency: 'ANA' });
        if (nirvChange > 0 && received.length === 0) received.push({ amount: nirvChange, currency: 'NIRV' });
        else if (nirvChange < 0 && sent.length === 0) sent.push({ amount: Math.abs(nirvChange), currency: 'NIRV' });
        if (usdcChange > 0 && received.length === 0) received.push({ amount: usdcChange, currency: 'USDC' });
        else if (usdcChange < 0 && sent.length === 0) sent.push({ amount: Math.abs(usdcChange), currency: 'USDC' });
        fee = buildFeeFromTransfers(feeTransfers);
        break;
    }

    return {
      signature,
      type: txType,
      received,
      sent,
      fee,
      timestamp,
      userAddress,
    };
  }

  // ── Unsigned transaction builders ───────────────────────────────────

  /**
   * Build unsigned buy ANA transaction (base64 wire format).
   *
   * Returns a base64-encoded wire transaction ready for wallet signing.
   */
  async buildUnsignedBuyAnaTransaction(options: {
    userPubkey: string;
    amount: number;
    useNirv: boolean;
    minAnaAmount?: number;
    userAccounts: NirvanaUserAccounts;
    recentBlockhash: string;
  }): Promise<string> {
    const { userPubkey, amount, useNirv, minAnaAmount, userAccounts, recentBlockhash } = options;

    const instruction = this.buildBuyAnaInstruction({
      userPubkey,
      amount,
      useNirv,
      minAnaAmount,
      userAccounts,
    });

    return this.buildUnsignedTransaction({
      instructions: [instruction],
      feePayer: userPubkey,
      recentBlockhash,
    });
  }

  /**
   * Build unsigned sell ANA transaction (base64 wire format).
   */
  async buildUnsignedSellAnaTransaction(options: {
    userPubkey: string;
    anaAmount: number;
    minOutputAmount?: number;
    useNirv?: boolean;
    userAccounts: NirvanaUserAccounts;
    recentBlockhash: string;
  }): Promise<string> {
    const { userPubkey, anaAmount, minOutputAmount, useNirv = false, userAccounts, recentBlockhash } = options;

    const instruction = this.buildSellAnaInstruction({
      userPubkey,
      anaAmount,
      minOutputAmount,
      useNirv,
      userAccounts,
    });

    return this.buildUnsignedTransaction({
      instructions: [instruction],
      feePayer: userPubkey,
      recentBlockhash,
    });
  }

  /**
   * Build unsigned stake ANA transaction (base64 wire format).
   *
   * If needsInit is null/undefined, auto-detects whether personal account exists.
   * If needsInit is true, prepends an init_personal_account instruction.
   */
  async buildUnsignedStakeAnaTransaction(options: {
    userPubkey: string;
    anaAmount: number;
    userAccounts: NirvanaUserAccounts;
    recentBlockhash: string;
    personalAccount?: string;
    needsInit?: boolean;
  }): Promise<string> {
    const { userPubkey, anaAmount, userAccounts, recentBlockhash } = options;

    const resolvedPersonalAccount = options.personalAccount ??
      await this.accountResolver.derivePersonalAccount(userPubkey);

    let needsInit = options.needsInit;
    if (needsInit == null) {
      const accountInfo = await this.rpcClient.getAccountInfo(resolvedPersonalAccount);
      needsInit = !accountInfo || !accountInfo.data;
    }

    const stakeInstruction = this.buildStakeAnaInstruction({
      userPubkey,
      anaAmount,
      userAccounts,
      personalAccount: resolvedPersonalAccount,
    });

    const instructions: Instruction[] = [];
    if (needsInit) {
      instructions.push(
        this.transactionBuilder.buildInitPersonalAccountInstruction(
          userPubkey,
          resolvedPersonalAccount,
        ),
      );
    }
    instructions.push(stakeInstruction);

    return this.buildUnsignedTransaction({
      instructions,
      feePayer: userPubkey,
      recentBlockhash,
    });
  }

  /**
   * Build unsigned unstake ANA transaction (base64 wire format).
   */
  async buildUnsignedUnstakeAnaTransaction(options: {
    userPubkey: string;
    anaAmount: number;
    userAccounts: NirvanaUserAccounts;
    personalAccount: string;
    recentBlockhash: string;
  }): Promise<string> {
    const { userPubkey, anaAmount, userAccounts, personalAccount, recentBlockhash } = options;

    const instruction = this.buildUnstakeAnaInstruction({
      userPubkey,
      anaAmount,
      userAccounts,
      personalAccount,
    });

    return this.buildUnsignedTransaction({
      instructions: [instruction],
      feePayer: userPubkey,
      recentBlockhash,
    });
  }

  /**
   * Build unsigned borrow NIRV transaction (base64 wire format).
   */
  async buildUnsignedBorrowNirvTransaction(options: {
    userPubkey: string;
    nirvAmount: number;
    userAccounts: NirvanaUserAccounts;
    personalAccount: string;
    recentBlockhash: string;
  }): Promise<string> {
    const { userPubkey, nirvAmount, userAccounts, personalAccount, recentBlockhash } = options;

    const instruction = this.buildBorrowNirvInstruction({
      userPubkey,
      nirvAmount,
      userAccounts,
      personalAccount,
    });

    return this.buildUnsignedTransaction({
      instructions: [instruction],
      feePayer: userPubkey,
      recentBlockhash,
    });
  }

  /**
   * Build unsigned repay NIRV transaction (base64 wire format).
   */
  async buildUnsignedRepayNirvTransaction(options: {
    userPubkey: string;
    nirvAmount: number;
    userAccounts: NirvanaUserAccounts;
    personalAccount: string;
    recentBlockhash: string;
  }): Promise<string> {
    const { userPubkey, nirvAmount, userAccounts, personalAccount, recentBlockhash } = options;

    const instruction = this.buildRepayNirvInstruction({
      userPubkey,
      nirvAmount,
      userAccounts,
      personalAccount,
    });

    return this.buildUnsignedTransaction({
      instructions: [instruction],
      feePayer: userPubkey,
      recentBlockhash,
    });
  }

  /**
   * Build unsigned claim prANA transaction (base64 wire format).
   *
   * Includes refresh instructions (price curve + personal account) before
   * the claim to ensure accrued rewards are up-to-date.
   */
  async buildUnsignedClaimPranaTransaction(options: {
    userPubkey: string;
    userAccounts: NirvanaUserAccounts;
    personalAccount: string;
    recentBlockhash: string;
  }): Promise<string> {
    const { userPubkey, userAccounts, personalAccount, recentBlockhash } = options;

    const instructions = this.buildClaimPranaInstructions({
      userPubkey,
      userAccounts,
      personalAccount,
    });

    return this.buildUnsignedTransaction({
      instructions,
      feePayer: userPubkey,
      recentBlockhash,
    });
  }

  /**
   * Build unsigned claim revenue share transaction (base64 wire format).
   */
  async buildUnsignedClaimRevshareTransaction(options: {
    userPubkey: string;
    userAccounts: NirvanaUserAccounts;
    personalAccount: string;
    recentBlockhash: string;
  }): Promise<string> {
    const { userPubkey, userAccounts, personalAccount, recentBlockhash } = options;

    const instruction = this.buildClaimRevshareInstruction({
      userPubkey,
      userAccounts,
      personalAccount,
    });

    return this.buildUnsignedTransaction({
      instructions: [instruction],
      feePayer: userPubkey,
      recentBlockhash,
    });
  }

  // ── On-chain price calculation ──────────────────────────────────────

  /**
   * Calculate prices from on-chain tenant and price curve data.
   * This is an alternative to transaction-based pricing that reads state directly.
   */
  async calculatePricesFromOnChain(): Promise<PriceData> {
    const [tenantBytes, priceCurveBytes] = await Promise.all([
      this.fetchTenantAccountData(),
      this.fetchPriceCurveAccountData(),
    ]);

    return this.calculatePrices(tenantBytes, priceCurveBytes);
  }

  // ── Private helpers: instruction builders ───────────────────────────

  private buildBuyAnaInstruction(options: {
    userPubkey: string;
    amount: number;
    useNirv: boolean;
    minAnaAmount?: number;
    userAccounts: NirvanaUserAccounts;
  }): Instruction {
    const { userPubkey, amount, useNirv, minAnaAmount, userAccounts } = options;

    const paymentAccount = useNirv ? userAccounts.nirvAccount : userAccounts.usdcAccount;
    if (!paymentAccount) {
      throw new Error(`User does not have ${useNirv ? 'NIRV' : 'USDC'} token account`);
    }
    if (!userAccounts.anaAccount) {
      throw new Error('User does not have ANA token account');
    }

    const amountLamports = toLamports(amount, 6);
    const minAnaLamports = minAnaAmount != null ? toLamports(minAnaAmount, 6) : 0n;

    return this.transactionBuilder.buildBuyExact2Instruction(
      userPubkey,
      paymentAccount,
      userAccounts.anaAccount,
      amountLamports,
      minAnaLamports,
    );
  }

  private buildSellAnaInstruction(options: {
    userPubkey: string;
    anaAmount: number;
    minOutputAmount?: number;
    useNirv: boolean;
    userAccounts: NirvanaUserAccounts;
  }): Instruction {
    const { userPubkey, anaAmount, minOutputAmount, useNirv, userAccounts } = options;

    if (!userAccounts.anaAccount) {
      throw new Error('User does not have ANA token account');
    }
    if (useNirv && !userAccounts.nirvAccount) {
      throw new Error('User does not have NIRV token account');
    }
    if (!useNirv && !userAccounts.usdcAccount) {
      throw new Error('User does not have USDC token account');
    }

    const anaLamports = toLamports(anaAmount, 6);
    const minOutputLamports = minOutputAmount != null ? toLamports(minOutputAmount, 6) : 0n;
    const destinationAccount = useNirv ? userAccounts.nirvAccount! : userAccounts.usdcAccount!;

    return this.transactionBuilder.buildSellInstruction(
      userPubkey,
      destinationAccount,
      userAccounts.anaAccount,
      anaLamports,
      minOutputLamports,
    );
  }

  private buildStakeAnaInstruction(options: {
    userPubkey: string;
    anaAmount: number;
    userAccounts: NirvanaUserAccounts;
    personalAccount: string;
  }): Instruction {
    const { userPubkey, anaAmount, userAccounts, personalAccount } = options;

    if (!userAccounts.anaAccount) {
      throw new Error('User does not have ANA token account');
    }

    const anaLamports = toLamports(anaAmount, 6);

    return this.transactionBuilder.buildDepositAnaInstruction(
      userPubkey,
      personalAccount,
      userAccounts.anaAccount,
      anaLamports,
    );
  }

  private buildUnstakeAnaInstruction(options: {
    userPubkey: string;
    anaAmount: number;
    userAccounts: NirvanaUserAccounts;
    personalAccount: string;
  }): Instruction {
    const { userPubkey, anaAmount, userAccounts, personalAccount } = options;

    if (!userAccounts.anaAccount) {
      throw new Error('User does not have ANA token account');
    }

    const anaLamports = toLamports(anaAmount, 6);

    return this.transactionBuilder.buildWithdrawAnaInstruction(
      userPubkey,
      personalAccount,
      userAccounts.anaAccount,
      anaLamports,
    );
  }

  private buildBorrowNirvInstruction(options: {
    userPubkey: string;
    nirvAmount: number;
    userAccounts: NirvanaUserAccounts;
    personalAccount: string;
  }): Instruction {
    const { userPubkey, nirvAmount, userAccounts, personalAccount } = options;

    if (!userAccounts.nirvAccount) {
      throw new Error('User does not have NIRV token account');
    }

    const nirvLamports = toLamports(nirvAmount, 6);

    return this.transactionBuilder.buildBorrowNirvInstruction(
      userPubkey,
      personalAccount,
      userAccounts.nirvAccount,
      nirvLamports,
    );
  }

  private buildRepayNirvInstruction(options: {
    userPubkey: string;
    nirvAmount: number;
    userAccounts: NirvanaUserAccounts;
    personalAccount: string;
  }): Instruction {
    const { userPubkey, nirvAmount, userAccounts, personalAccount } = options;

    if (!userAccounts.nirvAccount) {
      throw new Error('User does not have NIRV token account');
    }

    const nirvLamports = toLamports(nirvAmount, 6);

    return this.transactionBuilder.buildRepayInstruction(
      userPubkey,
      personalAccount,
      userAccounts.nirvAccount,
      nirvLamports,
    );
  }

  private buildClaimPranaInstructions(options: {
    userPubkey: string;
    userAccounts: NirvanaUserAccounts;
    personalAccount: string;
  }): Instruction[] {
    const { userPubkey, userAccounts, personalAccount } = options;

    if (!userAccounts.pranaAccount) {
      throw new Error('User does not have prANA token account');
    }

    const timestamp = BigInt(Math.floor(Date.now() / 1000));

    return [
      this.transactionBuilder.buildRefreshPriceCurveInstruction(timestamp),
      this.transactionBuilder.buildRefreshPersonalAccountInstruction(personalAccount),
      this.transactionBuilder.buildClaimPranaInstruction(
        userPubkey,
        userAccounts.pranaAccount,
        personalAccount,
      ),
    ];
  }

  private buildClaimRevshareInstruction(options: {
    userPubkey: string;
    userAccounts: NirvanaUserAccounts;
    personalAccount: string;
  }): Instruction {
    const { userPubkey, userAccounts, personalAccount } = options;

    if (!userAccounts.anaAccount) {
      throw new Error('User does not have ANA token account');
    }
    if (!userAccounts.nirvAccount) {
      throw new Error('User does not have NIRV token account');
    }

    return this.transactionBuilder.buildClaimRevenueShareInstruction(
      userPubkey,
      personalAccount,
      userAccounts.anaAccount,
      userAccounts.nirvAccount,
    );
  }

  // ── Private helpers: transaction building ───────────────────────────

  /**
   * Build an unsigned transaction from instructions and return base64 wire format.
   */
  private buildUnsignedTransaction(options: {
    instructions: Instruction[];
    feePayer: string;
    recentBlockhash: string;
  }): string {
    const { instructions, feePayer, recentBlockhash } = options;

    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(address(feePayer), msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: recentBlockhash as Blockhash, lastValidBlockHeight: BigInt(Number.MAX_SAFE_INTEGER) },
        msg,
      ),
      (msg) => appendTransactionMessageInstructions(instructions, msg),
    );

    const compiledTx = compileTransaction(txMessage);
    return getBase64EncodedWireTransaction(compiledTx);
  }

  /**
   * Build a base64-encoded transaction suitable for simulation (unsigned).
   */
  private async buildSimulationTransaction(options: {
    instruction: Instruction;
    feePayer: string;
  }): Promise<string> {
    const { instruction, feePayer } = options;
    const blockhash = await this.rpcClient.getLatestBlockhash();

    return this.buildUnsignedTransaction({
      instructions: [instruction],
      feePayer,
      recentBlockhash: blockhash,
    });
  }

  // ── Private helpers: account data fetching ──────────────────────────

  private async fetchPriceCurveAccountData(): Promise<Uint8Array> {
    const accountInfo = await this.rpcClient.getAccountInfo(this.config.priceCurve);
    if (!accountInfo || !accountInfo.data) {
      throw new Error('PriceCurve2 account not found');
    }
    return base64Decode(accountInfo.data);
  }

  private async fetchTenantAccountData(): Promise<Uint8Array> {
    const accountInfo = await this.rpcClient.getAccountInfo(this.config.tenantAccount);
    if (!accountInfo || !accountInfo.data) {
      throw new Error('Nirvana Tenant account not found');
    }

    const bytes = base64Decode(accountInfo.data);

    if (!this.verifyTenantAccount(bytes)) {
      throw new Error('Invalid Tenant account discriminator - not a valid Nirvana V2 account');
    }

    return bytes;
  }

  private verifyTenantAccount(bytes: Uint8Array): boolean {
    if (bytes.length < 8) return false;
    for (let i = 0; i < 8; i++) {
      if (bytes[i] !== NirvanaDiscriminators.tenant[i]) return false;
    }
    return true;
  }

  // ── Private helpers: price calculation ──────────────────────────────

  private calculatePrices(tenantBytes: Uint8Array, priceCurveBytes: Uint8Array): PriceData {
    const minimumTenantBytes = 593;
    if (tenantBytes.length < minimumTenantBytes) {
      throw new Error(`Tenant account data too small - expected at least ${minimumTenantBytes} bytes, got ${tenantBytes.length}`);
    }

    const minimumPriceCurveBytes = 104;
    if (priceCurveBytes.length < minimumPriceCurveBytes) {
      throw new Error(`PriceCurve2 account data too small - expected at least ${minimumPriceCurveBytes} bytes, got ${priceCurveBytes.length}`);
    }

    const anaFloor = this.decodeFloorPriceFromPriceCurve(priceCurveBytes);
    const depositedAna = this.readDepositedAna(tenantBytes);
    const floorEndVertexX = this.readFloorEndVertexX(priceCurveBytes);
    const floorEndVertexSlope = this.readFloorEndVertexSlope(priceCurveBytes);
    const sellFeeRatio = this.readSellFeeRatio(tenantBytes);

    const anaMarketRaw = this.calculateMarketPrice(
      anaFloor,
      depositedAna,
      floorEndVertexX,
      floorEndVertexSlope,
    );

    const anaMarket = anaMarketRaw * (1 - sellFeeRatio);
    const prana = anaMarket - anaFloor;

    if (!(anaFloor > 0 && anaFloor < 1000)) {
      throw new Error(`Floor price out of reasonable range: $${anaFloor.toFixed(4)}`);
    }
    if (!(anaMarket > 0 && anaMarket < 1000)) {
      throw new Error(`Market price out of reasonable range: $${anaMarket.toFixed(4)}`);
    }
    if (!(prana >= 0 && prana < 100)) {
      throw new Error(`prANA price out of reasonable range: $${prana.toFixed(4)}`);
    }

    return { anaMarket, anaFloor, prana };
  }

  private decodeFloorPriceFromPriceCurve(priceCurveBytes: Uint8Array): number {
    const floorPriceOffset = 40;
    return this.decodeDecimalBytes(priceCurveBytes, floorPriceOffset);
  }

  private readDepositedAna(tenantBytes: Uint8Array): number {
    // discriminator(8) + adminPubkey(32) + flags(1) + vaultFields(32*12)
    const depositedAnaOffset = 8 + 32 + 1 + 32 * 12;
    return Number(readU64LE(tenantBytes, depositedAnaOffset));
  }

  private readFloorEndVertexX(priceCurveBytes: Uint8Array): number {
    const floorEndVertexXOffset = 56;
    return Number(readU64LE(priceCurveBytes, floorEndVertexXOffset));
  }

  private readFloorEndVertexSlope(priceCurveBytes: Uint8Array): number {
    const floorEndVertexSlopeOffset = 64;
    return this.decodeDecimalBytes(priceCurveBytes, floorEndVertexSlopeOffset);
  }

  private readSellFeeRatio(tenantBytes: Uint8Array): number {
    const sellFeeMbpsOffset = 585;
    const sellFeeMbps = Number(readU64LE(tenantBytes, sellFeeMbpsOffset));
    return sellFeeMbps / 1_000_000;
  }

  private calculateMarketPrice(
    floorPrice: number,
    depositedAna: number,
    floorEndVertexX: number,
    slope: number,
  ): number {
    if (depositedAna <= 0) {
      throw new Error('Invalid deposited ANA - value is zero');
    }

    if (depositedAna >= floorEndVertexX) {
      return floorPrice;
    }

    const distanceToFloor = floorEndVertexX - depositedAna;
    const premium = slope * distanceToFloor;
    return floorPrice + premium;
  }

  /**
   * Decode a Rust Decimal from raw bytes at the given offset.
   * Uses a custom interpretation matching the Dart version's scale validation.
   */
  private decodeDecimalBytes(bytes: Uint8Array, offset: number): number {
    const scale = bytes[offset + 2];
    if (scale < 10 || scale > 32) return 0;

    let rawValue = 0n;
    for (let i = 4; i < 16; i++) {
      rawValue |= BigInt(bytes[offset + i]) << BigInt(8 * (i - 4));
    }

    const divisor = 10n ** BigInt(scale);
    return Number(rawValue) / Number(divisor);
  }

  // ── Private helpers: transaction price parsing ──────────────────────

  private async parseTransactionPrice(signature: string): Promise<TransactionPriceResult> {
    const txData = await this.rpcClient.getTransaction(signature);

    const meta = txData['meta'] as Record<string, unknown> | undefined;
    if (!meta) throw new Error('Transaction metadata not found');
    if (meta['err'] != null) throw new Error('Transaction failed');

    const transaction = txData['transaction'] as Record<string, unknown> | undefined;
    const message = transaction?.['message'] as Record<string, unknown> | undefined;
    const accountKeys = (message?.['accountKeys'] as unknown[]) ?? [];

    let userAddress: string | undefined;
    if (accountKeys.length > 0) {
      const firstKey = accountKeys[0];
      userAddress = typeof firstKey === 'string'
        ? firstKey
        : (firstKey as Record<string, unknown>)['pubkey'] as string;
    }

    const instructions = (message?.['instructions'] as unknown[]) ?? [];
    const innerInstructions = (meta['innerInstructions'] as unknown[]) ?? [];

    // Collect all instructions
    const allInstructions: Record<string, unknown>[] = [];
    for (const instr of instructions) {
      allInstructions.push(instr as Record<string, unknown>);
    }
    for (const inner of innerInstructions) {
      const innerList = ((inner as Record<string, unknown>)['instructions'] as unknown[]) ?? [];
      for (const instr of innerList) {
        allInstructions.push(instr as Record<string, unknown>);
      }
    }

    // Track burn/mint and fee changes
    const burnMintChanges: Record<string, number> = {};
    const feeChanges: Record<string, number> = {};
    const tenantFeeAccount = '42rJYSmYHqbn5mk992xAoKZnWEiuMzr6u6ydj9m8fAjP';

    for (const instruction of allInstructions) {
      if (instruction['program'] !== 'spl-token') continue;

      const parsed = instruction['parsed'] as Record<string, unknown> | undefined;
      if (!parsed) continue;

      const type = parsed['type'] as string | undefined;
      const info = parsed['info'] as Record<string, unknown> | undefined;
      if (!info) continue;

      if (type === 'burn') {
        const mint = info['mint'] as string | undefined;
        const amount = info['amount'] as string | undefined;
        const authority = info['authority'] as string | undefined;
        if (mint && amount && authority) {
          const rawAmount = parseInt(amount, 10);
          const uiAmount = rawAmount / 1_000_000;
          burnMintChanges[`burn_${mint}_${authority}`] = -uiAmount;
        }
      } else if (type === 'mint' || type === 'mintTo') {
        const mint = info['mint'] as string | undefined;
        const amount = info['amount'] as string | undefined;
        const account = info['account'] as string | undefined;
        if (mint && amount) {
          const rawAmount = parseInt(amount, 10);
          const uiAmount = rawAmount / 1_000_000;
          burnMintChanges[`mint_${mint}_${account}`] = uiAmount;
        }
      } else if (type === 'transfer' || type === 'transferChecked') {
        const destination = info['destination'] as string | undefined;
        const authority = info['authority'] as string | undefined;
        let mint = info['mint'] as string | undefined;
        let uiAmount: number | undefined;

        if (type === 'transferChecked') {
          const tokenAmount = info['tokenAmount'] as Record<string, unknown> | undefined;
          uiAmount = tokenAmount?.['uiAmount'] as number | undefined;
        }

        if (mint && uiAmount != null && authority) {
          if (destination === tenantFeeAccount) {
            feeChanges[`fee_${mint}_${authority}`] = -uiAmount;
          }
        }
      }
    }

    // Extract token balance changes
    const preTokenBalances = (meta['preTokenBalances'] as unknown[]) ?? [];
    const postTokenBalances = (meta['postTokenBalances'] as unknown[]) ?? [];
    const allChanges = this.extractBalanceChanges(preTokenBalances, postTokenBalances);

    const tenantChanges = allChanges.filter((c) => c.owner === this.config.tenantAccount);
    const userChanges = allChanges.filter((c) => c.owner !== this.config.tenantAccount);

    // Check if prANA is involved (skip staking operations)
    const pranaUserChange = this.getChangeForMint(userChanges, this.config.pranaMint);
    const pranaTenantChange = this.getChangeForMint(tenantChanges, this.config.pranaMint);
    if (pranaUserChange !== 0 || pranaTenantChange !== 0) {
      throw new Error('prANA involved - not a buy/sell transaction');
    }

    // Get balance changes
    let anaUserChange = this.getChangeForMint(userChanges, this.config.anaMint);
    let nirvUserChange = this.getChangeForMint(userChanges, this.config.nirvMint);
    let usdcUserChange = this.getChangeForMint(userChanges, this.config.usdcMint);

    // Fall back to instruction-based changes
    if (anaUserChange === 0) {
      for (const [key, value] of Object.entries(burnMintChanges)) {
        if (key.includes(this.config.anaMint)) anaUserChange += value;
      }
    }
    if (nirvUserChange === 0) {
      for (const [key, value] of Object.entries(burnMintChanges)) {
        if (key.includes(this.config.nirvMint)) nirvUserChange += value;
      }
    }
    if (usdcUserChange === 0) {
      for (const [key, value] of Object.entries(burnMintChanges)) {
        if (key.includes(this.config.usdcMint)) usdcUserChange += value;
      }
    }

    // Calculate burn/mint amounts for pricing
    let anaBurnMint = 0;
    let nirvBurnMint = 0;
    for (const [key, value] of Object.entries(burnMintChanges)) {
      if (key.includes(this.config.anaMint)) anaBurnMint += value;
      else if (key.includes(this.config.nirvMint)) nirvBurnMint += value;
    }

    // Calculate fee amounts per currency
    let anaFee = 0;
    let nirvFee = 0;
    let usdcFee = 0;
    for (const [key, value] of Object.entries(feeChanges)) {
      if (key.includes(this.config.anaMint)) anaFee += Math.abs(value);
      else if (key.includes(this.config.nirvMint)) nirvFee += Math.abs(value);
      else if (key.includes(this.config.usdcMint)) usdcFee += Math.abs(value);
    }

    // Determine direction
    const anaChange = anaBurnMint !== 0 ? anaBurnMint : anaUserChange;

    if (anaChange === 0) {
      throw new Error('No ANA balance change detected');
    }

    let pricePerAna: number;
    let paymentAmount: number;
    let currency: string;

    if (anaChange > 0) {
      // Minted ANA = BUY
      const anaAmount = anaChange;
      if (nirvUserChange < 0 || nirvBurnMint < 0) {
        paymentAmount = nirvBurnMint !== 0 ? Math.abs(nirvBurnMint) : Math.abs(nirvUserChange);
        currency = 'NIRV';
      } else if (usdcUserChange < 0) {
        paymentAmount = Math.abs(usdcUserChange);
        currency = 'USDC';
      } else {
        throw new Error('Could not determine payment currency for buy');
      }
      pricePerAna = paymentAmount / anaAmount;
    } else {
      // Burned ANA = SELL
      const anaAmount = Math.abs(anaChange);
      if (nirvUserChange > 0 || nirvBurnMint > 0) {
        paymentAmount = nirvBurnMint !== 0 ? nirvBurnMint : nirvUserChange;
        currency = 'NIRV';
      } else if (usdcUserChange > 0) {
        paymentAmount = usdcUserChange;
        currency = 'USDC';
      } else {
        throw new Error('Could not determine received currency for sell');
      }
      pricePerAna = paymentAmount / anaAmount;
    }

    return {
      status: 'found',
      price: pricePerAna,
      signature,
      fee: anaFee,
      currency,
    };
  }

  // ── Private helpers: balance change extraction ──────────────────────

  private extractBalanceChanges(
    preTokenBalances: unknown[],
    postTokenBalances: unknown[],
  ): BalanceChange[] {
    const changes: BalanceChange[] = [];
    const processedIndices = new Set<number>();

    for (const pre of preTokenBalances) {
      const preBalance = pre as Record<string, unknown>;
      const accountIndex = preBalance['accountIndex'] as number;
      const mint = preBalance['mint'] as string;
      processedIndices.add(accountIndex);

      const postBalance = (postTokenBalances as Record<string, unknown>[]).find(
        (pb) => (pb as Record<string, unknown>)['accountIndex'] === accountIndex,
      ) as Record<string, unknown> | undefined;

      if (!postBalance) continue;

      const preUiAmount = (preBalance['uiTokenAmount'] as Record<string, unknown>);
      const postUiAmount = (postBalance['uiTokenAmount'] as Record<string, unknown>);
      const preAmount = parseFloat((preUiAmount['uiAmountString'] as string) ?? '0');
      const postAmount = parseFloat((postUiAmount['uiAmountString'] as string) ?? '0');
      const change = postAmount - preAmount;

      if (Math.abs(change) < 0.000001) continue;

      changes.push({
        mint,
        change,
        owner: (preBalance['owner'] as string) ?? 'unknown',
      });
    }

    // New accounts (in post but not in pre)
    for (const post of postTokenBalances) {
      const postBalance = post as Record<string, unknown>;
      const accountIndex = postBalance['accountIndex'] as number;
      if (processedIndices.has(accountIndex)) continue;

      const mint = postBalance['mint'] as string;
      const postUiAmount = (postBalance['uiTokenAmount'] as Record<string, unknown>);
      const postAmount = parseFloat((postUiAmount['uiAmountString'] as string) ?? '0');

      if (Math.abs(postAmount) < 0.000001) continue;

      changes.push({
        mint,
        change: postAmount,
        owner: (postBalance['owner'] as string) ?? 'unknown',
      });
      processedIndices.add(accountIndex);
    }

    // Closed accounts (in pre but not in post)
    for (const pre of preTokenBalances) {
      const preBalance = pre as Record<string, unknown>;
      const accountIndex = preBalance['accountIndex'] as number;
      if (processedIndices.has(accountIndex)) continue;

      const mint = preBalance['mint'] as string;
      const preUiAmount = (preBalance['uiTokenAmount'] as Record<string, unknown>);
      const preAmount = parseFloat((preUiAmount['uiAmountString'] as string) ?? '0');

      if (Math.abs(preAmount) < 0.000001) continue;

      changes.push({
        mint,
        change: -preAmount,
        owner: (preBalance['owner'] as string) ?? 'unknown',
      });
    }

    return changes;
  }

  private getChangeForMint(changes: BalanceChange[], mint: string): number {
    const match = changes.find((c) => c.mint === mint);
    return match?.change ?? 0;
  }

  private buildAccountToMintMap(
    accountKeys: unknown[],
    preTokenBalances: unknown[],
    postTokenBalances: unknown[],
  ): Record<string, string> {
    const accountToMint: Record<string, string> = {};

    for (const balance of [...preTokenBalances, ...postTokenBalances]) {
      const b = balance as Record<string, unknown>;
      const accountIndex = b['accountIndex'] as number | undefined;
      const mint = b['mint'] as string | undefined;

      if (accountIndex != null && mint != null && accountIndex < accountKeys.length) {
        const accountKey = accountKeys[accountIndex];
        const addr = typeof accountKey === 'string'
          ? accountKey
          : (accountKey as Record<string, unknown>)['pubkey'] as string | undefined;
        if (addr) {
          accountToMint[addr] = mint;
        }
      }
    }

    return accountToMint;
  }

  // ── Private helpers: instruction parsing ────────────────────────────

  private identifyTransactionType(discriminator: Uint8Array): NirvanaTransactionType {
    if (bytesEqual(discriminator, NirvanaDiscriminators.buyExact2)) return 'buy';
    if (bytesEqual(discriminator, NirvanaDiscriminators.sell2)) return 'sell';
    if (bytesEqual(discriminator, NirvanaDiscriminators.depositAna)) return 'stake';
    if (bytesEqual(discriminator, NirvanaDiscriminators.withdrawAna)) return 'unstake';
    if (bytesEqual(discriminator, NirvanaDiscriminators.borrowNirv)) return 'borrow';
    if (bytesEqual(discriminator, NirvanaDiscriminators.repay)) return 'repay';
    if (bytesEqual(discriminator, NirvanaDiscriminators.realize)) return 'realize';
    if (bytesEqual(discriminator, NirvanaDiscriminators.claimPrana)) return 'claimPrana';
    if (bytesEqual(discriminator, NirvanaDiscriminators.claimRevenueShare)) return 'claimRevenueShare';
    return 'unknown';
  }

  private parseBurnMintOperations(
    instructions: unknown[],
    innerInstructions: unknown[],
  ): Record<string, number> {
    const changes: Record<string, number> = {};

    const processInstruction = (instr: Record<string, unknown>) => {
      if (instr['program'] !== 'spl-token') return;

      const parsed = instr['parsed'] as Record<string, unknown> | undefined;
      if (!parsed) return;

      const type = parsed['type'] as string | undefined;
      const info = parsed['info'] as Record<string, unknown> | undefined;
      if (!info) return;

      if (type === 'burn') {
        const mint = info['mint'] as string | undefined;
        const amount = info['amount'] as string | undefined;
        if (mint && amount) {
          const uiAmount = parseInt(amount, 10) / 1_000_000;
          const currency = this.mintToCurrency(mint);
          changes[currency] = (changes[currency] ?? 0) - uiAmount;
        }
      } else if (type === 'mint' || type === 'mintTo') {
        const mint = info['mint'] as string | undefined;
        const amount = info['amount'] as string | undefined;
        if (mint && amount) {
          const uiAmount = parseInt(amount, 10) / 1_000_000;
          const currency = this.mintToCurrency(mint);
          changes[currency] = (changes[currency] ?? 0) + uiAmount;
        }
      }
    };

    for (const instr of instructions) {
      processInstruction(instr as Record<string, unknown>);
    }

    for (const inner of innerInstructions) {
      const innerList = ((inner as Record<string, unknown>)['instructions'] as unknown[]) ?? [];
      for (const instr of innerList) {
        processInstruction(instr as Record<string, unknown>);
      }
    }

    return changes;
  }

  private parseFeeTransfers(
    instructions: unknown[],
    innerInstructions: unknown[],
    accountToMint: Record<string, string>,
    userAddress: string,
  ): Record<string, number> {
    const feeAccounts = new Set([
      '42rJYSmYHqbn5mk992xAoKZnWEiuMzr6u6ydj9m8fAjP', // escrowRevNirv
      'v2EeX2VjgsMbwokj6UDmAm691oePzrcvKpK5DT7LwbQ',  // escrowNirvAccount
    ]);
    const fees: Record<string, number> = {};

    const processInstruction = (instr: Record<string, unknown>) => {
      if (instr['program'] !== 'spl-token') return;

      const parsed = instr['parsed'] as Record<string, unknown> | undefined;
      if (!parsed) return;

      const type = parsed['type'] as string | undefined;
      const info = parsed['info'] as Record<string, unknown> | undefined;
      if (!info) return;

      // Track mints to fee accounts
      if (type === 'mintTo') {
        const account = info['account'] as string | undefined;
        const mint = info['mint'] as string | undefined;
        const amount = info['amount'] as string | undefined;

        if (account && feeAccounts.has(account) && mint && amount) {
          const uiAmount = parseInt(amount, 10) / 1_000_000;
          const currency = this.mintToCurrency(mint);
          fees[currency] = (fees[currency] ?? 0) + uiAmount;
        }
      }

      // Track transfers to fee accounts
      if (type === 'transfer' || type === 'transferChecked') {
        const destination = info['destination'] as string | undefined;
        const source = info['source'] as string | undefined;
        let mint = info['mint'] as string | undefined;

        if (!destination || !feeAccounts.has(destination)) return;

        if (!mint && source) {
          mint = accountToMint[source];
        }

        let uiAmount: number | undefined;
        if (type === 'transferChecked') {
          const tokenAmount = info['tokenAmount'] as Record<string, unknown> | undefined;
          uiAmount = tokenAmount?.['uiAmount'] as number | undefined;
        } else {
          const amount = info['amount'] as string | undefined;
          if (amount) {
            uiAmount = parseInt(amount, 10) / 1_000_000;
          }
        }

        if (mint && uiAmount != null) {
          const currency = this.mintToCurrency(mint);
          fees[currency] = (fees[currency] ?? 0) + uiAmount;
        }
      }
    };

    for (const instr of instructions) {
      processInstruction(instr as Record<string, unknown>);
    }

    for (const inner of innerInstructions) {
      const innerList = ((inner as Record<string, unknown>)['instructions'] as unknown[]) ?? [];
      for (const instr of innerList) {
        processInstruction(instr as Record<string, unknown>);
      }
    }

    return fees;
  }

  private mintToCurrency(mint: string): string {
    if (mint === this.config.anaMint) return 'ANA';
    if (mint === this.config.nirvMint) return 'NIRV';
    if (mint === this.config.usdcMint) return 'USDC';
    if (mint === this.config.pranaMint) return 'prANA';
    return mint.substring(0, 8);
  }
}

// ── Module-level helpers ────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Decode a base58-encoded string to bytes. */
function decodeBase58(data: string): Uint8Array {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let result = 0n;
  for (let i = 0; i < data.length; i++) {
    const index = alphabet.indexOf(data[i]);
    if (index < 0) return new Uint8Array(0);
    result = result * 58n + BigInt(index);
  }
  const bytes: number[] = [];
  while (result > 0n) {
    bytes.unshift(Number(result % 256n));
    result = result / 256n;
  }
  // Add leading zeros
  for (let i = 0; i < data.length && data[i] === '1'; i++) {
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}
