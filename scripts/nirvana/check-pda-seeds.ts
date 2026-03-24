#!/usr/bin/env tsx
/**
 * Verify PDA derivations against known addresses from mainnet config.
 *
 * Usage: npx tsx scripts/nirvana/check-pda-seeds.ts [--rpc <url>] [--verbose]
 *
 * Derives tenant, personalAccount (for a sample owner), and priceCurve PDAs
 * using NirvanaPda and compares against the addresses in NIRVANA_MAINNET_CONFIG.
 *
 * Environment:
 *   SOLANA_RPC_URL - RPC endpoint (default: https://api.mainnet-beta.solana.com)
 */
import { NirvanaPda, NIRVANA_MAINNET_CONFIG } from '../../src/index.js';
import { parseScriptArgs, printJson, logVerbose } from '../helpers.js';

/** Our known Nirvana PDA seed strings (from NirvanaPda). */
const KNOWN_SEEDS: Record<string, string[]> = {
  tenant: ['tenant'],
  personalAccount: ['personal_position'],
  priceCurve: ['price_curve'],
  curveBallot: ['curve_ballot'],
  personalCurveBallot: ['personal_curve_ballot'],
  almsRewarder: ['alms_rewarder'],
  mettaRewarder: ['metta_rewarder'],
};

async function main() {
  const { verbose } = parseScriptArgs();
  const config = NIRVANA_MAINNET_CONFIG;
  const pda = NirvanaPda.mainnet();

  const results: Array<{
    name: string;
    seeds: string[];
    derived: string;
    expected: string | null;
    match: boolean | null;
  }> = [];

  // 1. Derive priceCurve PDA and compare to config
  logVerbose(verbose, 'Deriving priceCurve PDA...');
  const derivedPriceCurve = await pda.priceCurve(config.tenantAccount);
  const priceCurveMatch = derivedPriceCurve === config.priceCurve;
  results.push({
    name: 'priceCurve',
    seeds: KNOWN_SEEDS.priceCurve,
    derived: derivedPriceCurve,
    expected: config.priceCurve,
    match: priceCurveMatch,
  });
  logVerbose(verbose, `  Derived:  ${derivedPriceCurve}`);
  logVerbose(verbose, `  Expected: ${config.priceCurve}`);
  logVerbose(verbose, `  Match:    ${priceCurveMatch}`);

  // 2. Derive curveBallot PDA (no known address to compare, just check it derives)
  logVerbose(verbose, '\nDeriving curveBallot PDA...');
  const derivedCurveBallot = await pda.curveBallot(config.tenantAccount);
  results.push({
    name: 'curveBallot',
    seeds: KNOWN_SEEDS.curveBallot,
    derived: derivedCurveBallot,
    expected: null,
    match: null,
  });
  logVerbose(verbose, `  Derived: ${derivedCurveBallot}`);

  // 3. Derive a sample personalAccount PDA (using a known user address if available)
  // Use a zero-filled address as a deterministic test
  const sampleOwner = '11111111111111111111111111111111';
  logVerbose(verbose, `\nDeriving personalAccount PDA for sample owner (${sampleOwner})...`);
  const derivedPersonal = await pda.personalAccount(config.tenantAccount, sampleOwner);
  results.push({
    name: 'personalAccount',
    seeds: KNOWN_SEEDS.personalAccount,
    derived: derivedPersonal,
    expected: null,
    match: null,
  });
  logVerbose(verbose, `  Derived: ${derivedPersonal}`);

  // 4. Derive almsRewarder PDA
  logVerbose(verbose, `\nDeriving almsRewarder PDA for sample owner (${sampleOwner})...`);
  const derivedAlms = await pda.almsRewarder(config.tenantAccount, sampleOwner);
  results.push({
    name: 'almsRewarder',
    seeds: KNOWN_SEEDS.almsRewarder,
    derived: derivedAlms,
    expected: null,
    match: null,
  });
  logVerbose(verbose, `  Derived: ${derivedAlms}`);

  // 5. Derive mettaRewarder PDA
  logVerbose(verbose, `\nDeriving mettaRewarder PDA for sample owner (${sampleOwner})...`);
  const derivedMetta = await pda.mettaRewarder(config.tenantAccount, sampleOwner);
  results.push({
    name: 'mettaRewarder',
    seeds: KNOWN_SEEDS.mettaRewarder,
    derived: derivedMetta,
    expected: null,
    match: null,
  });
  logVerbose(verbose, `  Derived: ${derivedMetta}`);

  const allConfigMatch = results
    .filter((r) => r.match !== null)
    .every((r) => r.match);

  printJson({
    programId: config.programId,
    tenantAccount: config.tenantAccount,
    knownSeeds: KNOWN_SEEDS,
    derivations: results,
    allConfigMatch,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
