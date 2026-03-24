/**
 * Shared helpers for CLI scripts.
 *
 * Usage pattern:
 *   const { rpcUrl, verbose, args } = parseScriptArgs();
 *   const client = NirvanaClient.fromRpcUrl(rpcUrl);
 */

export function parseScriptArgs(): {
  rpcUrl: string;
  verbose: boolean;
  args: string[];
  getArg: (index: number) => string | undefined;
  getFlag: (flag: string, defaultValue?: string) => string | undefined;
  getIntFlag: (flag: string, defaultValue: number) => number;
  keypairPath: string | undefined;
} {
  const rawArgs = process.argv.slice(2);
  const verbose = rawArgs.some((a) => a.toLowerCase() === '--verbose');

  // Parse --rpc flag or env
  let rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
  const rpcIndex = rawArgs.findIndex((a) => a.toLowerCase() === '--rpc');
  if (rpcIndex >= 0 && rpcIndex + 1 < rawArgs.length) {
    rpcUrl = rawArgs[rpcIndex + 1];
  }

  // Parse --keypair flag or env
  let keypairPath = process.env.SOLANA_KEYPAIR_PATH;
  const kpIndex = rawArgs.findIndex((a) => a.toLowerCase() === '--keypair');
  if (kpIndex >= 0 && kpIndex + 1 < rawArgs.length) {
    keypairPath = rawArgs[kpIndex + 1];
  }

  // Filter out flags to get positional args
  const positionalArgs: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i].startsWith('--')) {
      // Skip flag and its value (if it has one)
      if (['--rpc', '--keypair', '--max-pages', '--page-size', '--market'].includes(rawArgs[i].toLowerCase())) {
        i++; // skip value
      }
      continue;
    }
    positionalArgs.push(rawArgs[i]);
  }

  function getArg(index: number): string | undefined {
    return positionalArgs[index];
  }

  function getFlag(flag: string, defaultValue?: string): string | undefined {
    const idx = rawArgs.findIndex((a) => a.toLowerCase() === flag.toLowerCase());
    if (idx >= 0 && idx + 1 < rawArgs.length) return rawArgs[idx + 1];
    return defaultValue;
  }

  function getIntFlag(flag: string, defaultValue: number): number {
    const val = getFlag(flag);
    if (val) {
      const parsed = parseInt(val, 10);
      if (!isNaN(parsed)) return parsed;
    }
    return defaultValue;
  }

  return { rpcUrl, verbose, args: positionalArgs, getArg, getFlag, getIntFlag, keypairPath };
}

/** Print JSON result to stdout. */
export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/** Log a message only if verbose mode is on. */
export function logVerbose(verbose: boolean, ...args: unknown[]): void {
  if (verbose) console.error(...args);
}
