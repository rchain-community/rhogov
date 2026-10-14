// keystore.ts — the key as a standard, password-protected keystore file.
//
// Web3 Secret Storage v3 (the Ethereum JSON keystore that geth, MetaMask and
// ethers write): scrypt or pbkdf2 derives a 32-byte key from the password,
// aes-128-ctr encrypts the secret with its first half, and the MAC is
// keccak256(second half ++ ciphertext). RChain keys are secp256k1 and a REV
// address is derived from the same key's Ethereum address, so the file opens
// in those wallets and `address` names the same identity.
//
// Everything runs in the browser; the key and the password never leave it.

import { ctr } from "@noble/ciphers/aes.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { hex, isValidKey, unhex } from "./keys";

export interface Keystore {
  version: 3;
  id: string;
  address: string;
  crypto: {
    cipher: "aes-128-ctr";
    cipherparams: { iv: string };
    ciphertext: string;
    kdf: "scrypt" | "pbkdf2";
    kdfparams: Record<string, number | string>;
    mac: string;
  };
}

/** The Ethereum address (40 hex, no 0x) of a key: the last 20 bytes of keccak256(public key). */
export function ethAddressOf(secretHex: string): string {
  return hex(keccak_256(secp256k1.getPublicKey(unhex(secretHex), false).slice(1))).slice(-40);
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const utf8 = (s: string) => new TextEncoder().encode(s.normalize("NFKD"));

function uuid4(): string {
  const b = random(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const mac = (dk: Uint8Array, ciphertext: Uint8Array) => hex(keccak_256(new Uint8Array([...dk.slice(16, 32), ...ciphertext])));

/** Wrong file, wrong password: the message says which, so the person knows what to try. */
export class KeystoreError extends Error {}

// ethers' default (MetaMask's export too): a second or two in a browser, 128 MB.
const SCRYPT = { n: 131072, r: 8, p: 1 };

async function derive(password: string, kdf: string, p: Record<string, unknown>): Promise<Uint8Array> {
  const salt = unhex(String(p.salt ?? ""));
  if (Number(p.dklen) < 32) throw new KeystoreError("This keystore's derived key is too short to check its password.");
  if (kdf === "scrypt") {
    const N = Number(p.n), r = Number(p.r), q = Number(p.p);
    if (!(N > 1 && r > 0 && q > 0)) throw new KeystoreError("This keystore's scrypt settings are incomplete.");
    return scryptAsync(utf8(password), salt, { N, r, p: q, dkLen: Number(p.dklen), maxmem: 2 ** 31 });
  }
  if (kdf === "pbkdf2") {
    if (p.prf !== "hmac-sha256") throw new KeystoreError(`This keystore uses ${String(p.prf)}; rhogov reads pbkdf2 with hmac-sha256.`);
    return pbkdf2Async(sha256, utf8(password), salt, { c: Number(p.c), dkLen: Number(p.dklen) });
  }
  throw new KeystoreError(`This keystore uses the ${kdf} key derivation; rhogov reads scrypt and pbkdf2.`);
}

/** Encrypt a key under a password as a v3 keystore. `scrypt` is for tests only. */
export async function encryptKeystore(secretHex: string, password: string, scrypt = SCRYPT): Promise<Keystore> {
  if (!isValidKey(secretHex)) throw new KeystoreError("That isn't a valid secp256k1 key.");
  const salt = random(32), iv = random(16);
  const kdfparams = { dklen: 32, n: scrypt.n, r: scrypt.r, p: scrypt.p, salt: hex(salt) };
  const dk = await derive(password, "scrypt", kdfparams);
  const ciphertext = ctr(dk.slice(0, 16), iv).encrypt(unhex(secretHex));
  return {
    version: 3,
    id: uuid4(),
    address: ethAddressOf(secretHex),
    crypto: { cipher: "aes-128-ctr", cipherparams: { iv: hex(iv) }, ciphertext: hex(ciphertext), kdf: "scrypt", kdfparams, mac: mac(dk, ciphertext) },
  };
}

/** Is this text a keystore file (as opposed to a pasted hex key)? */
export function looksLikeKeystore(text: string): boolean {
  try { const j = JSON.parse(text); return !!(j && (j.crypto ?? j.Crypto)); } catch { return false; }
}

/** Decrypt a v3 keystore (JSON text or parsed) to the key's 64 hex characters. */
export async function decryptKeystore(json: string | object, password: string): Promise<string> {
  let ks: any;
  try { ks = typeof json === "string" ? JSON.parse(json) : json; } catch { throw new KeystoreError("That file isn't JSON, so it isn't a keystore file."); }
  const c = ks?.crypto ?? ks?.Crypto;
  if (!c || Number(ks.version) !== 3) throw new KeystoreError("That isn't a version 3 keystore file (the kind geth, MetaMask and rhogov save).");
  if (c.cipher !== "aes-128-ctr") throw new KeystoreError(`This keystore is encrypted with ${String(c.cipher)}; rhogov reads aes-128-ctr.`);
  const ciphertext = unhex(String(c.ciphertext ?? ""));
  const dk = await derive(password, String(c.kdf), c.kdfparams ?? {});
  if (mac(dk, ciphertext) !== String(c.mac).toLowerCase().replace(/^0x/, "")) throw new KeystoreError("Wrong password for this keystore file.");
  const secret = hex(ctr(dk.slice(0, 16), unhex(String(c.cipherparams?.iv ?? ""))).decrypt(ciphertext));
  if (!isValidKey(secret)) throw new KeystoreError("The keystore opened, but what's inside isn't a secp256k1 key.");
  if (ks.address && String(ks.address).toLowerCase().replace(/^0x/, "") !== ethAddressOf(secret)) {
    throw new KeystoreError("The keystore opened, but its key doesn't match the address written in it. The file may be damaged.");
  }
  return secret;
}

/** geth's file name: UTC--2026-10-14T09-53-52.000Z--<eth address>.json */
export function keystoreFileName(ks: Keystore, at = new Date()): string {
  return `UTC--${at.toISOString().replace(/:/g, "-")}--${ks.address}.json`;
}
