#!/usr/bin/env tsx
/**
 * Fetch current Nirvana token prices with caching and pagination.
 *
 * Usage: npx tsx scripts/nirvana/get-prices.ts [--rpc <url>] [--verbose]
 *        [--max-pages <n>] [--page-size <n>]
 *
 * Environment:
 *   SOLANA_RPC_URL - RPC endpoint (default: https://api.mainnet-beta.solana.com)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { NirvanaClient } from '../../src/index.js';
import { parseScriptArgs, printJson, logVerbose } from '../helpers.js';

const CACHE_FILE = '/tmp/nirvana_price_cache.json';

async function main() {
  const { rpcUrl, verbose, getIntFlag } = parseScriptArgs();
  const maxPages = getIntFlag('--max-pages', 10);
  const pageSize = getIntFlag('--page-size', 20);

  logVerbose(verbose, `RPC: ${rpcUrl}`);
  const client = NirvanaClient.fromRpcUrl(rpcUrl);

  // Load cache
  let cache: Record<string, unknown> | null = null;
  if (existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
      logVerbose(verbose, `Cache: loaded from ${CACHE_FILE}`);
      logVerbose(verbose, `  checkpoint: ${cache?.newestCheckedSignature}`);
      logVerbose(verbose, `  price: $${cache?.price}`);
    } catch {
      logVerbose(verbose, 'Cache: failed to load');
    }
  }

  logVerbose(verbose, '\nFetching prices...');

  // Fetch floor price
  const floor = await client.fetchFloorPrice();
  logVerbose(verbose, `Floor price: $${floor.toFixed(6)}`);

  // Fetch ANA price with paging
  const afterSignature = cache?.newestCheckedSignature as string | undefined;
  const priceResult = await client.fetchLatestAnaPriceWithPaging({
    afterSignature,
    maxPages,
    pageSize,
  });

  let anaPrice: number | undefined;
  let priceSignature: string | undefined;

  if (priceResult.status === 'found') {
    anaPrice = priceResult.price;
    priceSignature = priceResult.signature;
    logVerbose(verbose, `ANA price: $${anaPrice?.toFixed(6)} (from tx ${priceSignature})`);
  } else if (priceResult.status === 'reachedAfterLimit') {
    anaPrice = cache?.price as number | undefined;
    priceSignature = cache?.signature as string | undefined;
    logVerbose(verbose, `ANA price: $${anaPrice?.toFixed(6)} (cached, no new txs)`);
  } else if (priceResult.status === 'limitReached') {
    logVerbose(verbose, `No buy/sell found in ${maxPages} pages`);
  } else {
    logVerbose(verbose, `Error: ${priceResult.errorMessage}`);
  }

  const pranaPrice = anaPrice != null ? anaPrice - floor : undefined;

  // Save cache
  if (priceResult.status === 'found' || priceResult.status === 'limitReached') {
    const newCache = {
      price: anaPrice ?? cache?.price,
      signature: priceSignature ?? cache?.signature,
      newestCheckedSignature: priceResult.newestCheckedSignature ?? cache?.newestCheckedSignature,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(CACHE_FILE, JSON.stringify(newCache, null, 2));
    logVerbose(verbose, `Cache: saved to ${CACHE_FILE}`);
  }

  printJson({
    ANA: anaPrice ?? null,
    floor,
    prANA: pranaPrice ?? null,
    status: priceResult.status,
    updatedAt: new Date().toISOString(),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
