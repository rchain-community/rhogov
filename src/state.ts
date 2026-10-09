// state.ts — what this browser remembers, and the app-wide store.
//
// Everything durable about governance lives on chain. What lives here is only
// what a browser must hold to act: the signing key, which network and which
// community you use, and the inbox messages you have already received (receive
// consumes them on chain, so this browser is where they live afterwards).

import { signal, computed } from "@preact/signals";
import { Gov, type Community, type InboxMessage } from "./chain/gov";
import { isValidKey, revAddressOf } from "./chain/keys";
import { RNode } from "./chain/node";
import { resolveNames } from "./chain/profile";

const LS = {
  key: "rhogov:key",
  name: "rhogov:name",
  communities: "rhogov:communities",
  active: "rhogov:active",
  reviewBeforeSign: "rhogov:review",
  inbox: (addr: string, c: string) => `rhogov:inbox:${c}:${addr}`,
  dismissed: "rhogov:dismissed",
};

const load = <T,>(k: string, d: T): T => {
  try { const v = localStorage.getItem(k); return v === null ? d : (JSON.parse(v) as T); } catch { return d; }
};
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage refused */ } };

/** r-wallet: the RChain web wallet, whose faucet funds testnet addresses. */
export const R_WALLET = "https://rhowallet.org";

export const NETWORKS = [
  { id: "playground", label: "Rholang playground", url: "https://playground.rhobot.net", note: "A public rchain-rust dev chain — the default. Free test REV from its faucet." },
  { id: "testnet", label: "RChain testnet", url: "https://testnet.rhobot.net", note: "The public multi-validator rchain-rust testnet. Free test REV from its faucet — the same one r-wallet uses." },
  { id: "local", label: "Local dev node", url: "http://127.0.0.1:40403", note: "A node on this computer (quantum-os scripts/localnet/run-node.sh, or rnode run -s)." },
];

// --- identity ----------------------------------------------------------------

export const secretKey = signal<string | null>(load<string | null>(LS.key, null));
export const displayName = signal<string>(load(LS.name, ""));
export const myAddr = computed(() => (secretKey.value && isValidKey(secretKey.value) ? revAddressOf(secretKey.value) : null));

export function setKey(k: string | null) {
  secretKey.value = k;
  if (k) save(LS.key, k); else localStorage.removeItem(LS.key);
}
export function setDisplayName(n: string) { displayName.value = n; save(LS.name, n); }

// --- communities -------------------------------------------------------------

export const communities = signal<Community[]>(load<Community[]>(LS.communities, []));
export const activeId = signal<string | null>(load<string | null>(LS.active, null));

export const communityKey = (c: Community) => c.group;
export const active = computed<Community | null>(() =>
  communities.value.find((c) => communityKey(c) === activeId.value) ?? communities.value[0] ?? null);
export const gov = computed<Gov | null>(() => (active.value ? new Gov(active.value, () => secretKey.value) : null));

export function addCommunity(c: Community) {
  const rest = communities.value.filter((x) => communityKey(x) !== communityKey(c));
  communities.value = [...rest, c];
  save(LS.communities, communities.value);
  setActive(communityKey(c));
}
export function removeCommunity(c: Community) {
  communities.value = communities.value.filter((x) => communityKey(x) !== communityKey(c));
  save(LS.communities, communities.value);
  if (activeId.value === communityKey(c)) setActive(communities.value[0] ? communityKey(communities.value[0]) : null);
}
export function setActive(id: string | null) { activeId.value = id; save(LS.active, id); }

/** An invite link carries the community (node + three contract addresses), nothing secret. */
export function inviteLink(c: Community, extra = ""): string {
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(c)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${location.origin}${location.pathname}#/join?c=${b64}${extra}`;
}
export function parseInvite(s: string): Community | null {
  const m = /[?&]c=([A-Za-z0-9_-]+)/.exec(s);
  if (!m) return null;
  try {
    const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, "+").replace(/_/g, "/"))));
    const c = JSON.parse(json) as Community;
    const ok = [c.inbox, c.group, c.issue].every((u) => /^rho:id:[a-z0-9]+$/.test(u)) && /^https?:\/\//.test(c.node);
    return ok ? c : null;
  } catch { return null; }
}

// --- preferences -------------------------------------------------------------

