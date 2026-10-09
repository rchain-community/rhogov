// node.ts — rchain-rust's HTTP API, from the browser.
//
// Three operations, and the difference is what the node does with your term:
//
//   status  — what the node is (shard, height, phlo floor).
//   explore — run a read-only term and get its values back. Unsigned, free, no
//             block. rho:rchain:deployerId / deployId are NOT bound here.
//   deploy  — sign a term, submit it, and wait for a block to carry it. The
//             answer is whatever the term sent to rho:rchain:deployId, read
//             back from GET /api/v1/deploy-status/{sig}.
//
// Values arrive as rchain-rust's externally tagged RhoExpr. Since AUDIT C38 the
// payload sits under a `data` envelope ({"ExprInt":{"data":42}}); older builds
// sent it bare ({"ExprInt":42}) and maps as [[k, v], …] pairs. `decode` accepts
// every one of those spellings (spec/API-SCHEMA.md rule 1, "the client accepting
// both forms").

import { type DeployData, revAddressOf, signDeployData } from "./keys";

export type RhoValue =
  | null
  | boolean
  | number
  | string
  | RhoValue[]
  | { [k: string]: RhoValue }
  | Unforgeable;

export interface Unforgeable { unforgeable: string; hex: string }

export const isUnforgeable = (v: unknown): v is Unforgeable =>
  !!v && typeof v === "object" && !Array.isArray(v) && "unforgeable" in (v as object) && "hex" in (v as object);

const isEnvelope = (p: unknown): p is { data: unknown } =>
  !!p && typeof p === "object" && !Array.isArray(p) && Object.keys(p as object).length === 1 && "data" in (p as object);

/** RhoExpr JSON → plain JS. Sets and tuples become arrays (a wire property). */
export function decode(node: unknown): RhoValue {
  if (node === null || node === undefined) return null;
  if (typeof node !== "object") return node as RhoValue;
  const entries = Object.entries(node as object);
  if (entries.length !== 1) return node as RhoValue;
  const [tag, payload] = entries[0];
  const body = isEnvelope(payload) ? payload.data : payload;
  switch (tag) {
    case "ExprPar": case "ExprTuple": case "ExprList": case "ExprSet":
      return (body as unknown[]).map(decode);
    case "ExprMap": {
      const pairs: [string, unknown][] = Array.isArray(body) ? (body as [string, unknown][]) : Object.entries(body as object);
      return Object.fromEntries(pairs.map(([k, v]) => [String(k), decode(v)]));
    }
    case "ExprBool": case "ExprInt": case "ExprString": case "ExprUri":
      return body as RhoValue;
    case "ExprBytes":
      return `0x${String(body)}`;
    case "ExprUnforg": {
      const [t2, p2] = Object.entries(body as object)[0] ?? ["?", ""];
      return { unforgeable: t2, hex: String(isEnvelope(p2) ? p2.data : p2) };
    }
    default:
      return tag.startsWith("Expr") ? decode(body) : (node as RhoValue);
  }
}

export interface NodeStatus {
  version?: { api?: string; node?: string };
  networkId?: string;
  shardId?: string;
  minPhloPrice?: number;
  latestBlockNumber?: number;
  devMode?: boolean;
  proposeOnDeploy?: boolean;
  autopropose?: boolean;
}

export class NodeError extends Error {}

const rev = (dust: number) => `${(dust / 1e8).toLocaleString(undefined, { maximumFractionDigits: 4 })} REV`;

/** Not enough REV to pre-charge a deploy. `faucet` = this node can hand out test REV. */
export class InsufficientFunds extends NodeError {
  constructor(public have: number, public need: number, public faucet: boolean) {
    super(`Not enough REV: this action reserves up to ${rev(need)} for its fee and your balance is ${rev(have)}. ` +
      (faucet ? "Press “Get test REV” (on Account, or in the setup steps) and try again once it arrives — it lands with the next block."
              : "Ask someone to send REV to your address (Account), then try again."));
  }
}

/** The newest block per node URL, shared by every RNode so one writer's block is every reader's. */
const tips = new Map<string, { hash: string; at: number }>();

export class RNode {
  constructor(public url: string) {}

