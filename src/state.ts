// state.ts — what this browser remembers, and the app-wide store.
//
// Everything durable about governance lives on chain. What lives here is only
// what a browser must hold to act: the signing key, which network and which
// community you use, the inbox messages you have already received (receive
// consumes them on chain, so this browser is where they live afterwards), and a
// last-known membership cache for first paint and an unreachable node.

import { signal, computed, effect } from "@preact/signals";
import {
  Gov, membershipStatus, type Community, type Group, type InboxMessage, type MembershipStatus,
} from "./chain/gov";
import { exportInboxArchive, parseInboxArchive } from "./inbox-archive";
import { isValidKey, revAddressOf } from "./chain/keys";
import { RNode } from "./chain/node";
import { nameSkeleton } from "./chain/people";
import { resolveNames } from "./chain/profile";

const LS = {
  key: "rhogov:key",
  name: "rhogov:name",
  communities: "rhogov:communities",
  active: "rhogov:active",
  reviewBeforeSign: "rhogov:review",
  inbox: (addr: string, c: string) => `rhogov:inbox:${c}:${addr}`,
  membership: (addr: string, c: string) => `rhogov:membership:${c}:${addr}`,
  dismissed: "rhogov:dismissed",
  setupNode: "rhogov:setupNode",
  genesis: "rhogov:genesis",
  chainNames: "rhogov:chain-names",
  chainKeys: "rhogov:chain-keys",
};

const load = <T,>(k: string, d: T): T => {
  try { const v = localStorage.getItem(k); return v === null ? d : (JSON.parse(v) as T); } catch { return d; }
};
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage refused */ } };

/** r-wallet: the RChain web wallet, whose faucet funds testnet addresses. */
export const R_WALLET = "https://rhowallet.org";

export const NETWORKS = [
  { id: "playground", label: "Rholang playground", url: "https://playground.rhobot.net", note: "A public rholo dev chain — the default. Free test REV from its faucet." },
  { id: "testnet", label: "RChain testnet", url: "https://testnet.rhobot.net", note: "The public multi-validator rholo testnet. Free test REV from its faucet — the same one r-wallet uses." },
  { id: "local", label: "Local dev node", url: "http://127.0.0.1:40403", note: "A node on this computer (quantum-os scripts/localnet/run-node.sh, or rnode run -s)." },
];

// --- chains ------------------------------------------------------------------
// One browser can use several chains: the playground, the testnet, a local node.
// And a chain can be replaced at the same URL, by a new genesis. So what this
// browser keeps is kept per chain, a chain being a node URL plus the hash of
// its genesis block (#89). A reset never overwrites the earlier chain's state:
// its communities stay listed (as from an earlier chain), and its name and key
// stay under its own id.

export const nodeBase = (u: string) => u.trim().replace(/\/+$/, "");

/** The network the welcome steps are set to, before (or besides) any community. */
export const setupNode = signal<string>((() => { try { return localStorage.getItem(LS.setupNode) ?? NETWORKS[0].url; } catch { return NETWORKS[0].url; } })());
export const setSetupNode = (u: string) => { setupNode.value = u; try { localStorage.setItem(LS.setupNode, u); } catch { /* storage refused */ } };

/** The genesis each node served when this browser last accepted it: node → hash. */
export const knownGenesis = signal<Record<string, string>>(load(LS.genesis, {}));
/** The genesis each node serves now, as read during this visit. */
export const liveGenesis = signal<Record<string, string>>({});

/** The chain a node serves: its URL and genesis hash (empty until first read). */
export function chainIdOf(node: string): string {
  const n = nodeBase(node);
  return `${n}#${liveGenesis.value[n] ?? knownGenesis.value[n] ?? ""}`;
}

/** The node in use: the active community's, or the one setup is pointed at. */
export const currentNode = computed(() => active.value?.node ?? setupNode.value);
export const currentChain = computed(() => chainIdOf(currentNode.value));

/**
 * The current node now serves a different chain than the one this browser
 * knew there: it was restarted from a new genesis. Null when it hasn't.
 */
