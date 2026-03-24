#!/usr/bin/env tsx
/**
 * Build an unsigned deposit navToken transaction (stake navToken into market).
 *
 * Usage: npx tsx scripts/samsara/deposit-nav.ts <amount> --market <name> [--keypair <path>] [--rpc <url>] [--verbose]
 *
 * Arguments:
 *   <amount>           Amount of navToken to deposit (in human units)
 *
 * Options:
 *   --market <name>    Market to deposit into (default: navSOL)
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
  toLamports,
} from '../../src/index.js';
import { parseScriptArgs, printJson, logVerbose } from '../helpers.js';

async function main() {
  const { rpcUrl, verbose, getArg, getFlag, keypairPath } = parseScriptArgs();
  const amountStr = getArg(0);
  const marketName = getFlag('--market', 'navSOL');

  if (!amountStr) {
    console.error('Usage: npx tsx scripts/samsara/deposit-nav.ts <amount> --market <name> [--keypair <path>] [--rpc <url>]');
    console.error('');
    console.error(`Available markets: ${availableMarkets().join(', ')}`);
    process.exit(1);
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    console.error(`Invalid amount: ${amountStr}`);
    process.exit(1);
  }

  const market = getMarketByName(marketName!);
  if (!market) {
    console.error(`Unknown market: ${marketName}`);
    console.error(`Available markets: ${availableMarkets().join(', ')}`);
    process.exit(1);
  }

  if (!keypairPath) {
    console.error('Keypair path required. Use --keypair <path> or set SOLANA_KEYPAIR_PATH.');
    process.exit(1);
  }

  logVerbose(verbose, `RPC: ${rpcUrl}`);
  logVerbose(verbose, `Market: ${market.name}`);
  logVerbose(verbose, `Amount: ${amount} ${market.name}`);

  const rpcClient = new DefaultSolanaRpcClient(rpcUrl);
  const client = SamsaraClient.fromRpcClient(rpcClient);

  const amountLamports = toLamports(amount, market.navDecimals);

  logVerbose(verbose, `Amount lamports: ${amountLamports}`);
  logVerbose(verbose, 'Building unsigned transaction...');

  const txBytes = await client.buildUnsignedDepositNavTokenTransaction({
    userPubkey: keypairPath,
    market,
    amountLamports: Number(amountLamports),
  });

  const txBase64 = Buffer.from(txBytes).toString('base64');

  printJson({
    market: market.name,
    action: 'deposit',
    amount,
    navName: market.name,
    unsignedTransaction: txBase64,
    createdAt: new Date().toISOString(),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