  private get base() { return this.url.replace(/\/+$/, ""); }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      // A request that never answers would leave a screen "reading" forever; a
      // node's own explore deadline is 60 s, so give up a little after that.
      res = await fetch(this.base + path, { ...init, signal: AbortSignal.timeout(75_000) });
    } catch (e) {
      const why = (e as Error).name === "TimeoutError" ? "no answer in 75 s" : (e as Error).message;
      throw new NodeError(`Can't reach the node at ${this.url} (${why})`);
    }
    const text = await res.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = text; }
    if (!res.ok) throw new NodeError(typeof body === "string" ? body.slice(0, 400) : `HTTP ${res.status}`);
    return body;
  }

  private post(path: string, body: unknown) {
    return this.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  status(): Promise<NodeStatus> {
    return this.request("/api/status") as Promise<NodeStatus>;
  }

  /** The newest block's hash, cached briefly so a screenful of reads shares one anchor. */
  private async latestHash(): Promise<string | null> {
    const tip = tips.get(this.base);
    if (tip && Date.now() - tip.at < 1500) return tip.hash;
    const blocks = (await this.request("/api/blocks/1")) as { blockHash?: string }[];
    const hash = blocks?.[0]?.blockHash ?? null;
    if (hash) tips.set(this.base, { hash, at: Date.now() });
    return hash;
  }

  /** Forget the cached tip — after a write, so the next read sees it. */
  invalidate() { tips.delete(this.base); }

  /**
   * Run a read-only term; answers what it sent to its first `new`-bound name
   * (or @"out").
   *
   * Evaluated against the NEWEST block, not the last finalized one: plain
   * /api/explore-deploy reads finalized state, which trails by a block or more,
   * so a vote you just cast would not show up yet. Governance state you can see
   * a moment after you act is worth the small chance of an orphaned block.
   * Falls back to the finalized read if the node lacks the by-hash route.
   */
  async explore(term: string): Promise<RhoValue[]> {
    const pick = (r: unknown): RhoValue[] => {
      if (typeof r === "string") throw new NodeError(r);
      return (((r ?? {}) as { expr?: unknown[] }).expr ?? []).map(decode);
    };
    const blockHash = await this.latestHash().catch(() => null);
    if (blockHash) {
      try {
        return pick(await this.post("/api/explore-deploy-by-block-hash", { term, blockHash, usePreStateHash: false }));
      } catch (e) {
        if (!/not found|404|unknown route/i.test((e as Error).message)) throw e;
      }
    }
    return pick(await this.post("/api/explore-deploy", term));
  }

  /** Sign and submit. Returns the deploy's signature, which is how it is found again. */
  async submit(term: string, key: string, phloLimit = 1_000_000): Promise<string> {
    const st = await this.status().catch(() => ({} as NodeStatus));
    // The node pre-charges phloLimit × phloPrice, and a deploy it cannot charge
    // fails with no useful reason ("deploy error message not available…").
    // Check first and say what is actually wrong.
    const price = Math.max(1, st.minPhloPrice ?? 1);
    const bal = await this.balance(revAddressOf(key));
    if (bal !== null && bal < phloLimit * price) throw new InsufficientFunds(bal, phloLimit * price, !!st.devMode);
    const data: DeployData = {
      term,
      timestamp: Date.now(),
      phloPrice: price,
      phloLimit,
      validAfterBlockNumber: Math.max(0, (st.latestBlockNumber ?? 0) - 1),
      shardId: st.shardId || "root",
    };
    const { deployer, signature } = signDeployData(data, key);
    const reply = await this.post("/api/deploy", { data, deployer, signature, sigAlgorithm: "secp256k1" });
    const text = typeof reply === "string" ? reply : JSON.stringify(reply);
    if (!/success/i.test(text)) throw new NodeError(text);
    return signature;
  }

  /**
   * Wait for a block to carry the deploy, then return what it sent to deployId.
   * `onTick` reports progress so the UI can say "waiting for a block…".
   */
  async outcome(sig: string, { timeoutMs = 240_000, onTick }: { timeoutMs?: number; onTick?: (s: string) => void } = {}): Promise<RhoValue[]> {
    const until = Date.now() + timeoutMs;
    let delay = 800;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.4, 4000);
      let j: Record<string, any>;
      try { j = (await this.request(`/api/v1/deploy-status/${sig}`)) as Record<string, any>; } catch { continue; }
      const ok = j?.ProcessedWithSuccess ?? j?.processedWithSuccess;
      if (ok) { this.invalidate(); return ((ok.deployResult ?? []) as unknown[]).map(decode); }
      const bad = j?.ProcessedWithError ?? j?.processedWithError;
      if (bad) throw new NodeError(`The node ran the deploy and it failed: ${String(bad.deployError ?? JSON.stringify(bad)).slice(0, 400)}`);
      const np = j?.NotProcessed ?? j?.notProcessed;
      onTick?.(np?.status ? String(np.status) : "waiting");
    }
    throw new NodeError("Still waiting for a block after 4 minutes, so this network is busy or stalled. The action may yet land: refresh in a few minutes before trying again, or you may do it twice.");
  }

  async deploy(term: string, key: string, opts: { phloLimit?: number; onTick?: (s: string) => void } = {}): Promise<RhoValue[]> {
    const sig = await this.submit(term, key, opts.phloLimit);
    opts.onTick?.("submitted");
    return this.outcome(sig, { onTick: opts.onTick });
  }

  /** REV balance of an address, in dust (1 REV = 10^8). */
  async balance(addr: string): Promise<number | null> {
    // The native channel's classic getBalance(address): the one shape every
    // build answers (spec/API-SCHEMA.md, rho:rchain:revVault). findOrCreate
    // changed on newer builds to take a deployer id, which a read cannot supply.
    const term = `new return, revVault(\`rho:rchain:revVault\`), ret in {
  revVault!("getBalance", ${JSON.stringify(addr)}, *ret) |
  for (@b <- ret) { return!(b) }
}`;
    let v: RhoValue[];
    try { v = await this.explore(term); } catch { return null; } // couldn't ask: unknown
    // An address that has never received REV has no vault yet, so the read
    // answers nothing — that is a balance of 0, not an unknown one.
    return typeof v[0] === "number" ? v[0] : 0;
  }

  /** Ask a dev node's native faucet for test REV (only on --dev-mode nodes with a deployer key). */
  async faucet(addr: string): Promise<string> {
    const r = await this.post("/api/faucet", { address: addr });
    return typeof r === "string" ? r : JSON.stringify(r);
  }
}