export const chainReset = computed<{ node: string; was: string; now: string } | null>(() => {
  const n = nodeBase(currentNode.value), was = knownGenesis.value[n], now = liveGenesis.value[n];
  return was && now && was !== now ? { node: n, was, now } : null;
});

/** A community from a chain its node no longer serves (or whose contracts were never found there). */
export function fromEarlierChain(c: Community): boolean {
  const g = knownGenesis.value[nodeBase(c.node)];
  return c.chain === UNKNOWN_CHAIN || (!!c.chain && !!g && c.chain !== g);
}
/** Stamped, at a reset, on a community remembered without a chain whose contracts the new chain lacks. */
export const UNKNOWN_CHAIN = "earlier";

const setKnown = (n: string, h: string) => { knownGenesis.value = { ...knownGenesis.value, [n]: h }; save(LS.genesis, knownGenesis.value); };

/**
 * Read which chain a node serves now. The first time a node is seen, its chain
 * is simply accepted. A different genesis from the one accepted before is a
 * reset: chainReset says so, and nothing is changed until acceptChain.
 */
export async function checkChain(node: string): Promise<void> {
  const n = nodeBase(node);
  const h = await new RNode(n).genesis().catch(() => null);
  try { if (h) await learnChain(n, h); }
  finally { if (!checked.value.includes(n)) checked.value = [...checked.value, n]; }
}

async function learnChain(n: string, h: string) {
  if (liveGenesis.value[n] !== h) liveGenesis.value = { ...liveGenesis.value, [n]: h };
  // First sight of this node's chain: accept it. A community remembered there
  // from before (#89) that doesn't answer may be from a chain that was replaced,
  // or may never have been there; which, nothing says. It isn't called a reset:
  // its "couldn't read the chain" card offers to forget it.
  if (!knownGenesis.value[n]) setKnown(n, h);
  if (knownGenesis.value[n] === h) await stampCommunities(n, h, false);
}

/** Nodes whose chain has been read (or tried) during this visit. */
const checked = signal<string[]>([]);
/**
 * The current node's chain has been read, so a reset would be known. Background
 * writes (your name going on a community's list) wait for it: before, the
 * active community may be one whose contracts are gone.
 */
export const chainChecked = computed(() => checked.value.includes(nodeBase(currentNode.value)));

/** Accept the chain a reset node now serves; its earlier communities become history. */
export async function acceptChain(node: string): Promise<void> {
  const n = nodeBase(node), h = liveGenesis.value[n];
  if (!h) return;
  // Settle which communities belong to which chain before the reset is
  // accepted, so none from the old chain is ever taken for a live one.
  await stampCommunities(n, h, true);
  setKnown(n, h);
  if (active.value && fromEarlierChain(active.value)) setActive(null);
}

/**
 * Communities remembered without a chain (from before #89, or from an invite
 * that didn't carry one) get the chain whose node has their contracts. After a
 * reset (`reset`), those it doesn't have are marked as from the earlier chain.
 */
async function stampCommunities(n: string, h: string, reset: boolean) {
  const loose = communities.value.filter((c) => nodeBase(c.node) === n && !c.chain);
  if (!loose.length) return;
  const found = await Promise.all(loose.map((c) => new Gov(c, () => null).answers().then((y) => y, () => null)));
  const stamp = new Map(loose.map((c, i) => [communityKey(c), found[i] ? h : found[i] === false && reset ? UNKNOWN_CHAIN : undefined]));
  communities.value = communities.value.map((c) => (stamp.get(communityKey(c)) ? { ...c, chain: stamp.get(communityKey(c)) } : c));
  save(LS.communities, communities.value);
}

// --- identity ----------------------------------------------------------------
// One main key and name, used on every chain. A chain can have its own key
// (and so its own name) instead; a reset chain starts with the main ones, so
// your identity carries over unless you choose otherwise.

const mainKey = signal<string | null>(load<string | null>(LS.key, null));
const mainName = signal<string>(load(LS.name, ""));
export const chainKeys = signal<Record<string, string>>(load(LS.chainKeys, {}));
export const chainNames = signal<Record<string, string>>(load(LS.chainNames, {}));

