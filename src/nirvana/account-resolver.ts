import type { SolanaRpcClient } from '../rpc/solana-rpc-client.js';
import { type NirvanaConfig, NIRVANA_MAINNET_CONFIG } from '../models/config.js';
import { NirvanaPda } from './pda.js';

/** Container for user's Nirvana-related token accounts. */
export interface NirvanaUserAccounts {
  readonly userPubkey: string;
  readonly anaAccount: string | null;
  readonly nirvAccount: string | null;
  readonly usdcAccount: string | null;
  readonly pranaAccount: string | null;
}

/** Resolves and manages Nirvana-related accounts. */
export class NirvanaAccountResolver {
  private readonly rpcClient: SolanaRpcClient;
  private readonly config: NirvanaConfig;

  constructor(rpcClient: SolanaRpcClient, config?: NirvanaConfig) {
    this.rpcClient = rpcClient;
    this.config = config ?? NIRVANA_MAINNET_CONFIG;
  }

  /** Finds all user token accounts for Nirvana tokens. */
  async resolveUserAccounts(userPubkey: string): Promise<NirvanaUserAccounts> {
    const [anaAccount, nirvAccount, usdcAccount, pranaAccount] = await Promise.all([
      this.findOrDeriveTokenAccount(userPubkey, this.config.anaMint),
      this.findOrDeriveTokenAccount(userPubkey, this.config.nirvMint),
      this.findOrDeriveTokenAccount(userPubkey, this.config.usdcMint),
      this.findOrDeriveTokenAccount(userPubkey, this.config.pranaMint),
    ]);

    return { userPubkey, anaAccount, nirvAccount, usdcAccount, pranaAccount };
  }

  /**
   * Derive user's personal account PDA address (for staking/borrowing).
   * Always returns a valid address — the PDA is deterministic regardless of
   * whether the account exists on-chain.
   */
  async derivePersonalAccount(userPubkey: string): Promise<string> {
    const pda = NirvanaPda.mainnet();
    return pda.personalAccount(this.config.tenantAccount, userPubkey);
  }

  /** Find user's personal account if it exists on-chain. */
  async findPersonalAccount(userPubkey: string): Promise<string | null> {
    const addr = await this.derivePersonalAccount(userPubkey);
    const accountInfo = await this.rpcClient.getAccountInfo(addr);
    if (!accountInfo || !accountInfo.data) return null;
    return addr;
  }

  /** Get user's token balances. */
  async getUserBalances(userPubkey: string): Promise<Record<string, number>> {
    const accounts = await this.resolveUserAccounts(userPubkey);
    const balances: Record<string, number> = {};

    const tokens = [
      { key: 'ANA', account: accounts.anaAccount },
      { key: 'NIRV', account: accounts.nirvAccount },
      { key: 'USDC', account: accounts.usdcAccount },
      { key: 'prANA', account: accounts.pranaAccount },
    ];

    await Promise.all(
      tokens.map(async ({ key, account }) => {
        if (account) {
          try {
            balances[key] = await this.rpcClient.getTokenBalance(account);
          } catch {
            balances[key] = 0;
          }
        } else {
          balances[key] = 0;
        }
      }),
    );

    return balances;
  }

  private async findOrDeriveTokenAccount(
    owner: string,
    mint: string,
  ): Promise<string | null> {
    // First try to find existing account
    const existing = await this.rpcClient.findTokenAccount(owner, mint);
    if (existing) return existing;

    // If not found, derive the associated token account address
    return this.rpcClient.getAssociatedTokenAddress(owner, mint);
  }
}
