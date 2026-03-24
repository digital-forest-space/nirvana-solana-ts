import { address, createSolanaRpc, type Rpc, type SolanaRpcApi, type Signature } from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';

/** Account info returned by the RPC client. */
export interface AccountInfo {
  lamports: number;
  owner: string;
  executable: boolean;
  rentEpoch: number;
  /** Base64-encoded account data (raw bytes). Null if account doesn't exist. */
  data: string | null;
}

/** Minimal RPC client interface for Nirvana operations. */
export interface SolanaRpcClient {
  /** Get account information. Returns null if account doesn't exist. */
  getAccountInfo(addr: string): Promise<AccountInfo | null>;

  /** Get token account balance. */
  getTokenBalance(tokenAccount: string): Promise<number>;

  /** Find token account for owner and mint. */
  findTokenAccount(owner: string, mint: string): Promise<string | null>;

  /** Get associated token address. */
  getAssociatedTokenAddress(owner: string, mint: string): Promise<string>;

  /** Get recent transaction signatures for an address (successful only). */
  getSignaturesForAddress(
    addr: string,
    options?: { limit?: number; until?: string; before?: string },
  ): Promise<string[]>;

  /** Get transaction details (returns raw JSON from RPC). */
  getTransaction(signature: string): Promise<Record<string, unknown>>;

  /** Find program accounts with filters. */
  getProgramAccounts(
    programId: string,
    options: { dataSize: number; memcmpOffset?: number; memcmpBytes?: string },
  ): Promise<Array<{ pubkey: string; account: AccountInfo }>>;

  /** Simulate a transaction (returns simulation result value). */
  simulateTransaction(txBase64: string): Promise<Record<string, unknown>>;

  /** Simulate a transaction and return post-state of specified accounts. */
  simulateTransactionWithAccounts(
    txBase64: string,
    accountAddresses: string[],
  ): Promise<Record<string, unknown>>;

  /** Get multiple accounts in a single RPC call. Auto-batches. */
  getMultipleAccounts(
    addresses: string[],
    options?: { batchSize?: number },
  ): Promise<Array<AccountInfo | null>>;

  /** Get recent blockhash. */
  getLatestBlockhash(): Promise<string>;

  /** The RPC URL this client is connected to. */
  readonly rpcUrl: string;
}

/** Default implementation using @solana/kit RPC. */
export class DefaultSolanaRpcClient implements SolanaRpcClient {
  private readonly rpc: Rpc<SolanaRpcApi>;
  readonly rpcUrl: string;
  private readonly timeout: number;

  constructor(rpcUrl: string, options?: { timeout?: number }) {
    this.rpcUrl = rpcUrl;
    this.timeout = options?.timeout ?? 30000;
    this.rpc = createSolanaRpc(rpcUrl);
  }

  async getAccountInfo(addr: string): Promise<AccountInfo | null> {
    const result = await this.rpc
      .getAccountInfo(address(addr), { encoding: 'base64' })
      .send();

    if (!result.value) return null;

    const value = result.value;
    const data = value.data;
    const base64Data = Array.isArray(data) ? (data[0] as string) : null;

    return {
      lamports: Number(value.lamports),
      owner: value.owner,
      executable: value.executable,
      rentEpoch: 0,
      data: base64Data,
    };
  }

  async getTokenBalance(tokenAccount: string): Promise<number> {
    const result = await this.rpc
      .getTokenAccountBalance(address(tokenAccount))
      .send();
    return Number(result.value.uiAmountString ?? '0');
  }

  async findTokenAccount(owner: string, mint: string): Promise<string | null> {
    const result = await this.rpc
      .getTokenAccountsByOwner(
        address(owner),
        { mint: address(mint) },
        { encoding: 'jsonParsed' },
      )
      .send();

    if (result.value.length === 0) return null;
    return String(result.value[0].pubkey);
  }