const known = (chain: string) => !chain.endsWith("#");
export const secretKey = computed<string | null>(() => chainKeys.value[currentChain.value] ?? mainKey.value);
export const displayName = computed<string>(() => chainNames.value[currentChain.value] ?? (chainKeys.value[currentChain.value] ? "" : mainName.value));
/** This chain uses a key of its own rather than the main one. */
export const ownKeyHere = computed(() => !!chainKeys.value[currentChain.value]);
export const myAddr = computed(() => (secretKey.value && isValidKey(secretKey.value) ? revAddressOf(secretKey.value) : null));

/**
 * A name belongs to a key. Switching keys (or removing one) drops the old key's
 * name rather than carrying it over to a key it was never given to; the new
 * key's own name is looked up (keyName) and adopted.
 *
 * `here` gives the current chain a key of its own; a chain that already has one
 * changes that one. Otherwise it is the main key, used on every other chain.
 * Removing a chain's own key goes back to the main key there.
 */
export function setKey(k: string | null, name?: string, opts: { here?: boolean } = {}) {
  const chain = currentChain.value;
  const changed = k !== secretKey.value;
  if ((opts.here || ownKeyHere.value) && known(chain)) {
    const { [chain]: _, ...rest } = chainKeys.value;
    chainKeys.value = k ? { ...rest, [chain]: k } : rest;
    save(LS.chainKeys, chainKeys.value);
    if (!k) { setName(chain, null); return; }
  } else {
    mainKey.value = k;
    if (k) save(LS.key, k); else try { localStorage.removeItem(LS.key); } catch { /* storage refused */ }
    // Names given to the old main key on chains that use it are not the new key's.
    if (changed) {
      chainNames.value = Object.fromEntries(Object.entries(chainNames.value).filter(([c]) => !!chainKeys.value[c]));
      save(LS.chainNames, chainNames.value);
    }
  }
  if (changed) setDisplayName(name?.trim() ?? "");
}

function setName(chain: string, n: string | null) {
  const { [chain]: _, ...rest } = chainNames.value;
  chainNames.value = n === null ? rest : { ...rest, [chain]: n };
  save(LS.chainNames, chainNames.value);
}

/**
 * The name a key already has: in the chain's name directory, else on the name
 * list of any community joined in this browser. Null when it has none yet.
 */
export async function keyName(node: string, addr: string): Promise<string | null> {
  const dir = await resolveNames(new RNode(node), [addr]).catch(() => null);
  if (dir?.[addr]) return dir[addr];
  for (const c of [active.value, ...communities.value].filter((x): x is Community => !!x)) {
    const n = (await new Gov(c, () => null).names().catch(() => ({} as Record<string, string>)))[addr];
    if (n) return n;
  }
  return null;
}
/** Your name on the current chain; with the main key, also the name it brings to other chains. */
export function setDisplayName(n: string) {
  const chain = currentChain.value;
  if (ownKeyHere.value && known(chain)) { setName(chain, n); return; }
  mainName.value = n; save(LS.name, n);
  if (known(chain)) setName(chain, n);
}

// --- communities -------------------------------------------------------------

export const communities = signal<Community[]>(load<Community[]>(LS.communities, []));
export const activeId = signal<string | null>(load<string | null>(LS.active, null));

export const communityKey = (c: Community) => c.group;
/** The communities you can use: not ones from a chain their node no longer serves. */
export const usable = computed(() => communities.value.filter((c) => !fromEarlierChain(c)));
/** Communities kept from earlier chains: listed, never opened. */
export const earlier = computed(() => communities.value.filter(fromEarlierChain));
export const active = computed<Community | null>(() =>
  usable.value.find((c) => communityKey(c) === activeId.value) ?? usable.value[0] ?? null);
export const gov = computed<Gov | null>(() => (active.value ? new Gov(active.value, () => secretKey.value) : null));

