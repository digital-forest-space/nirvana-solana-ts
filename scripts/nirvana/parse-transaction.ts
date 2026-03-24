#!/usr/bin/env tsx
/**
 * Parse a Nirvana transaction to show type, amounts, and price.
 *
 * Usage: npx tsx scripts/nirvana/parse-transaction.ts <signature> [--rpc <url>] [--verbose]
 *
 * Environment:
 *   SOLANA_RPC_URL - RPC endpoint (default: https://api.mainnet-beta.solana.com)
 */
import { NirvanaClient, pricePerAna } from '../../src/index.js';
import { parseScriptArgs, printJson, logVerbose } from '../helpers.js';

async function main() {
  const { rpcUrl, verbose, getArg } = parseScriptArgs();
  const signature = getArg(0);
  if (!signature) {
    console.error('Usage: npx tsx scripts/nirvana/parse-transaction.ts <signature> [--rpc <url>] [--verbose]');
    process.exit(1);
  }

  logVerbose(verbose, `RPC: ${rpcUrl}`);
  logVerbose(verbose, `\nParsing transaction: ${signature}`);

  const client = NirvanaClient.fromRpcUrl(rpcUrl);
  const tx = await client.parseTransaction(signature);

  if (verbose) {
    console.error(`  Type: ${tx.type.toUpperCase()}`);
    for (const s of tx.sent) {
      console.error(`  Sent: ${s.amount.toFixed(6)} ${s.currency}`);
    }
    for (const r of tx.received) {
      console.error(`  Received: ${r.amount.toFixed(6)} ${r.currency}`);
    }
    if (tx.fee) console.error(`  Fee: ${tx.fee.amount.toFixed(6)} ${tx.fee.currency}`);
    const price = pricePerAna(tx);
    if (price) console.error(`  Price/ANA: $${price.toFixed(6)}`);
  }

  printJson({
    signature: tx.signature,
    type: tx.type,
    sent: tx.sent,
    received: tx.received,
    fee: tx.fee ?? null,
    pricePerAna: pricePerAna(tx) ?? null,
    timestamp: tx.timestamp.toISOString(),
    userAddress: tx.userAddress,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
