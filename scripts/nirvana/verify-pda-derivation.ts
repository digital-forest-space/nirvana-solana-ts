#!/usr/bin/env tsx
/**
 * Cross-check PDA derivations against on-chain data.
 *
 * Usage: npx tsx scripts/nirvana/verify-pda-derivation.ts [--rpc <url>] [--verbose]
 *
 * Derives singleton PDAs (priceCurve, curveBallot) and fetches account info via
 * RPC to verify that the derived addresses exist on-chain. Also searches for a
 * personalAccount via getProgramAccounts and verifies our derivation matches.
 *
 * Environment:
 *   SOLANA_RPC_URL - RPC endpoint (default: https://api.mainnet-beta.solana.com)
 */
import { getAddressDecoder } from '@solana/kit';
import {
  NirvanaPda,
  NIRVANA_MAINNET_CONFIG,
  DefaultSolanaRpcClient,
  base64Decode,
} from '../../src/index.js';
import { parseScriptArgs, printJson, logVerbose } from '../helpers.js';

async function main() {
  const { rpcUrl, verbose } = parseScriptArgs();
  const config = NIRVANA_MAINNET_CONFIG;
  const pda = NirvanaPda.mainnet();
  const rpcClient = new DefaultSolanaRpcClient(rpcUrl);
  const decoder = getAddressDecoder();

  const results: Array<Record<string, unknown>> = [];
  let allMatch = true;

  // 1. Verify priceCurve PDA
  logVerbose(verbose, 'Deriving priceCurve PDA...');
  const derivedPriceCurve = await pda.priceCurve(config.tenantAccount);
  const priceCurveMatch = derivedPriceCurve === config.priceCurve;
  if (!priceCurveMatch) allMatch = false;

  const priceCurveInfo = await rpcClient.getAccountInfo(derivedPriceCurve);
  results.push({
    name: 'priceCurve',
    derived: derivedPriceCurve,
    expected: config.priceCurve,
    match: priceCurveMatch,
    existsOnChain: priceCurveInfo !== null,
    owner: priceCurveInfo?.owner ?? null,
  });
  logVerbose(verbose, `  Derived:  ${derivedPriceCurve}`);
  logVerbose(verbose, `  Expected: ${config.priceCurve}`);
  logVerbose(verbose, `  Match:    ${priceCurveMatch}`);
  logVerbose(verbose, `  On-chain: ${priceCurveInfo ? 'EXISTS' : 'NOT FOUND'}`);

  // 2. Verify curveBallot PDA (no known address, check on-chain existence)
  logVerbose(verbose, '\nDeriving curveBallot PDA...');
  const derivedCurveBallot = await pda.curveBallot(config.tenantAccount);
  const curveBallotInfo = await rpcClient.getAccountInfo(derivedCurveBallot);
  results.push({
    name: 'curveBallot',
    derived: derivedCurveBallot,
    note: 'No known address to compare - checking on-chain existence',
    existsOnChain: curveBallotInfo !== null,
    owner: curveBallotInfo?.owner ?? null,
  });
  logVerbose(verbose, `  Derived:  ${derivedCurveBallot}`);
  logVerbose(verbose, `  On-chain: ${curveBallotInfo ? 'EXISTS' : 'NOT FOUND'}`);

  // 3. Find a personalAccount via getProgramAccounts and verify derivation
  logVerbose(verbose, '\nSearching for a personalAccount to verify derivation...');
  try {
    const programAccounts = await rpcClient.getProgramAccounts(config.programId, {
      dataSize: 272,
    });

    if (programAccounts.length > 0) {
      const account = programAccounts[0];
      const accountPubkey = account.pubkey;

      if (account.account.data) {
        const dataBytes = base64Decode(account.account.data);

        if (dataBytes.length >= 72) {
          // Personal account layout: discriminator (8) + owner (32) + tenant (32)
          const ownerBytes = new Uint8Array(dataBytes.slice(8, 40));
          const tenantBytes = new Uint8Array(dataBytes.slice(40, 72));
          const ownerPubkey = decoder.decode(ownerBytes);
          const onChainTenant = decoder.decode(tenantBytes);

          logVerbose(verbose, `  Found account: ${accountPubkey}`);
          logVerbose(verbose, `  Owner (offset 8):  ${ownerPubkey}`);
          logVerbose(verbose, `  Tenant (offset 40): ${onChainTenant}`);

          if (onChainTenant !== config.tenantAccount) {
            logVerbose(verbose, `  WARNING: on-chain tenant differs from config tenant (${config.tenantAccount})`);
          }

          // Derive using the tenant stored in the account data
          const derivedPersonal = await pda.personalAccount(onChainTenant, ownerPubkey);
          const personalMatch = derivedPersonal === accountPubkey;
          if (!personalMatch) allMatch = false;

          results.push({
            name: 'personalAccount',
            derived: derivedPersonal,
            expected: accountPubkey,
            match: personalMatch,
            owner: ownerPubkey,
            tenant: onChainTenant,
          });
          logVerbose(verbose, `  Derived:  ${derivedPersonal}`);
          logVerbose(verbose, `  Expected: ${accountPubkey}`);
          logVerbose(verbose, `  Match:    ${personalMatch}`);
        }
      }
    } else {
      logVerbose(verbose, '  No personalAccount accounts found via getProgramAccounts');
      results.push({
        name: 'personalAccount',
        note: 'No accounts found via getProgramAccounts (dataSize=272)',
      });
    }
  } catch (err) {
    logVerbose(verbose, `  Error searching for personalAccount: ${err}`);
    results.push({
      name: 'personalAccount',
      error: `Failed to search: ${err}`,
    });
  }

  // 4. Verify tenant account exists on-chain
  logVerbose(verbose, '\nVerifying tenant account...');
  const tenantInfo = await rpcClient.getAccountInfo(config.tenantAccount);
  results.push({
    name: 'tenantAccount',
    address: config.tenantAccount,
    existsOnChain: tenantInfo !== null,
    owner: tenantInfo?.owner ?? null,
  });
  logVerbose(verbose, `  Address:  ${config.tenantAccount}`);
  logVerbose(verbose, `  On-chain: ${tenantInfo ? 'EXISTS' : 'NOT FOUND'}`);
  if (tenantInfo) {
    logVerbose(verbose, `  Owner:    ${tenantInfo.owner}`);
  }

  printJson({
    rpcUrl,
    programId: config.programId,
    results,
    allMatch,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
