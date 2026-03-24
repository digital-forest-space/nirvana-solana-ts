#!/usr/bin/env tsx
/**
 * Get all Nirvana balances for a wallet address.
 *
 * Usage: npx tsx scripts/nirvana/get-balances.ts <pubkey> [--rpc <url>] [--verbose]
 *
 * Environment:
 *   SOLANA_RPC_URL - RPC endpoint (default: https://api.mainnet-beta.solana.com)
 */
import { NirvanaClient } from '../../src/index.js';
import { parseScriptArgs, printJson, logVerbose } from '../helpers.js';

async function main() {
  const { rpcUrl, verbose, getArg } = parseScriptArgs();
  const pubkey = getArg(0);
  if (!pubkey) {
    console.error('Usage: npx tsx scripts/nirvana/get-balances.ts <pubkey> [--rpc <url>] [--verbose]');
    process.exit(1);
  }

  logVerbose(verbose, `Wallet: ${pubkey}`);
  logVerbose(verbose, `RPC: ${rpcUrl}`);
  logVerbose(verbose, '\nFetching balances...');

  const client = NirvanaClient.fromRpcUrl(rpcUrl);

  const [walletBalances, personalInfo, claimablePrana, borrowCapacity] = await Promise.all([
    client.getUserBalances(pubkey),
    client.getPersonalAccountInfo(pubkey),
    client.getClaimablePrana(pubkey),
    client.getBorrowCapacity(pubkey),
  ]);

  // Get claimable revenue share
  let claimableRevshare = await client.getClaimableRevshare(pubkey);
  if (claimableRevshare.ANA === 0 && claimableRevshare.NIRV === 0) {
    claimableRevshare = await client.getClaimableRevshareViaSimulation(pubkey);
  }

  printJson({
    wallet: {
      ANA: walletBalances.ANA ?? 0,
      NIRV: walletBalances.NIRV ?? 0,
      USDC: walletBalances.USDC ?? 0,
      prANA: walletBalances.prANA ?? 0,
    },
    staked: {
      ANA: personalInfo?.stakedAna ?? 0,
      prANA: personalInfo?.stakedPrana ?? 0,
    },
    ...(borrowCapacity ? { borrow: borrowCapacity } : {}),
    claimable: {
      prANA: claimablePrana,
      revenueShare: claimableRevshare,
    },
    debt: personalInfo?.anaDebt ?? 0,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
