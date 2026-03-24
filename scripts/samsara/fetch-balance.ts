#!/usr/bin/env tsx
/**
 * Fetch user market balances (wallet + staked navToken, base token, prANA, rewards, debt).
 *
 * Usage: npx tsx scripts/samsara/fetch-balance.ts <pubkey> [--market <name>] [--rpc <url>] [--verbose]
 *
 * Arguments:
 *   <pubkey>         User wallet public key
 *
 * Options:
 *   --market <name>  Fetch balances for a specific market (default: all markets)
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
  const { rpcUrl, verbose, getArg, getFlag } = parseScriptArgs();
  const userPubkey = getArg(0);
  const marketName = getFlag('--market');

  if (!userPubkey) {
    console.error('Usage: npx tsx scripts/samsara/fetch-balance.ts <pubkey> [--market <name>] [--rpc <url>] [--verbose]');
    console.error('');
    console.error(`Available markets: ${availableMarkets().join(', ')}`);
    process.exit(1);
  }

  logVerbose(verbose, `RPC: ${rpcUrl}`);
  logVerbose(verbose, `User: ${userPubkey}`);

  const rpcClient = new DefaultSolanaRpcClient(rpcUrl);
  const client = SamsaraClient.fromRpcClient(rpcClient);

  if (marketName) {
    const market = getMarketByName(marketName);
    if (!market) {
      console.error(`Unknown market: ${marketName}`);
      console.error(`Available markets: ${availableMarkets().join(', ')}`);
      process.exit(1);
    }
    logVerbose(verbose, `Fetching balances for market: ${market.name}`);
  }

  const balances = await client.fetchAllMarketBalances(userPubkey, {
    marketName,
  });

  printJson({
    user: userPubkey,
    balances,
    fetchedAt: new Date().toISOString(),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
