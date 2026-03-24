#!/usr/bin/env tsx
/**
 * Build an unsigned stake ANA instruction (deposit ANA).
 *
 * Usage: npx tsx scripts/nirvana/stake-ana.ts <ana_amount> [--rpc <url>] [--keypair <path>] [--verbose]
 *
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
    console.error('Usage: npx tsx scripts/nirvana/stake-ana.ts <ana_amount> [--rpc <url>] [--keypair <path>] [--verbose]');
    console.error('');
    console.error('Options:');
    console.error('  --keypair <path>    Path to Solana keypair JSON');
    console.error('  --rpc <url>         Custom RPC endpoint');
    console.error('  --verbose           Show detailed output');
    console.error('');
    console.error('Environment:');
    console.error('  SOLANA_KEYPAIR_PATH  Keypair file path');
    console.error('  SOLANA_RPC_URL       RPC endpoint');
    process.exit(1);
  }

  const anaAmount = parseFloat(amountStr);
  if (isNaN(anaAmount) || anaAmount <= 0) {
    console.error(JSON.stringify({ success: false, error: `Invalid amount: ${amountStr}` }));
    process.exit(1);
  }

  const userAddress = loadPubkeyFromKeypair(keypairPath);

  logVerbose(verbose, `Wallet: ${userAddress}`);
  logVerbose(verbose, `RPC: ${rpcUrl}`);
  logVerbose(verbose, `Staking: ${anaAmount} ANA`);

  const rpcClient = new DefaultSolanaRpcClient(rpcUrl);
  const resolver = new NirvanaAccountResolver(rpcClient);
  const builder = new NirvanaTransactionBuilder();

  // Resolve user accounts
  logVerbose(verbose, '\nResolving accounts...');
  const accounts = await resolver.resolveUserAccounts(userAddress);
  const personalAccount = await resolver.derivePersonalAccount(userAddress);

  if (!accounts.anaAccount) {
    console.error(JSON.stringify({
      success: false,
      error: 'Could not resolve ANA token account',
    }));
    process.exit(1);
  }

  logVerbose(verbose, `  Personal account PDA: ${personalAccount}`);

  // Build instruction (ANA has 6 decimals)
  const anaLamports = toLamports(anaAmount, 6);

  const instruction = builder.buildDepositAnaInstruction(
    userAddress,
    personalAccount,
    accounts.anaAccount,
    anaLamports,
  );

  logVerbose(verbose, '\nInstruction built successfully');
  logVerbose(verbose, `  Program: ${instruction.programAddress}`);
  logVerbose(verbose, `  Accounts: ${instruction.accounts.length}`);
  logVerbose(verbose, `  Data: ${instruction.data.length} bytes`);

  // NOTE: In production, this instruction would be compiled into a transaction message,
  // signed with the keypair, and sent to the network.
  printJson({
    success: true,
    type: 'stakeAna',
    userAddress,
    anaAmount,
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
