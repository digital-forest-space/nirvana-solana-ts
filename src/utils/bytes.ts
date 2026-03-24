/**
 * Byte encoding/decoding utilities for Solana account data parsing
 * and instruction data construction.
 */

/** Write a u64 value as little-endian bytes into a buffer at the given offset. */
export function writeU64LE(buffer: Uint8Array, value: bigint, offset: number): void {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setBigUint64(offset, value, true);
}

/** Read a u64 value as little-endian from a buffer at the given offset. */
export function readU64LE(buffer: Uint8Array, offset: number): bigint {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return view.getBigUint64(offset, true);
}

/** Write a u32 value as little-endian bytes into a buffer at the given offset. */
export function writeU32LE(buffer: Uint8Array, value: number, offset: number): void {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setUint32(offset, value, true);
}

/** Read a u32 value as little-endian from a buffer at the given offset. */
export function readU32LE(buffer: Uint8Array, offset: number): number {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return view.getUint32(offset, true);
}

/** Write a u16 value as little-endian bytes into a buffer at the given offset. */
export function writeU16LE(buffer: Uint8Array, value: number, offset: number): void {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setUint16(offset, value, true);
}

/** Read a f64 (double) as little-endian from a buffer at the given offset. */
export function readF64LE(buffer: Uint8Array, offset: number): number {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return view.getFloat64(offset, true);
}

/** Write a f64 (double) as little-endian into a buffer at the given offset. */
export function writeF64LE(buffer: Uint8Array, value: number, offset: number): void {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setFloat64(offset, value, true);
}

/**
 * Decode a Rust `rust_decimal::Decimal` (16-byte little-endian) into a JS number.
 *
 * Layout (16 bytes LE):
 *  - bytes  0..3  : flags (bits 16..23 = scale, bit 31 = sign)
 *  - bytes  4..7  : lo  (u32)
 *  - bytes  8..11 : mid (u32)
 *  - bytes 12..15 : hi  (u32)
 *
 * value = (hi * 2^64 + mid * 2^32 + lo) / 10^scale, negated if sign bit set.
 */
export function decodeRustDecimal(buffer: Uint8Array, offset: number): number {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const flags = view.getUint32(offset, true);
  const lo = view.getUint32(offset + 4, true);
  const mid = view.getUint32(offset + 8, true);
  const hi = view.getUint32(offset + 12, true);

  const scale = (flags >> 16) & 0xff;
  const negative = (flags & 0x80000000) !== 0;

  // Combine into a single bigint, then divide by 10^scale
  const raw = (BigInt(hi) << 64n) | (BigInt(mid) << 32n) | BigInt(lo);
  const divisor = 10n ** BigInt(scale);
  const intPart = raw / divisor;
  const fracPart = raw % divisor;

  // Convert to number, preserving fractional precision
  let result = Number(intPart) + Number(fracPart) / Number(divisor);
  if (negative) result = -result;
  return result;
}

/**
 * Convert a human-readable token amount to lamports (raw u64).
 * @param amount Human-readable amount (e.g., 1.5)
 * @param decimals Token decimals (e.g., 6 for USDC, 9 for SOL)
 */
export function toLamports(amount: number, decimals: number): bigint {
  return BigInt(Math.round(amount * 10 ** decimals));
}

/**
 * Convert lamports (raw u64) to a human-readable token amount.
 * @param lamports Raw token amount
 * @param decimals Token decimals
 */
export function fromLamports(lamports: bigint, decimals: number): number {
  return Number(lamports) / 10 ** decimals;
}

/** Decode base64 string to Uint8Array. */
export function base64Decode(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Encode Uint8Array to base64 string. */
export function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