  async getAssociatedTokenAddress(owner: string, mint: string): Promise<string> {
    const [ata] = await findAssociatedTokenPda({
      owner: address(owner),
      mint: address(mint),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    return ata;
  }

  async getSignaturesForAddress(
    addr: string,
    options?: { limit?: number; until?: string; before?: string },
  ): Promise<string[]> {
    const result = await this.rpc
      .getSignaturesForAddress(address(addr), {
        limit: options?.limit ?? 100,
        ...(options?.until ? { until: options.until as Signature } : {}),
        ...(options?.before ? { before: options.before as Signature } : {}),
      })
      .send();

    return result
      .filter((sig) => sig.err === null)
      .map((sig) => sig.signature);
  }

  async getTransaction(signature: string): Promise<Record<string, unknown>> {
    // Use raw fetch for jsonParsed format which preserves all fields
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [
          signature,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
        ],
      }),
      signal: AbortSignal.timeout(this.timeout),
    });

    const data = (await response.json()) as { result?: Record<string, unknown>; error?: unknown };
    if (data.error) throw new Error(`RPC error: ${JSON.stringify(data.error)}`);
    if (!data.result) throw new Error(`Transaction not found: ${signature}`);
    return data.result;
  }

  async getProgramAccounts(
    programId: string,
    options: { dataSize: number; memcmpOffset?: number; memcmpBytes?: string },
  ): Promise<Array<{ pubkey: string; account: AccountInfo }>> {
    const filters: Array<Record<string, unknown>> = [
      { dataSize: BigInt(options.dataSize) },
    ];

    if (options.memcmpOffset != null && options.memcmpBytes != null) {
      filters.push({
        memcmp: { offset: BigInt(options.memcmpOffset), bytes: options.memcmpBytes, encoding: 'base58' },
      });
    }

    const result = await this.rpc
      .getProgramAccounts(address(programId), {
        encoding: 'base64',
        filters: filters as Parameters<SolanaRpcApi['getProgramAccounts']>[1] extends { filters?: infer F } ? F : never,
      } as Parameters<SolanaRpcApi['getProgramAccounts']>[1])
      .send();

    return (result as unknown as Array<{ pubkey: string; account: { data: unknown; lamports: bigint; owner: string; executable: boolean } }>).map((item) => {
      const data = item.account.data;
      const base64Data = Array.isArray(data) ? (data[0] as string) : null;
      return {
        pubkey: String(item.pubkey),
        account: {
          lamports: Number(item.account.lamports),
          owner: item.account.owner,
          executable: item.account.executable,
          rentEpoch: 0,
          data: base64Data,
        },
      };
    });
  }

  async simulateTransaction(txBase64: string): Promise<Record<string, unknown>> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'simulateTransaction',
        params: [
          txBase64,
          {
            encoding: 'base64',
            commitment: 'confirmed',
            sigVerify: false,
            replaceRecentBlockhash: true,
          },
        ],
      }),
      signal: AbortSignal.timeout(this.timeout),
    });

    const json = (await response.json()) as { result?: { value?: Record<string, unknown> }; error?: unknown };
    if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
    return json.result?.value ?? {};
  }

  async simulateTransactionWithAccounts(
    txBase64: string,
    accountAddresses: string[],
  ): Promise<Record<string, unknown>> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'simulateTransaction',
        params: [
          txBase64,
          {
            encoding: 'base64',
            commitment: 'confirmed',
            sigVerify: false,
            replaceRecentBlockhash: true,
            accounts: {
              encoding: 'base64',
              addresses: accountAddresses,
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(this.timeout),
    });

    const json = (await response.json()) as { result?: { value?: Record<string, unknown> }; error?: unknown };
    if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
    return json.result?.value ?? {};
  }

  async getMultipleAccounts(
    addresses: string[],
    options?: { batchSize?: number },
  ): Promise<Array<AccountInfo | null>> {
    const batchSize = options?.batchSize ?? 30;
    const results: Array<AccountInfo | null> = [];

    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);
      const result = await this.rpc
        .getMultipleAccounts(
          batch.map((a) => address(a)),
          { encoding: 'base64' },
        )
        .send();

      for (const account of result.value) {
        if (!account) {
          results.push(null);
          continue;
        }
        const data = account.data;
        const base64Data = Array.isArray(data) ? (data[0] as string) : null;
        results.push({
          lamports: Number(account.lamports),
          owner: account.owner as string,
          executable: account.executable,
          rentEpoch: 0,
          data: base64Data,
        });
      }
    }

    return results;
  }

  async getLatestBlockhash(): Promise<string> {
    const result = await this.rpc.getLatestBlockhash().send();
    return result.value.blockhash;
  }
}
