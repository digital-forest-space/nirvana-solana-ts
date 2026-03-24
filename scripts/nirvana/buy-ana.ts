#!/usr/bin/env tsx
/**
 * Build an unsigned buy ANA instruction.
 *
 * Usage: npx tsx scripts/nirvana/buy-ana.ts <amount> [--use-nirv] [--rpc <url>] [--keypair <path>] [--verbose]
 *
 * The amount is in USDC (or NIRV if --use-nirv is specified).
 * Reads keypair from SOLANA_KEYPAIR_PATH env or --keypair flag to derive the pubkey.
 *
 * Environment:
 *   SOLANA_RPC_URL       - RPC endpoint (default: https://api.mainnet-beta.solana.com)
 *   SOLANA_KEYPAIR_PATH  - Path to keypair JSON file
 */
import { readFileSync } from 'node:fs';
import { getAddressDecoder } from '@solana/kit';
import {
  NirvanaTransactionBuilder,
  NirvanaAccountResolver,
  DefaultSolanaRpcClient,
  toLamports,
  base64Encode,
} from '../../src/index.js';
import { parseScriptArgs, printJson, logVerbose } from '../helpers.js';

function loadPubkeyFromKeypair(keypairPath: string): string {
  const keypairJson = readFileSync(keypairPath, 'utf-8');
  const keypairBytes = JSON.parse(keypairJson) as number[];
  const pubkeyBytes = new Uint8Array(keypairBytes.slice(32, 64));
  return getAddressDecoder().decode(pubkeyBytes);
}

async function main() {
  const { rpcUrl, verbose, getArg, keypairPath } = parseScriptArgs();
  const amountStr = getArg(0);
  const useNirv = process.argv.some((a) => a.toLowerCase() === '--use-nirv');

  if (!amountStr || !keypairPath) {
    console.error('Usage: npx tsx scripts/nirvana/buy-ana.ts <amount> [--use-nirv] [--rpc <url>] [--keypair <path>] [--verbose]');
    console.error('');
    console.error('Options:');
    console.error('  --use-nirv          Pay with NIRV instead of USDC');
    console.error('  --keypair <path>    Path to Solana keypair JSON');
    console.error('  --rpc <url>         Custom RPC endpoint');
    console.error('  --verbose           Show detailed output');
    console.error('');
    console.error('Environment:');
    console.error('  SOLANA_KEYPAIR_PATH  Keypair file path');
    console.error('  SOLANA_RPC_URL       RPC endpoint');
    process.exit(1);
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    console.error(JSON.stringify({ success: false, error: `Invalid amount: ${amountStr}` }));
    process.exit(1);
  }

  const userAddress = loadPubkeyFromKeypair(keypairPath);

  logVerbose(verbose, `Wallet: ${userAddress}`);
  logVerbose(verbose, `RPC: ${rpcUrl}`);
  logVerbose(verbose, `Payment: ${useNirv ? 'NIRV' : 'USDC'}`);
  logVerbose(verbose, `Amount: ${amount}`);

  const rpcClient = new DefaultSolanaRpcClient(rpcUrl);
  const resolver = new NirvanaAccountResolver(rpcClient);
  const builder = new NirvanaTransactionBuilder();

  // Resolve user accounts
  logVerbose(verbose, '\nResolving accounts...');
  const accounts = await resolver.resolveUserAccounts(userAddress);
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
    userAddress,
    paymentAccount,
    accounts.anaAccount,
    lamports,
    minAna,
  );

  logVerbose(verbose, '\nInstruction built successfully');
  logVerbose(verbose, `  Program: ${instruction.programAddress}`);
  logVerbose(verbose, `  Accounts: ${instruction.accounts.length}`);
  logVerbose(verbose, `  Data: ${instruction.data.length} bytes`);

  // NOTE: In production, this instruction would be compiled into a transaction message,
  // signed with the keypair, and sent to the network.
  printJson({
    success: true,
    type: 'buyAna',
    userAddress,
    amount,
    paymentCurrency: useNirv ? 'NIRV' : 'USDC',
    instruction: {
      programAddress: instruction.programAddress,
      accountCount: instruction.accounts.length,
      dataBase64: base64Encode(instruction.data),
    },
    note: 'Unsigned instruction built. In production, compile into a versioned transaction, sign, and send.',
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
