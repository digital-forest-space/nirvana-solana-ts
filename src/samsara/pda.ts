import { address, getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';

const encoder = getAddressEncoder();
const textEncoder = new TextEncoder();

/**
 * Samsara protocol PDA (Program Derived Address) derivations.
 *
 * Seeds were extracted from the Samsara web app's client-side JS bundles.
 * See docs/samsara/pda_seeds.md for the full reference and discovery method.
 */
export class SamsaraPda {
  readonly programAddress: Address;

  constructor(programId: string) {
    this.programAddress = address(programId);
  }

  static mainnet(): SamsaraPda {
    return new SamsaraPda('SAMmdq34d9RJoqoqfnGhMRUvZumQriaT55eGzXeAQj7');
  }

  /** Personal governance account PDA. Seeds: ["personal_gov_account", market, owner] */
  async personalGovAccount(market: string, owner: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [
        textEncoder.encode('personal_gov_account'),
        encoder.encode(address(market)),
        encoder.encode(address(owner)),
      ],
    });
    return pda;
  }

  /** prANA escrow token account PDA. Seeds: ["prana_escrow", govAccount] */
  async personalGovPranaEscrow(govAccount: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [textEncoder.encode('prana_escrow'), encoder.encode(address(govAccount))],
    });
    return pda;
  }

  /** Singleton log counter PDA. Seeds: ["log_counter"] */
  async logCounter(): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [textEncoder.encode('log_counter')],
    });
    return pda;
  }

  /** Market PDA. Seeds: ["market", marketMeta] */
  async market(marketMeta: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [textEncoder.encode('market'), encoder.encode(address(marketMeta))],
    });
    return pda;
  }

  /** Market cash escrow PDA. Seeds: ["cash_escrow", market] */
  async marketCashEscrow(market: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [textEncoder.encode('cash_escrow'), encoder.encode(address(market))],
    });
    return pda;
  }

  /** Zen escrow PDA. Seeds: ["zen_escrow", personalAccount] */
  async personalZenEscrow(personalAccount: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [textEncoder.encode('zen_escrow'), encoder.encode(address(personalAccount))],
    });
    return pda;
  }

  /** Tenant PDA. Seeds: ["tenant", seedAddress] */
  async tenant(seedAddress: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [textEncoder.encode('tenant'), encoder.encode(address(seedAddress))],
    });
    return pda;
  }
}

/**
 * Mayflower protocol PDA (Program Derived Address) derivations.
 *
 * Seeds were extracted from the Samsara web app's client-side JS bundles.
 * See docs/samsara/pda_seeds.md for the full reference and discovery method.
 */
export class MayflowerPda {
  readonly programAddress: Address;

  constructor(programId: string) {
    this.programAddress = address(programId);
  }

  static mainnet(): MayflowerPda {
    return new MayflowerPda('AVMmmRzwc2kETQNhPiFVnyu62HrgsQXTD6D7SnSfEz7v');
  }

  /** Personal position PDA. Seeds: ["personal_position", marketMeta, owner] */
  async personalPosition(marketMeta: string, owner: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [
        textEncoder.encode('personal_position'),
        encoder.encode(address(marketMeta)),
        encoder.encode(address(owner)),
      ],
    });
    return pda;
  }

  /** Personal position escrow PDA (user's navToken shares). Seeds: ["personal_position_escrow", personalPosition] */
  async personalPositionEscrow(personalPosition: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [
        textEncoder.encode('personal_position_escrow'),
        encoder.encode(address(personalPosition)),
      ],
    });
    return pda;
  }

  /** Log account PDA. Seeds: ["log"] */
  async logAccount(): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [textEncoder.encode('log')],
    });
    return pda;
  }

  /** Tenant PDA. Seeds: ["tenant", seedAddress] */
  async tenant(seedAddress: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [textEncoder.encode('tenant'), encoder.encode(address(seedAddress))],
    });
    return pda;
  }

  /** Market PDA. Seeds: ["market", seedAddress] */
  async market(seedAddress: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [textEncoder.encode('market'), encoder.encode(address(seedAddress))],
    });
    return pda;
  }

  /** Market metadata PDA. Seeds: ["market_meta", seedAddress] */
  async marketMeta(seedAddress: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [textEncoder.encode('market_meta'), encoder.encode(address(seedAddress))],
    });
    return pda;
  }

  /** Liquidity vault main authority PDA. Seeds: ["liq_vault_main", marketMeta] */
  async liqVaultMain(marketMeta: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [textEncoder.encode('liq_vault_main'), encoder.encode(address(marketMeta))],
    });
    return pda;
  }
}
