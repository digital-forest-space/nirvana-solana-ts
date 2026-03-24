#!/usr/bin/env tsx
/**
 * Fetch navToken floor prices for all or a specific market.
 *
 * Usage: npx tsx scripts/samsara/explore-floor-price.ts [--market <name>] [--rpc <url>] [--verbose]
 *
 * Options:
 *   --market <name>  Fetch floor price for a specific market (default: all markets)
 *
 * Environment:
 *   SOLANA_RPC_URL - RPC endpoint (default: https://api.mainnet-beta.solana.com)
 */
import {
  SamsaraClient,
  DefaultSolanaRpcClient,
  NAV_TOKEN_MARKETS,
  getMarketByName,
  availableMarkets,
} from '../../src/index.js';
import { parseScriptArgs, printJson, logVerbose } from '../helpers.js';

async function main() {
  const { rpcUrl, verbose, getFlag } = parseScriptArgs();
  const marketName = getFlag('--market');

  logVerbose(verbose, `RPC: ${rpcUrl}`);

  const rpcClient = new DefaultSolanaRpcClient(rpcUrl);
  const client = SamsaraClient.fromRpcClient(rpcClient);

  let markets = Object.values(NAV_TOKEN_MARKETS);
  if (marketName) {
    const market = getMarketByName(marketName);
    if (!market) {
      console.error(`Unknown market: ${marketName}`);
      console.error(`Available markets: ${availableMarkets().join(', ')}`);
      process.exit(1);
    }
    markets = [market];
  }

  logVerbose(verbose, `Fetching floor prices for ${markets.length} market(s)...`);

  const floorPrices = await client.fetchAllFloorPrices(markets);

  logVerbose(verbose, 'Done.');

  printJson({
    floorPrices,
    fetchedAt: new Date().toISOString(),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
