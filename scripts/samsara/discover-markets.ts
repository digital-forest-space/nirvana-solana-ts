#!/usr/bin/env tsx
/**
 * Discover all Samsara navToken markets from on-chain data.
 *
 * Usage: npx tsx scripts/samsara/discover-markets.ts [--rpc <url>] [--verbose]
 *
 * Environment:
 *   SOLANA_RPC_URL - RPC endpoint (default: https://api.mainnet-beta.solana.com)
 */
import { SamsaraClient, DefaultSolanaRpcClient } from '../../src/index.js';
import { parseScriptArgs, printJson, logVerbose } from '../helpers.js';

async function main() {
  const { rpcUrl, verbose } = parseScriptArgs();

  logVerbose(verbose, `RPC: ${rpcUrl}`);

  const rpcClient = new DefaultSolanaRpcClient(rpcUrl);
  const client = SamsaraClient.fromRpcClient(rpcClient);

  logVerbose(verbose, 'Discovering markets via SamsaraClient...');

  const markets = await client.discoverMarkets();

  logVerbose(verbose, `Found ${markets.length} markets`);

  printJson({
    count: markets.length,
    markets,
    fetchedAt: new Date().toISOString(),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
