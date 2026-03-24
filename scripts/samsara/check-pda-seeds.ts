#!/usr/bin/env tsx
/**
 * Verify Samsara and Mayflower PDA derivations against known market addresses.
 *
 * Usage: npx tsx scripts/samsara/check-pda-seeds.ts [--verbose]
 *
 * Derives PDAs from known inputs using SamsaraPda and MayflowerPda, then
 * compares against the expected addresses from config. This is useful for
 * verifying that the PDA seed logic is correct.
 */
import {
  SamsaraPda,
  MayflowerPda,
  SAMSARA_MAINNET_CONFIG,
  NAV_SOL_MARKET,
  NAV_TOKEN_MARKETS,
} from '../../src/index.js';
import { parseScriptArgs, printJson, logVerbose } from '../helpers.js';

async function main() {
  const { verbose } = parseScriptArgs();

  const samsaraPda = SamsaraPda.mainnet();
  const mayflowerPda = MayflowerPda.mainnet();

  const results: Array<{
    label: string;
    derived: string;
    expected: string | null;
    match: boolean | null;
  }> = [];

  // Use a known user pubkey for personal account derivations
  const testUser = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

  logVerbose(verbose, 'Deriving Samsara PDAs...');

  // Samsara log counter
  const logCounter = await samsaraPda.logCounter();
  results.push({
    label: 'Samsara logCounter',
    derived: logCounter,
    expected: null,
    match: null,
  });
  logVerbose(verbose, `  logCounter: ${logCounter}`);

  // Mayflower log account
  const logAccount = await mayflowerPda.logAccount();
  results.push({
    label: 'Mayflower logAccount',
    derived: logAccount,
    expected: null,
    match: null,
  });
  logVerbose(verbose, `  logAccount: ${logAccount}`);

  // Samsara tenant
  const samsaraTenant = await samsaraPda.tenant(SAMSARA_MAINNET_CONFIG.samsaraTenant);
  results.push({
    label: 'Samsara tenant',
    derived: samsaraTenant,
    expected: null,
    match: null,
  });
  logVerbose(verbose, `  samsaraTenant: ${samsaraTenant}`);

  // Mayflower tenant
  const mayflowerTenant = await mayflowerPda.tenant(SAMSARA_MAINNET_CONFIG.mayflowerTenant);
  results.push({
    label: 'Mayflower tenant',
    derived: mayflowerTenant,
    expected: null,
    match: null,
  });
  logVerbose(verbose, `  mayflowerTenant: ${mayflowerTenant}`);

  // Per-market PDAs
  for (const market of Object.values(NAV_TOKEN_MARKETS)) {
    logVerbose(verbose, `\nMarket: ${market.name}`);

    // Samsara market PDA (derived from marketMetadata)
    const samsaraMarket = await samsaraPda.market(market.marketMetadata);
    const samsaraMatch = samsaraMarket === market.samsaraMarket;
    results.push({
      label: `${market.name} samsaraMarket`,
      derived: samsaraMarket,
      expected: market.samsaraMarket,
      match: samsaraMatch,
    });
    logVerbose(verbose, `  samsaraMarket: ${samsaraMarket} (expected: ${market.samsaraMarket}, match: ${samsaraMatch})`);

    // Mayflower market PDA
    const mayflowerMarket = await mayflowerPda.market(market.marketMetadata);
    results.push({
      label: `${market.name} mayflowerMarket`,
      derived: mayflowerMarket,
      expected: market.mayflowerMarket,
      match: mayflowerMarket === market.mayflowerMarket,
    });

    // Market metadata PDA
    const marketMeta = await mayflowerPda.marketMeta(market.marketMetadata);
    results.push({
      label: `${market.name} marketMeta`,
      derived: marketMeta,
      expected: market.marketMetadata,
      match: marketMeta === market.marketMetadata,
    });

    // Personal position PDA (for test user)
    const personalPosition = await mayflowerPda.personalPosition(market.marketMetadata, testUser);
    results.push({
      label: `${market.name} personalPosition (${testUser.slice(0, 8)}...)`,
      derived: personalPosition,
      expected: null,
      match: null,
    });

    // Personal position escrow PDA
    const positionEscrow = await mayflowerPda.personalPositionEscrow(personalPosition);
    results.push({
      label: `${market.name} personalPositionEscrow`,
      derived: positionEscrow,
      expected: null,
      match: null,
    });

    // Samsara personal gov account PDA
    const govAccount = await samsaraPda.personalGovAccount(market.samsaraMarket, testUser);
    results.push({
      label: `${market.name} personalGovAccount (${testUser.slice(0, 8)}...)`,
      derived: govAccount,
      expected: null,
      match: null,
    });

    // prANA escrow PDA
    const pranaEscrow = await samsaraPda.personalGovPranaEscrow(govAccount);
    results.push({
      label: `${market.name} pranaEscrow`,
      derived: pranaEscrow,
      expected: null,
      match: null,
    });

    // Cash escrow PDA
    const cashEscrow = await samsaraPda.marketCashEscrow(market.samsaraMarket);
    results.push({
      label: `${market.name} cashEscrow`,
      derived: cashEscrow,
      expected: null,
      match: null,
    });

    // Liq vault main PDA
    const liqVaultMain = await mayflowerPda.liqVaultMain(market.marketMetadata);
    results.push({
      label: `${market.name} liqVaultMain`,
      derived: liqVaultMain,
      expected: null,
      match: null,
    });
  }

  // Summary
  const verified = results.filter((r) => r.match === true).length;
  const mismatched = results.filter((r) => r.match === false).length;
  const unverified = results.filter((r) => r.match === null).length;

  printJson({
    testUser,
    summary: { verified, mismatched, unverified, total: results.length },
    results,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
