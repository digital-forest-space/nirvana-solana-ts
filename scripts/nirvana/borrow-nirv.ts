#!/usr/bin/env tsx
/**
 * Build an unsigned borrow NIRV instruction.
 *
 * Usage: npx tsx scripts/nirvana/borrow-nirv.ts <nirv_amount> [--rpc <url>] [--keypair <path>] [--verbose]
 *
 * You must have staked ANA to borrow NIRV. Debt limit = stakedANA * floorPrice.
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

  if (!amountStr || !keypairPath) {
    console.error('Usage: npx tsx scripts/nirvana/borrow-nirv.ts <nirv_amount> [--rpc <url>] [--keypair <path>] [--verbose]');
    console.error('');
    console.error('Options:');
    console.error('  --keypair <path>    Path to Solana keypair JSON');
    console.error('  --rpc <url>         Custom RPC endpoint');
    console.error('  --verbose           Show detailed output');
    console.error('');
    console.error('Environment:');
    console.error('  SOLANA_KEYPAIR_PATH  Keypair file path');
    console.error('  SOLANA_RPC_URL       RPC endpoint');
    console.error('');
    console.error('Note: You must have staked ANA to borrow NIRV.');
    process.exit(1);
  }

  const nirvAmount = parseFloat(amountStr);
  if (isNaN(nirvAmount) || nirvAmount <= 0) {
    console.error(JSON.stringify({ success: false, error: `Invalid amount: ${amountStr}` }));
    process.exit(1);
  }

  const userAddress = loadPubkeyFromKeypair(keypairPath);

  logVerbose(verbose, `Wallet: ${userAddress}`);
  logVerbose(verbose, `RPC: ${rpcUrl}`);
  logVerbose(verbose, `Borrowing: ${nirvAmount} NIRV`);

  const rpcClient = new DefaultSolanaRpcClient(rpcUrl);
  const resolver = new NirvanaAccountResolver(rpcClient);
  const builder = new NirvanaTransactionBuilder();

  // Resolve user accounts
  logVerbose(verbose, '\nResolving accounts...');
  const accounts = await resolver.resolveUserAccounts(userAddress);
  const personalAccount = await resolver.derivePersonalAccount(userAddress);

  if (!accounts.nirvAccount) {
    console.error(JSON.stringify({
      success: false,
      error: 'Could not resolve NIRV token account',
    }));
    process.exit(1);
  }

  logVerbose(verbose, `  Personal account PDA: ${personalAccount}`);

  // Build instruction (NIRV has 6 decimals)
  const nirvLamports = toLamports(nirvAmount, 6);

  const instruction = builder.buildBorrowNirvInstruction(
    userAddress,
    personalAccount,
    accounts.nirvAccount,
    nirvLamports,
  );

  logVerbose(verbose, '\nInstruction built successfully');
  logVerbose(verbose, `  Program: ${instruction.programAddress}`);
  logVerbose(verbose, `  Accounts: ${instruction.accounts.length}`);
  logVerbose(verbose, `  Data: ${instruction.data.length} bytes`);

  // NOTE: In production, this instruction would be compiled into a transaction message,
  // signed with the keypair, and sent to the network.
  printJson({
    success: true,
    type: 'borrowNirv',
    userAddress,
    nirvAmount,
    personalAccount,
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
