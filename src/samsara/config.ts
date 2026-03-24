/** Configuration for Samsara protocol (navToken derivatives). */
export interface SamsaraConfig {
  readonly samsaraProgramId: string;
  readonly mayflowerProgramId: string;
  readonly mayflowerTenant: string;
  readonly samsaraTenant: string;
  readonly pranaMint: string;
  readonly tokenProgram: string;
  readonly associatedTokenProgram: string;
  readonly systemProgram: string;
  readonly computeBudgetProgram: string;
}

/** Mainnet configuration for Samsara protocol. */
export const SAMSARA_MAINNET_CONFIG: SamsaraConfig = {
  samsaraProgramId: 'SAMmdq34d9RJoqoqfnGhMRUvZumQriaT55eGzXeAQj7',
  mayflowerProgramId: 'AVMmmRzwc2kETQNhPiFVnyu62HrgsQXTD6D7SnSfEz7v',
  mayflowerTenant: '81JEJdJSZbaXixpD8WQSBWBfkDa6m6KpXpSErzYUHq6z',
  samsaraTenant: 'FvLdBhqeSJktfcUGq5S4mpNAiTYg2hUhto8AHzjqskTC',
  pranaMint: 'CLr7G2af9VSfH1PFZ5fYvB8WK1DTgE85qrVjpa8Xkg4N',
  tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  associatedTokenProgram: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  systemProgram: '11111111111111111111111111111111',
  computeBudgetProgram: 'ComputeBudget111111111111111111111111111111',
} as const;

/** Configuration for a specific navToken market. */
export interface NavTokenMarket {
  readonly name: string;
  /** Base token name, e.g., 'SOL', 'cbBTC'. */
  readonly baseName: string;
  readonly baseMint: string;
  readonly navMint: string;
  readonly samsaraMarket: string;
  readonly mayflowerMarket: string;
  readonly marketMetadata: string;
  readonly marketGroup: string;
  readonly marketSolVault: string;
  readonly marketNavVault: string;
  readonly feeVault: string;
  readonly authorityPda: string;
  readonly baseDecimals: number;
  readonly navDecimals: number;
}

/** navSOL market configuration (SOL -> navSOL). */
export const NAV_SOL_MARKET: NavTokenMarket = {
  name: 'navSOL',
  baseName: 'SOL',
  baseMint: 'So11111111111111111111111111111111111111112',
  navMint: 'navSnrYJkCxMiyhM3F7K889X1u8JFLVHHLxiyo6Jjqo',
  samsaraMarket: '4KnomWX4ga9qmDdQN9GctJKjEnwLQTNWWHs57MyYtmYc',
  mayflowerMarket: 'A5M1nWfi6ATSamEJ1ASr2FC87BMwijthTbNRYG7BhYSc',
  marketMetadata: 'DotD4dZAyr4Kb6AD3RHid8VgmsHUzWF6LRd4WvAMezRj',
  marketGroup: 'Lmdgb4NE4T3ubmQZQZQZ7t4UP6A98NdVbmZPcoEdkdC',
  marketSolVault: '43vPhZeow3pgYa6zrPXASVQhdXTMfowyfNK87BYizhnL',
  marketNavVault: 'BCYzijbWwmqRnsTWjGhHbneST2emQY36WcRAkbkhsQMt',
  feeVault: 'B8jccpiKZjapgfw1ay6EH3pPnxqTmimsm2KsTZ9LSmjf',
  authorityPda: 'EKVkmuwDKRKHw85NPTbKSKuS75EY4NLcxe1qzSPixLdy',
  baseDecimals: 9,
  navDecimals: 9,
} as const;

/** navZEC market configuration (ZEC -> navZEC). */
export const NAV_ZEC_MARKET: NavTokenMarket = {
  name: 'navZEC',
  baseName: 'ZEC',
  baseMint: 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS',
  navMint: 'navZyeDnqgHBJQjHX8Kk7ZEzwFgDXxVJBcsAXd76gVe',
  samsaraMarket: '9JiASAyMBL9riFDPJtWCEtK4E2rr2Yfpqxoynxa3XemE',
  mayflowerMarket: '9SBSQvx5B8tKRgtYa3tyXeyvL3JMAZiA2JVXWzDnFKig',
  marketMetadata: 'HcGpdC8EtNpZPComvRaXDQtGHLpCFXMqfzRYeRSPCT5L',
  marketGroup: 'BfGgpGGyMFfZDYyXqjyPU4YG6Py5kkD93mUGXT7TxGnf',
  marketSolVault: 'GreFb71nqhudTo5iYBUa8Czgb9ACCUuTDYpm98XdLUwk',
  marketNavVault: 'CfE1xoGPJSmppr9N7ysTGq3tca5Xc22RbsbZycir1tVq',
  feeVault: 'GPpY9M9XraDsbGBpTqtnoQJugktgMDBjGM6UxdQoD3UM',
  authorityPda: '',
  baseDecimals: 8,
  navDecimals: 8,
} as const;

