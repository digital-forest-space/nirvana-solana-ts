import { address, getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';

const encoder = getAddressEncoder();
const textEncoder = new TextEncoder();

/**
 * Nirvana V2 protocol PDA (Program Derived Address) derivations.
 *
 * Seeds were extracted from the Nirvana web app's client-side JS bundles.
 * See docs/nirvana/pda_seeds.md for the full reference and discovery method.
 */
export class NirvanaPda {
  readonly programAddress: Address;

  constructor(programId: string) {
    this.programAddress = address(programId);
  }

  static mainnet(): NirvanaPda {
    return new NirvanaPda('NirvHuZvrm2zSxjkBvSbaF2tHfP5j7cvMj9QmdoHVwb');
  }

  /** Tenant PDA. Seeds: ["tenant", seedAddress] */
  async tenant(seedAddress: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [textEncoder.encode('tenant'), encoder.encode(address(seedAddress))],
    });
    return pda;
  }

  /**
   * Personal account PDA (user's position for staking/borrowing).
   * Seeds: ["personal_position", tenant, owner]
   */
  async personalAccount(tenant: string, owner: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [
        textEncoder.encode('personal_position'),
        encoder.encode(address(tenant)),
        encoder.encode(address(owner)),
      ],
    });
    return pda;
  }

  /** Price curve PDA. Seeds: ["price_curve", tenant] */
  async priceCurve(tenant: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [textEncoder.encode('price_curve'), encoder.encode(address(tenant))],
    });
    return pda;
  }

  /** Curve ballot PDA. Seeds: ["curve_ballot", tenant] */
  async curveBallot(tenant: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [textEncoder.encode('curve_ballot'), encoder.encode(address(tenant))],
    });
    return pda;
  }

  /** Personal curve ballot PDA. Seeds: ["personal_curve_ballot", tenant, owner] */
  async personalCurveBallot(tenant: string, owner: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [
        textEncoder.encode('personal_curve_ballot'),
        encoder.encode(address(tenant)),
        encoder.encode(address(owner)),
      ],
    });
    return pda;
  }

  /** Alms rewarder PDA. Seeds: ["alms_rewarder", tenant, owner] */
  async almsRewarder(tenant: string, owner: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [
        textEncoder.encode('alms_rewarder'),
        encoder.encode(address(tenant)),
        encoder.encode(address(owner)),
      ],
    });
    return pda;
  }

  /** Metta rewarder PDA. Seeds: ["metta_rewarder", tenant, owner] */
  async mettaRewarder(tenant: string, owner: string): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programAddress,
      seeds: [
        textEncoder.encode('metta_rewarder'),
        encoder.encode(address(tenant)),
        encoder.encode(address(owner)),
      ],
    });
    return pda;
  }
}