export function addCommunity(c: Community) {
  const g = liveGenesis.value[nodeBase(c.node)];
  if (!c.chain && g) c = { ...c, chain: g };
  const rest = communities.value.filter((x) => communityKey(x) !== communityKey(c));
  communities.value = [...rest, c];
  save(LS.communities, communities.value);
  setActive(communityKey(c));
}
export function removeCommunity(c: Community) {
  communities.value = communities.value.filter((x) => communityKey(x) !== communityKey(c));
  save(LS.communities, communities.value);
  if (activeId.value === communityKey(c)) setActive(usable.value[0] ? communityKey(usable.value[0]) : null);
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

// Everything here belongs to ONE community (and the directory to one network):
// a label someone typed joining a group in community A says nothing about who
// they are in B. Switching communities drops their labels and claims;
// directory names survive while the network stays the same (#38, #64).
let scope = "", scopeNode = "";
let directoryEpoch = 0;

function inScope() {
  // A network restarted from a new genesis is another network: its directory goes too.
  const c = active.value, node = c ? chainIdOf(c.node) : "", here = c ? `${node}|${c.group}` : "";
  if (here === scope) return;

  // This assignment must stay before rebuild() below: rebuild() re-enters
  // inScope(), and the updated scope makes that nested call return immediately.
  scope = here;

  raw = {};
  listed.clear();

  if (node !== scopeNode) {
    scopeNode = node;
    directoryEpoch++;
    published.clear();
    pending = new Set();
  }

  // Rebuild now: community labels and claims are gone, but directory names
  // still belong to this network. Recalculate markers from those claims alone.
  rebuild({});
}

/** Names people put on their community's name list (Gov.names): over group labels, under the directory. */
const listed = new Map<string, string>();

/** The active community's whole list (replacing what was known), or `merge` one entry into it. */
export function learnListed(names: Record<string, string>, merge = false) {
  inScope();
  if (!merge) listed.clear();
  for (const [a, n] of Object.entries(names)) listed.set(a, n);
  rebuild({});
}
export const listedName = (addr: string) => listed.get(addr);

/** Names as people gave them, before duplicates are told apart (addressBook is what to show). */
let raw: Record<string, string> = {};
export const rawNames = () => raw;

/** Why a name is shown with a marker ("(unclaimed)", "(2)"), for its tooltip. */
export const nameNotes = signal<Record<string, string>>({});

// Switching community removes its names at once, retaining this network's directory.
effect(() => { void active.value; inScope(); });

function rebuild(labels: Record<string, string>) {
  inScope();
  const next = { ...raw, ...labels };
  for (const [a, n] of listed) next[a] = n;
  for (const [a, n] of published) if (n) next[a] = n;
  raw = { ...next };

  // Names are always shown, never an address. Names that LOOK alike (the same
  // letters, or look-alike letters from another alphabet: "Ada" / "Adα") are
  // one name here. A name someone CLAIMED (the community's name list, or the
  // directory) shows as itself; the same name merely typed as a group label by
  // someone else is marked "(unclaimed)".
  const isClaim = (a: string) => listed.has(a) || !!published.get(a);
  const notes: Record<string, string> = {};
  const byLook = new Map<string, string[]>();

  for (const [a, n] of Object.entries(next)) {
    const k = nameSkeleton(n);
    byLook.set(k, [...(byLook.get(k) ?? []), a]);
  }

  for (const addrs of byLook.values()) {
    if (addrs.length < 2) continue;

    const claims = addrs.filter(isClaim).sort();

    for (const a of addrs) if (!isClaim(a) && claims.length) {
      next[a] = `${next[a]} (unclaimed)`;
      notes[a] = "Someone else in this community has claimed this name; this person only typed it when joining a group.";
    }

    // Two claims, or two labels with no claim: who was first isn't recorded on
    // chain, so neither is shown as the owner. Both are numbered, in a fixed
    // order (by address) so everyone sees the same numbers.
    const same = claims.length > 1 ? claims : claims.length ? [] : [...addrs].sort();

    same.forEach((a, i) => {
      next[a] = `${next[a]} (${i + 1})`;
      notes[a] = `${same.length} people here go by this name (or one that looks the same). The numbers tell them apart; they don't say who had it first, which isn't recorded.`;
    });
  }

  if (JSON.stringify(next) !== JSON.stringify(addressBook.value)) addressBook.value = next;
  if (JSON.stringify(notes) !== JSON.stringify(nameNotes.value)) nameNotes.value = notes;
}

export function learnNames(pairs: { addr: string; label: string }[]) {
  inScope();
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
  const epoch = directoryEpoch;
  const addrs = [...pending];
  pending = new Set();

  if (!c || !addrs.length) return;

  for (const a of addrs) published.set(a, null);

  try {
    const found = await resolveNames(new RNode(c.node), addrs);

    // A lookup may finish after we leave its network, even if we return to the
    // same URL before it answers. It must not refill a newer directory cache.
    // We deliberately do not requeue old-scope addresses here: a screen that
    // still needs them calls learnNames in its current scope, which queues only
    // addresses relevant after the switch.
    if (epoch !== directoryEpoch) return;

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

/** Transfers must not mistake unreadable/corrupt storage for an empty archive. */
export function archiveForTransfer(addr: string, c: Community): InboxMessage[] {
  let text: string | null;
  try { text = localStorage.getItem(LS.inbox(addr, communityKey(c))); }
  catch { throw new Error("This browser could not read its archive. Check its storage settings; existing messages were left untouched."); }
  if (text === null) return [];
  let msgs: unknown;
  try { msgs = JSON.parse(text); }
  catch { throw new Error("This browser's stored archive is damaged. Existing messages were left untouched; keep this browser data and report the problem."); }
  if (!Array.isArray(msgs)) throw new Error("This browser's stored archive is damaged. Existing messages were left untouched; keep this browser data and report the problem.");
  try { return parseInboxArchive(exportInboxArchive(addr, c, msgs), addr, c).messages; }
  catch { throw new Error("This browser's stored archive contains older, invalid, or oversized message data that cannot be transferred safely. Existing messages were left untouched; keep this browser data and update rhogov or report the problem."); }
}

/** An import must report a refused storage write rather than claim success. */
export function importArchive(addr: string, c: Community, msgs: InboxMessage[]) {
  localStorage.setItem(LS.inbox(addr, communityKey(c)), JSON.stringify(msgs));
}

// --- membership --------------------------------------------------------------
// The authoritative status is always on chain (Group.members / admins / invited
// / asked). This is a last-known copy per (community, key), so a reload or an
// unreachable node can still say what the chain said last time. It NEVER decides
// a write: Join, Leave, Invite and setRole all read the live Group they were given.

export interface MembershipEntry {
  gid: string;
  name: string;
  policy: "open" | "invite";
  status: Exclude<MembershipStatus, "none">;
  /** When this entry was last read from chain (or loaded from the cache). */
  at: number;
}

interface MembershipCache { v: 1; at: number; entries: MembershipEntry[] }

export const memberships = signal<Record<string, MembershipEntry>>({});
/** When the current scope's membership was last read from chain. */
export const membershipAt = signal(0);

/** The per-(community, key) cache key. Exported so tests and seeds agree on the shape. */
export const membershipKey = (addr: string, group: string) => LS.membership(addr, group);

const MEMBER_STATUSES = new Set(["admin", "member", "invited", "asked"]);

/** Parse a stored snapshot, dropping anything that does not look like one. */
export function readMembershipCache(raw: unknown): MembershipCache | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, any>;
  if (o.v !== 1 || !Number.isFinite(o.at) || !Array.isArray(o.entries)) return null;
  const entries: MembershipEntry[] = [];
  for (const e of o.entries) {
    if (!e || typeof e !== "object") continue;
    if (typeof e.gid !== "string" || !e.gid) continue;
    if (typeof e.name !== "string" || !e.name) continue;
    if (e.policy !== "open" && e.policy !== "invite") continue;
    if (!MEMBER_STATUSES.has(e.status)) continue;
    entries.push({
      gid: e.gid,
      name: e.name,
      policy: e.policy,
      status: e.status as MembershipEntry["status"],
      at: Number.isFinite(e.at) ? e.at : Number(o.at),
    });
  }
  return { v: 1, at: Number(o.at), entries };
}

let memberScope = "";
let memberSavedAt = 0;

function hydrateMemberships() {
  const c = active.value, me = myAddr.value;
  const next = c && me ? `${communityKey(c)}|${me}` : "";
  if (next === memberScope) return;
  memberScope = next;
  const cached = c && me ? readMembershipCache(load<unknown>(membershipKey(me, communityKey(c)), null)) : null;
  memberships.value = cached ? Object.fromEntries(cached.entries.map((e) => [e.gid, e])) : {};
  membershipAt.value = cached?.at ?? 0;
  memberSavedAt = cached?.at ?? 0;
}

// Switching community or key switches the whole snapshot at once.
effect(() => { void active.value; void myAddr.value; hydrateMemberships(); });

function saveMemberships() {
  const c = active.value, me = myAddr.value;
  if (!c || !me) return;
  const at = Date.now();
  save(membershipKey(me, communityKey(c)), { v: 1, at, entries: Object.values(memberships.value) });
  memberSavedAt = at;
}

/**
 * Learn the status of `gs` for the signed-in key. `scope` is captured when the
 * read starts, so an answer that arrives after a community or key switch is
 * ignored rather than written into the new scope. `all` is the full id list of
 * a complete read: entries absent from it are pruned, but ids the node could not
 * read (`unreadable`) are kept as last-known.
 */
export function learnGroups(
  gs: Group[],
  scope?: { community: Community; addr: string },
  all?: { ids: string[]; unreadable?: string[] },
) {
  hydrateMemberships();
  const c = active.value, me = myAddr.value;
  if (!c || !me) return;
  const read = scope ?? { community: c, addr: me };
  if (read.community.group !== c.group || read.addr !== me) return;
  const now = Date.now();
  const next = { ...memberships.value };
  let changed = false;
  for (const g of gs) {
    const status = membershipStatus(g, me);
    if (status === "none") {
      if (next[g.id]) { delete next[g.id]; changed = true; }
    } else {
      const prev = next[g.id];
      if (!prev || prev.status !== status || prev.name !== g.name || prev.policy !== g.policy) changed = true;
      next[g.id] = { gid: g.id, name: g.name, policy: g.policy, status, at: now };
    }
  }
  if (all) {
    const keep = new Set([...all.ids, ...(all.unreadable ?? [])]);
    for (const gid of Object.keys(next)) if (!keep.has(gid)) { delete next[gid]; changed = true; }
  }
  memberships.value = next;
  membershipAt.value = now;
  // Refresh the chain-read marker even when nothing changed, but only rewrite
  // localStorage when the facts changed or the stored copy is getting old.
  if (changed || now - memberSavedAt > 60_000) saveMemberships();
}

/** The last-known status of one group for the current key, if any. */
export const membershipOf = (gid: string) => memberships.value[gid];

/** Groups this key is a member or admin of, from the last-known snapshot. */
export const myGroups = computed(() =>
  Object.values(memberships.value).filter((m) => m.status === "admin" || m.status === "member"));
/** Invitations still pending for this key, from the last-known snapshot. */
export const myInvitations = computed(() =>
  Object.values(memberships.value).filter((m) => m.status === "invited"));
/** Join requests this key is still waiting on, from the last-known snapshot. */
export const myAsks = computed(() =>
  Object.values(memberships.value).filter((m) => m.status === "asked"));

/** Drop one group's last-known entry (e.g. the group no longer exists). */
export function forgetMembership(gid: string) {
  if (!memberships.value[gid]) return;
  const next = { ...memberships.value };
  delete next[gid];
  memberships.value = next;
  saveMemberships();
}

export const dismissed = signal<string[]>(load(LS.dismissed, []));
export function dismiss(id: string) { dismissed.value = [...dismissed.value, id]; save(LS.dismissed, dismissed.value); }

/** Bumped after every write so screens re-read chain state. */
export const refreshTick = signal(0);

/** Bumped after the user's own writes: forces a re-read even if a poll is running. */
export const forceTick = signal(0);

export const refresh = (force = false) => {
  if (force) forceTick.value++;
  refreshTick.value++;
};

// Other people act too: re-read quietly while the page is visible, and on return.
// Screens keep showing what they have while a re-read is in flight.
if (typeof window !== "undefined") {
  setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 15_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
}
