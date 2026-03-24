#!/usr/bin/env tsx
/**
 * Inspect on-chain account data for any Solana address.
 *
 * Usage: npx tsx scripts/samsara/check-account-info.ts <address> [--rpc <url>] [--verbose]
 *
 * Arguments:
 *   <address>          Solana account address to inspect
 *
 * Fetches account info and prints owner, lamports, data length, and raw data details.
 *
 * Environment:
 *   SOLANA_RPC_URL - RPC endpoint (default: https://api.mainnet-beta.solana.com)
 */
import {
  DefaultSolanaRpcClient,
  SAMSARA_MAINNET_CONFIG,
  NAV_TOKEN_MARKETS,
} from '../../src/index.js';
import { parseScriptArgs, printJson, logVerbose } from '../helpers.js';

/** Map well-known program IDs to human-readable names. */
function identifyOwner(owner: string): string {
  const known: Record<string, string> = {
    [SAMSARA_MAINNET_CONFIG.samsaraProgramId]: 'Samsara Program',
    [SAMSARA_MAINNET_CONFIG.mayflowerProgramId]: 'Mayflower Program',
    [SAMSARA_MAINNET_CONFIG.tokenProgram]: 'Token Program',
    [SAMSARA_MAINNET_CONFIG.systemProgram]: 'System Program',
    [SAMSARA_MAINNET_CONFIG.associatedTokenProgram]: 'Associated Token Program',
    '11111111111111111111111111111111': 'System Program',
    BPFLoaderUpgradeab1e11111111111111111111111: 'BPF Upgradeable Loader',
  };
  return known[owner] ?? owner;
}

/** Map well-known account addresses to labels. */
function identifyAddress(addr: string): string | null {
  // Check market addresses
  for (const market of Object.values(NAV_TOKEN_MARKETS)) {
    if (addr === market.samsaraMarket) return `${market.name} Samsara Market`;
    if (addr === market.mayflowerMarket) return `${market.name} Mayflower Market`;
    if (addr === market.marketMetadata) return `${market.name} Market Metadata`;
    if (addr === market.marketGroup) return `${market.name} Market Group`;
    if (addr === market.marketSolVault) return `${market.name} Base Vault`;
    if (addr === market.marketNavVault) return `${market.name} Nav Vault`;
    if (addr === market.feeVault) return `${market.name} Fee Vault`;
    if (addr === market.navMint) return `${market.name} Nav Mint`;
    if (addr === market.baseMint) return `${market.name} Base Mint`;
  }
  // Check config addresses
  if (addr === SAMSARA_MAINNET_CONFIG.samsaraProgramId) return 'Samsara Program';
  if (addr === SAMSARA_MAINNET_CONFIG.mayflowerProgramId) return 'Mayflower Program';
  if (addr === SAMSARA_MAINNET_CONFIG.samsaraTenant) return 'Samsara Tenant';
  if (addr === SAMSARA_MAINNET_CONFIG.mayflowerTenant) return 'Mayflower Tenant';
  if (addr === SAMSARA_MAINNET_CONFIG.pranaMint) return 'prANA Mint';
  return null;
}

async function main() {
  const { rpcUrl, verbose, getArg } = parseScriptArgs();
  const addr = getArg(0);

  if (!addr) {
    console.error('Usage: npx tsx scripts/samsara/check-account-info.ts <address> [--rpc <url>] [--verbose]');
    process.exit(1);
  }

  logVerbose(verbose, `RPC: ${rpcUrl}`);
  logVerbose(verbose, `Address: ${addr}`);

  const rpcClient = new DefaultSolanaRpcClient(rpcUrl);

  const accountInfo = await rpcClient.getAccountInfo(addr);

  if (!accountInfo) {
    printJson({
      address: addr,
      label: identifyAddress(addr),
      exists: false,
      error: 'Account not found',
    });
    return;
  }

  const dataLength = accountInfo.data ? Buffer.from(accountInfo.data, 'base64').length : 0;
  const label = identifyAddress(addr);

  logVerbose(verbose, `Owner: ${accountInfo.owner} (${identifyOwner(accountInfo.owner)})`);
  logVerbose(verbose, `Lamports: ${accountInfo.lamports}`);
  logVerbose(verbose, `Data length: ${dataLength} bytes`);
  logVerbose(verbose, `Executable: ${accountInfo.executable}`);

  // Show first 64 bytes as hex if data exists
  let dataPreview: string | null = null;
  if (accountInfo.data && dataLength > 0) {
    const bytes = Buffer.from(accountInfo.data, 'base64');
    const previewLength = Math.min(64, bytes.length);
    dataPreview = bytes.subarray(0, previewLength).toString('hex');
  }

  printJson({
    address: addr,
    label,
    exists: true,
    owner: accountInfo.owner,
    ownerName: identifyOwner(accountInfo.owner),
    lamports: accountInfo.lamports,
    solBalance: accountInfo.lamports / 1e9,
    executable: accountInfo.executable,
    rentEpoch: accountInfo.rentEpoch,
    dataLength,
    dataPreview,
    fetchedAt: new Date().toISOString(),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
