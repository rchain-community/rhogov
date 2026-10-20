// pending-writes.ts — signed writes that may still land, kept across a reload (see act() in kit.tsx).
import { signal } from "@preact/signals";
import { blake2b } from "@noble/hashes/blake2.js";
import { hex } from "../chain/keys";

/**
 * A write's identity: its stable action key, hashed. The key names the target
 * action — never the visible title — so two clicks on the same action give one
 * id, and two different targets give two. Keying this on the title would collide
 * across targets and be defeated by a label that varies (§ the in-flight lock,
 * docs/audit/remediation.md).
 */
export const writeId = (key: string) => hex(blake2b(new TextEncoder().encode(key), { dkLen: 16 }));

/**
 * Writes that were signed and may still land, kept across a reload.
 *
 * Only a write whose outcome is still unknown stays here: one that landed, ran and
 * failed, or was definitely not carried is forgotten as soon as that is known. While
 * one is here, the same action is not started again — that is how it would happen
 * twice — and Account lists it so its signature can be looked up. The record holds
 * the title, the network, the signer and the signature: never the key or the term.
 *
 * Unlike the durable lock that was retracted (kit.tsx), this does not hold every
 * write in flight, and the community install keeps its own resume (setup.tsx),
 * which `act(…, { receipt: false })` leaves to it.
 */
export interface PendingWrite { id: string; title: string; node: string; addr: string; sig: string; at: number; key?: string; damaged?: true }
const PENDING = "rhogov:pending-write:";
/**
 * Where a pending write is kept: one record per network, signer and action, so the
 * same action pending on two networks, or under two keys, never overwrites the other.
 */
const slotOf = (node: string, addr: string, id: string) => PENDING + writeId(`${node}\n${addr}\n${id}`);
const parsePending = (k: string, raw: string | null): PendingWrite | null => {
  if (raw === null) return null;
  try {
    const p = JSON.parse(raw);
    if (p && typeof p.sig === "string" && p.sig && typeof p.id === "string" && typeof p.node === "string" && typeof p.addr === "string")
      return { ...p, key: k };
  } catch { /* falls through to damaged */ }
  // A record that can't be read is not "nothing pending": it is kept, listed, and blocks its action.
  return { id: "", title: "A signed action rhogov can't read back", node: "", addr: "", sig: "", at: 0, key: k, damaged: true };
};
const readPending = (): PendingWrite[] => {
  const out: PendingWrite[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PENDING)) continue;
      const p = parsePending(k, localStorage.getItem(k));
      if (p) out.push(p);
    }
  } catch { /* storage refused: act() refuses writes that would need it (pendingFor) */ }
  return out.sort((a, b) => a.at - b.at);
};
export const pendingWrites = signal<PendingWrite[]>(readPending());

/** This browser can't save or read its note of a signature, so nothing was sent. */
export class ReceiptRefused extends Error {}
export const REFUSED = "This browser couldn't keep a note of the signature, so nothing was sent: without it, a write that may still land could be repeated after a reload. Allow this site to store data (it is refused in some private windows), then try again.";

/**
 * The record for this action on this network and key, read fresh from storage.
 * "unreadable" when storage itself refuses, which must not pass for "nothing pending".
 * Records kept before they were scoped (one per action) are moved into their slot.
 */
export function pendingFor(id: string, node: string, addr: string): PendingWrite | "unreadable" | null {
  try {
    const k = slotOf(node, addr, id);
    const p = parsePending(k, localStorage.getItem(k));
    if (p) return p;
    const old = parsePending(PENDING + id, localStorage.getItem(PENDING + id));
    if (old && !old.damaged && old.node === node && old.addr === addr) {
      localStorage.setItem(k, JSON.stringify({ ...old, key: undefined }));
      localStorage.removeItem(PENDING + id);
      pendingWrites.value = readPending();
      return { ...old, key: k };
    }
    return old?.damaged ? old : null;
  } catch { return "unreadable"; }
}
/** Saved and read back before the deploy is sent; throws (so nothing is sent) if it can't be. */
export const keepPending = (p: PendingWrite) => {
  const k = slotOf(p.node, p.addr, p.id);
  try {
    const text = JSON.stringify({ ...p, key: undefined });
    localStorage.setItem(k, text);
    if (localStorage.getItem(k) !== text) throw new Error("not kept");
  } catch { throw new ReceiptRefused(REFUSED); }
  pendingWrites.value = readPending();
};
export const forgetPending = (p: PendingWrite) => {
  try { localStorage.removeItem(p.key ?? slotOf(p.node, p.addr, p.id)); } catch { /* storage refused */ }
  pendingWrites.value = readPending();
};
