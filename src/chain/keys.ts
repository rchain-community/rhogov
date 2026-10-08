// keys.ts — secp256k1 identity, REV address, and deploy signing.
//
// Ported from quantum-os packages/browser/src/rholang.ts, which is verified
// against rnode: the signature is DER secp256k1 over blake2b256 of the
// DeployDataProto protobuf, and the REV address is derived exactly as
// rchain-rust's rholang/src/util/rev_address.rs derives it — so the address
// shown is the address charged.

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

export const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export const unhex = (s: string): Uint8Array => {
  const t = s.trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]*$/.test(t) || t.length % 2) throw new Error("not base16");
  return new Uint8Array((t.match(/../g) ?? []).map((p) => parseInt(p, 16)));
};

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) { out = BASE58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = BASE58[0] + out; }
  return out;
}

export function generateKey(): string {
  return hex(secp256k1.utils.randomSecretKey());
}

export function isValidKey(secretHex: string): boolean {
  try { secp256k1.getPublicKey(unhex(secretHex)); return unhex(secretHex).length === 32; } catch { return false; }
}

/** The uncompressed (65-byte, `04…`) public key a deploy is attributed to. */
export function publicKeyOf(secretHex: string): string {
  return hex(secp256k1.getPublicKey(unhex(secretHex), false));
}

/**
 * eth     = last 20 bytes of keccak256(public key without its 0x04 prefix)
 * payload = 00000000 ++ keccak256(eth)
 * address = base58(payload ++ first 4 bytes of blake2b256(payload))
 */
export function revAddressOf(secretHex: string): string {
  const pub = secp256k1.getPublicKey(unhex(secretHex), false);
  const eth = hex(keccak_256(pub.slice(1))).slice(-40);
  const payload = new Uint8Array([0, 0, 0, 0, ...keccak_256(unhex(eth))]);
  const checksum = blake2b(payload, { dkLen: 32 }).slice(0, 4);
  return base58(new Uint8Array([...payload, ...checksum]));
}

/** A REV address as a person can check it: base58, starts 1111, 50+ chars. */
export function looksLikeRevAddress(s: string): boolean {
  return /^1111[1-9A-HJ-NP-Za-km-z]{40,60}$/.test(s.trim());
}

// --- DeployDataProto ---------------------------------------------------------
// proto3 omits default-valued fields; fields are written in ascending order.

function varint(n: number): number[] {
  const out: number[] = [];
  let v = BigInt(n);
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
  } while (v > 0n);
  return out;
}
const fieldVarint = (f: number, v: number): number[] => (v === 0 ? [] : [...varint((f << 3) | 0), ...varint(v)]);
function fieldString(f: number, v: string): number[] {
  if (!v) return [];
  const b = new TextEncoder().encode(v);
  return [...varint((f << 3) | 2), ...varint(b.length), ...b];
}

export interface DeployData {
  term: string;
  timestamp: number;
  phloPrice: number;
  phloLimit: number;
  validAfterBlockNumber: number;
  shardId: string;
}

/** term=2, timestamp=3, phloPrice=7, phloLimit=8, validAfterBlockNumber=10, shardId=11. */
export function encodeDeployData(d: DeployData): Uint8Array {
  return new Uint8Array([
    ...fieldString(2, d.term),
    ...fieldVarint(3, d.timestamp),
    ...fieldVarint(7, d.phloPrice),
    ...fieldVarint(8, d.phloLimit),
    ...fieldVarint(10, d.validAfterBlockNumber),
    ...fieldString(11, d.shardId),
  ]);
}

export function signDeployData(d: DeployData, secretHex: string): { deployer: string; signature: string } {
  const digest = blake2b(encodeDeployData(d), { dkLen: 32 });
  const sig = secp256k1.sign(digest, unhex(secretHex), { prehash: false, format: "der" });
  return { deployer: publicKeyOf(secretHex), signature: hex(sig) };
}
