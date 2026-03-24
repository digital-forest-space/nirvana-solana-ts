#!/usr/bin/env tsx
/**
 * Build an unsigned buy ANA transaction (no keypair needed, just pubkey).
 *
 * Usage: npx tsx scripts/nirvana/buy-ana-unsigned.ts <pubkey> <amount> [--use-nirv] [--rpc <url>] [--verbose]
 *
 * The amount is in USDC (or NIRV if --use-nirv is specified).
 * Outputs the unsigned instruction as base64.
 *
 * Environment:
 *   SOLANA_RPC_URL - RPC endpoint (default: https://api.mainnet-beta.solana.com)
 */
import {
  NirvanaTransactionBuilder,
  NirvanaAccountResolver,
  DefaultSolanaRpcClient,
  toLamports,
  base64Encode,
} from '../../src/index.js';
import { parseScriptArgs, printJson, logVerbose } from '../helpers.js';

async function main() {
  const { rpcUrl, verbose, getArg } = parseScriptArgs();
  const pubkey = getArg(0);
  const amountStr = getArg(1);
  const useNirv = process.argv.some((a) => a.toLowerCase() === '--use-nirv');

  if (!pubkey || !amountStr) {
    console.error('Usage: npx tsx scripts/nirvana/buy-ana-unsigned.ts <pubkey> <amount> [--use-nirv] [--rpc <url>] [--verbose]');
    console.error('');
    console.error('Options:');
    console.error('  --use-nirv      Pay with NIRV instead of USDC');
    console.error('  --rpc <url>     Custom RPC endpoint');
    console.error('  --verbose       Show detailed output');
    console.error('');
    console.error('Environment:');
    console.error('  SOLANA_RPC_URL  RPC endpoint');
    process.exit(1);
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    console.error(JSON.stringify({ success: false, error: `Invalid amount: ${amountStr}` }));
    process.exit(1);
  }

  logVerbose(verbose, `Wallet: ${pubkey}`);
  logVerbose(verbose, `RPC: ${rpcUrl}`);
  logVerbose(verbose, `Payment: ${useNirv ? 'NIRV' : 'USDC'}`);
  logVerbose(verbose, `Amount: ${amount}`);

  const rpcClient = new DefaultSolanaRpcClient(rpcUrl);
  const resolver = new NirvanaAccountResolver(rpcClient);
  const builder = new NirvanaTransactionBuilder();

  // Resolve user accounts
  logVerbose(verbose, '\nResolving accounts...');
  const accounts = await resolver.resolveUserAccounts(pubkey);
  const paymentAccount = useNirv ? accounts.nirvAccount : accounts.usdcAccount;

  if (!paymentAccount || !accounts.anaAccount) {
    console.error(JSON.stringify({
      success: false,
      error: 'Could not resolve required token accounts',
      accounts: { payment: paymentAccount ?? null, ana: accounts.anaAccount ?? null },
    }));
    process.exit(1);
  }

  // Build instruction (USDC and NIRV both have 6 decimals)
  const lamports = toLamports(amount, 6);
  const minAna = 0n; // No slippage protection in script

  const instruction = builder.buildBuyExact2Instruction(
    pubkey,
    paymentAccount,
    accounts.anaAccount,
    lamports,
    minAna,
  );

  logVerbose(verbose, '\nInstruction built successfully');
  logVerbose(verbose, `  Program: ${instruction.programAddress}`);
  logVerbose(verbose, `  Accounts: ${instruction.accounts.length}`);
  logVerbose(verbose, `  Data: ${instruction.data.length} bytes`);

  // Output the unsigned instruction as base64 for external signing
  printJson({
    success: true,
    type: 'buyAna',
    userAddress: pubkey,
    amount,
    paymentCurrency: useNirv ? 'NIRV' : 'USDC',
    instruction: {
      programAddress: instruction.programAddress,
      accountCount: instruction.accounts.length,
      dataBase64: base64Encode(instruction.data),
    },
    note: 'Unsigned instruction. Compile into a versioned transaction, sign externally, and send.',
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