/** navCBBTC market configuration (cbBTC -> navCBBTC). */
export const NAV_CBBTC_MARKET: NavTokenMarket = {
  name: 'navCBBTC',
  baseName: 'cbBTC',
  baseMint: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
  navMint: 'navB4nQ2ENP18CCo1Jqw9bbLncLBC389Rf3XRCQ6zau',
  samsaraMarket: 'E9xCJujXkNBmeJ7ds1AcKhAEHuGw6E874S6XTUU5PB4Q',
  mayflowerMarket: '3WNH5EArcmVDJzi4KtaX75WiSY65mqT735GEEvqnFJ6B',
  marketMetadata: 'rQL153FrAAcepv1exoemsf9WEsC2uJaajBaaWCykvnK',
  marketGroup: 'AXJJT2A7pUAzFKaRWzGgSN9fr9sEvKdGiqbJjdyYQbqj',
  marketSolVault: 'DH1tmXZ2sDe24o4JA6KPELt8G9nk8PfZHP6zfvAxZivM',
  marketNavVault: '2kfQBRonDGXQfo1WkohTbTq55k6RcuYsfEDzXBozvR5X',
  feeVault: 'JCbzDUCn5aLiE6rvvvy5hZoYv3cJzkYFmr35A4SZxzyW',
  authorityPda: '',
  baseDecimals: 8,
  navDecimals: 8,
} as const;

/** navETH market configuration (WETH -> navETH). */
export const NAV_ETH_MARKET: NavTokenMarket = {
  name: 'navETH',
  baseName: 'WETH',
  baseMint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
  navMint: 'navEgA7saxpNqKcnJcWbCeCFMhSQtN8hQWQkK4h9scH',
  samsaraMarket: 'HMkKNuq948jBmevDZAm3kG67edF9Hc2YacNHkfeBC4SP',
  mayflowerMarket: '3AwyQgXuhQAFzMaw17V42EW2htwZknr11grEGddvZEUh',
  marketMetadata: 'XAJvRwx5PmCgCYjsKMSoSrL6MZXJtWC6dwgndFvE1uu',
  marketGroup: '72ECyHwnmmRCMrm2BuTKVgLdPSKHhDx5sNGFDYDwN8ym',
  marketSolVault: 'FpENWfyotJxhAFSsowsSERaEbWMrSopHBAgyGamrvg1a',
  marketNavVault: '6GAADZA83t5Uzk6fwZ55zisfGJ7TFPbnWTRxfLYDF6JM',
  feeVault: '8XQi1aojXMgU4FEfvZmtytQjLAzi7Qyx3theFdCwhfhb',
  authorityPda: '',
  baseDecimals: 8,
  navDecimals: 8,
} as const;

/** All known navToken markets, keyed by lowercase name. */
export const NAV_TOKEN_MARKETS: Record<string, NavTokenMarket> = {
  navsol: NAV_SOL_MARKET,
  navzec: NAV_ZEC_MARKET,
  navcbbtc: NAV_CBBTC_MARKET,
  naveth: NAV_ETH_MARKET,
};

/** Look up a market by name (case-insensitive). */
export function getMarketByName(name: string): NavTokenMarket | undefined {
  return NAV_TOKEN_MARKETS[name.toLowerCase()];
}

/** All available market names. */
export function availableMarkets(): string[] {
  return Object.values(NAV_TOKEN_MARKETS).map((m) => m.name);
}

/** Well-known mint addresses to human-readable names. */
export const WELL_KNOWN_MINTS: Record<string, { name: string; symbol: string }> = {
  // Base mints
  So11111111111111111111111111111111111111112: { name: 'Wrapped SOL', symbol: 'SOL' },
  A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS: { name: 'Zcash', symbol: 'ZEC' },
  cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: { name: 'Coinbase Wrapped BTC', symbol: 'cbBTC' },
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': { name: 'Wrapped Ether', symbol: 'WETH' },
  // Nav mints
  navSnrYJkCxMiyhM3F7K889X1u8JFLVHHLxiyo6Jjqo: { name: 'navSOL', symbol: 'navSOL' },
  navZyeDnqgHBJQjHX8Kk7ZEzwFgDXxVJBcsAXd76gVe: { name: 'navZEC', symbol: 'navZEC' },
  navB4nQ2ENP18CCo1Jqw9bbLncLBC389Rf3XRCQ6zau: { name: 'navCBBTC', symbol: 'navCBBTC' },
  navEgA7saxpNqKcnJcWbCeCFMhSQtN8hQWQkK4h9scH: { name: 'navETH', symbol: 'navETH' },
};