export const reviewBeforeSign = signal<boolean>(load(LS.reviewBeforeSign, false));
export function setReview(v: boolean) { reviewBeforeSign.value = v; save(LS.reviewBeforeSign, v); }

// --- address book ------------------------------------------------------------
// Names come from the labels members gave themselves when joining a group.

// Two sources: names people published for themselves in the chain's name
// directory (authoritative — only the address's own key can set it), and the
// labels members gave when joining a group (fallback).

export const addressBook = signal<Record<string, string>>({});
const published = new Map<string, string | null>(); // addr → published name, null = looked up, none
let pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Names people put on their community's name list (Gov.names): over group labels, under the directory. */
const listed = new Map<string, string>();
let listedFor = "";
/** The active community's whole list (replacing another community's), or `merge` one entry into it. */
export function learnListed(names: Record<string, string>, merge = false) {
  const c = active.value?.group ?? "";
  if (!merge || c !== listedFor) { listed.clear(); listedFor = c; }
  for (const [a, n] of Object.entries(names)) listed.set(a, n);
  rebuild({});
}
export const listedName = (addr: string) => listed.get(addr);

/** Names as people gave them, before duplicates are told apart (addressBook is what to show). */
let raw: Record<string, string> = {};
export const rawNames = () => raw;

function rebuild(labels: Record<string, string>) {
  const next = { ...raw, ...labels };
  for (const [a, n] of listed) next[a] = n;
  for (const [a, n] of published) if (n) next[a] = n;
  raw = { ...next };
  // Two people with one name (a race, or from before names were unique) are told
  // apart by the end of their address rather than silently confused.
  const byName = new Map<string, string[]>();
  for (const [a, n] of Object.entries(next)) { const k = n.trim().toLowerCase(); byName.set(k, [...(byName.get(k) ?? []), a]); }
  for (const addrs of byName.values()) if (addrs.length > 1) for (const a of addrs) next[a] = `${next[a]} (…${a.slice(-4)})`;
  if (JSON.stringify(next) !== JSON.stringify(addressBook.value)) addressBook.value = next;
}

export function learnNames(pairs: { addr: string; label: string }[]) {
  const labels: Record<string, string> = {};
  for (const { addr, label } of pairs) {
    if (label && !published.get(addr)) labels[addr] = label;
    if (!published.has(addr)) pending.add(addr);
  }
  rebuild(labels);
  if (pending.size && !flushTimer) flushTimer = setTimeout(flushNames, 50);
}

async function flushNames() {
  flushTimer = null;
  const c = active.value;
  const addrs = [...pending];
  pending = new Set();
  if (!c || !addrs.length) return;
  for (const a of addrs) published.set(a, null);
  try {
    const found = await resolveNames(new RNode(c.node), addrs);
    for (const [a, n] of Object.entries(found)) published.set(a, n);
    rebuild({});
  } catch { /* a chain without the name directory: labels only */ }
}

/** Has this address published a name? undefined = not looked up yet. */
export const publishedName = (addr: string) => published.get(addr);
export function notePublished(addr: string, name: string) { published.set(addr, name); rebuild({}); }

// --- inbox archive -----------------------------------------------------------

export function archived(addr: string, c: Community): InboxMessage[] { return load(LS.inbox(addr, communityKey(c)), []); }
export function archive(addr: string, c: Community, msgs: InboxMessage[]) {
  save(LS.inbox(addr, communityKey(c)), [...archived(addr, c), ...msgs]);
}
export function setArchive(addr: string, c: Community, msgs: InboxMessage[]) { save(LS.inbox(addr, communityKey(c)), msgs); }

export const dismissed = signal<string[]>(load(LS.dismissed, []));
export function dismiss(id: string) { dismissed.value = [...dismissed.value, id]; save(LS.dismissed, dismissed.value); }

/** Bumped after every write so screens re-read chain state. */
export const refreshTick = signal(0);
/** Bumped after the user's own writes: forces a re-read even if a poll is running. */
export const forceTick = signal(0);
export const refresh = (force = false) => { if (force) forceTick.value++; refreshTick.value++; };

// Other people act too: re-read quietly while the page is visible, and on return.
// Screens keep showing what they have while a re-read is in flight.
if (typeof window !== "undefined") {
  setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 15_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
}
