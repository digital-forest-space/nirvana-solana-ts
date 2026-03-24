#!/usr/bin/env tsx
/**
 * Fetch latest navToken price from recent transactions.
 *
 * Usage: npx tsx scripts/samsara/fetch-nav-price.ts --market <name> [--max-pages <n>] [--page-size <n>] [--rpc <url>] [--verbose]
 *
 * Options:
 *   --market <name>    Market to fetch price for (required)
 *   --max-pages <n>    Maximum pages to scan (default: 10)
 *   --page-size <n>    Signatures per page (default: 20)
 *
 * Environment:
 *   SOLANA_RPC_URL - RPC endpoint (default: https://api.mainnet-beta.solana.com)
 */
import {
  SamsaraClient,
  DefaultSolanaRpcClient,
  getMarketByName,
  availableMarkets,
} from '../../src/index.js';
import { parseScriptArgs, printJson, logVerbose } from '../helpers.js';

async function main() {
  const { rpcUrl, verbose, getFlag, getIntFlag } = parseScriptArgs();
  const marketName = getFlag('--market', 'navSOL');
  const maxPages = getIntFlag('--max-pages', 10);
  const pageSize = getIntFlag('--page-size', 20);

  const market = getMarketByName(marketName!);
  if (!market) {
    console.error(`Unknown market: ${marketName}`);
    console.error(`Available markets: ${availableMarkets().join(', ')}`);
    process.exit(1);
  }

  logVerbose(verbose, `RPC: ${rpcUrl}`);
  logVerbose(verbose, `Market: ${market.name}`);
  logVerbose(verbose, `Max pages: ${maxPages}, page size: ${pageSize}`);

  const rpcClient = new DefaultSolanaRpcClient(rpcUrl);
  const client = SamsaraClient.fromRpcClient(rpcClient);

  logVerbose(verbose, 'Fetching latest navToken price...');

  const result = await client.fetchLatestNavTokenPrice(market, {
    maxPages,
    pageSize,
  });

  printJson({
    market: market.name,
    ...result,
    fetchedAt: new Date().toISOString(),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
