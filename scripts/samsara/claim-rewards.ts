#!/usr/bin/env tsx
/**
 * Build an unsigned claim prANA rewards transaction.
 *
 * Usage: npx tsx scripts/samsara/claim-rewards.ts --market <name> [--keypair <path>] [--rpc <url>] [--verbose]
 *
 * Options:
 *   --market <name>    Market to claim rewards from (default: navSOL)
 *   --keypair <path>   Path to keypair file (for deriving user pubkey)
 *
 * Prints the unsigned transaction as base64 for external signing.
 *
 * Environment:
 *   SOLANA_RPC_URL      - RPC endpoint (default: https://api.mainnet-beta.solana.com)
 *   SOLANA_KEYPAIR_PATH - Default keypair path
 */
import {
  SamsaraClient,
  DefaultSolanaRpcClient,
  getMarketByName,
  availableMarkets,
} from '../../src/index.js';
import { parseScriptArgs, printJson, logVerbose } from '../helpers.js';

async function main() {
  const { rpcUrl, verbose, getFlag, keypairPath } = parseScriptArgs();
  const marketName = getFlag('--market', 'navSOL');

  const market = getMarketByName(marketName!);
  if (!market) {
    console.error(`Unknown market: ${marketName}`);
    console.error(`Available markets: ${availableMarkets().join(', ')}`);
    process.exit(1);
  }

  if (!keypairPath) {
    console.error('Keypair path required. Use --keypair <path> or set SOLANA_KEYPAIR_PATH.');
    console.error('');
    console.error('Usage: npx tsx scripts/samsara/claim-rewards.ts --market <name> [--keypair <path>] [--rpc <url>]');
    process.exit(1);
  }

  logVerbose(verbose, `RPC: ${rpcUrl}`);
  logVerbose(verbose, `Market: ${market.name}`);
  logVerbose(verbose, 'Building unsigned claim rewards transaction...');

  const rpcClient = new DefaultSolanaRpcClient(rpcUrl);
  const client = SamsaraClient.fromRpcClient(rpcClient);

  const txBytes = await client.buildUnsignedClaimRewardsTransaction({
    userPubkey: keypairPath,
    market,
  });

  const txBase64 = Buffer.from(txBytes).toString('base64');

  printJson({
    market: market.name,
    action: 'claimRewards',
    unsignedTransaction: txBase64,
    createdAt: new Date().toISOString(),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
