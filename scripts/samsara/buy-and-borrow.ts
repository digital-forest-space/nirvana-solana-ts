#!/usr/bin/env tsx
/**
 * Build an unsigned buy-and-borrow transaction (buy navToken + borrow in one TX).
 *
 * Usage: npx tsx scripts/samsara/buy-and-borrow.ts <buy-amount> <borrow-amount> --market <name> [--keypair <path>] [--rpc <url>] [--verbose]
 *
 * Arguments:
 *   <buy-amount>       Amount of base token to spend on buying navToken (in human units)
 *   <borrow-amount>    Amount of base token to borrow (in human units)
 *
 * Options:
 *   --market <name>    Market to use (default: navSOL)
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
  const buyAmountStr = getArg(0);
  const borrowAmountStr = getArg(1);
  const marketName = getFlag('--market', 'navSOL');

  if (!buyAmountStr || !borrowAmountStr) {
    console.error('Usage: npx tsx scripts/samsara/buy-and-borrow.ts <buy-amount> <borrow-amount> --market <name> [--keypair <path>] [--rpc <url>]');
    console.error('');
    console.error(`Available markets: ${availableMarkets().join(', ')}`);
    process.exit(1);
  }

  const buyAmount = parseFloat(buyAmountStr);
  const borrowAmount = parseFloat(borrowAmountStr);

  if (isNaN(buyAmount) || buyAmount <= 0) {
    console.error(`Invalid buy amount: ${buyAmountStr}`);
    process.exit(1);
  }
  if (isNaN(borrowAmount) || borrowAmount <= 0) {
    console.error(`Invalid borrow amount: ${borrowAmountStr}`);
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
  logVerbose(verbose, `Buy amount: ${buyAmount} ${market.baseName}`);
  logVerbose(verbose, `Borrow amount: ${borrowAmount} ${market.baseName}`);

  const rpcClient = new DefaultSolanaRpcClient(rpcUrl);
  const client = SamsaraClient.fromRpcClient(rpcClient);

  const buyLamports = toLamports(buyAmount, market.baseDecimals);
  const borrowLamports = toLamports(borrowAmount, market.baseDecimals);

  logVerbose(verbose, `Buy lamports: ${buyLamports}`);
  logVerbose(verbose, `Borrow lamports: ${borrowLamports}`);
  logVerbose(verbose, 'Building unsigned transaction...');

  const txBytes = await client.buildUnsignedBuyAndBorrowTransaction({
    userPubkey: keypairPath,
    market,
    buyLamports: Number(buyLamports),
    borrowLamports: Number(borrowLamports),
  });

  const txBase64 = Buffer.from(txBytes).toString('base64');

  printJson({
    market: market.name,
    action: 'buyAndBorrow',
    buyAmount,
    borrowAmount,
    baseName: market.baseName,
    unsignedTransaction: txBase64,
    createdAt: new Date().toISOString(),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
