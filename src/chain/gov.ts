// gov.ts — RGov as a typed API over the three on-chain contracts.
//
// The contracts are quantum-os's rgov-core (Inbox, Group, Issue — vendored in
// ./rgov-core.js). They hold FACTS only: who is a member, who delegated to whom,
// who rated whom, who censured whom, who voted for what. The POLICY — trust
// levels, censure, liquid-democracy weights, the tally — is computed by the
// node's own `rho:gov:*` natives. So every number this UI shows about standing
// or outcome comes from one read-only query the node evaluates
// (`standingProgram`), not from arithmetic in the browser.
//
// Identity is derived on chain from the signing key (rho:rev:address
// "fromDeployerId"), so a write can only ever touch the caller's own row.

import * as core from "./rgov-core.js";
import { RNode, type RhoValue } from "./node";

export const q = (s: string) => JSON.stringify(String(s));

/**
 * rgov-core's write and install programs answer on `return` as well as on
 * `rho:rchain:deployId`, expecting a deploy wrapper to bind `return` (quantum-os's
 * /rholang does). We read the deployId answer from deploy-status, so `return`
 * only has to be bound — a free name is refused by the normalizer.
 */
const forDeploy = (term: string) => `new return in {\n${term}\n}`;
export const qList = (xs: string[]) => `[${xs.map(q).join(", ")}]`;
export const qSet = (xs: string[]) => `{${xs.map((x) => `${q(x)}: true`).join(", ")}}`;

export interface Community {
  /** What people call it. Local label; not on chain. */
  name: string;
  node: string;
  inbox: string;
  group: string;
  issue: string;
}

export interface Member { addr: string; role: "admin" | "member"; label: string }

export interface Group {
  id: string;
  name: string;
  policy: "open" | "invite";
  admins: string[];
  members: Member[];
  invited: string[];
  /** Standing delegations: delegator → delegate. */
  deleg: Record<string, string>;
  /** Per-issue delegations: issueId → (delegator → delegate). */
  topic: Record<string, Record<string, string>>;
  /** rater → (ratee → 0..5), as recorded (raw). */
  ratings: Record<string, Record<string, number>>;
  /** censurer → targets. */
  censures: Record<string, string[]>;
}

export interface Issue {
  id: string;
  gid: string;
  title: string;
  by: string;
  status: "open" | "locked" | "closed";
  mode: "approval" | "ranked";
  options: string[];
  voters: string[];
  guests: string[];
  ballots: Record<string, string[]>;
  results: Record<string, RhoValue>;
}

export interface Standing {
  /** Trust level per member after censure (0..5); empty when nobody has rated anyone. */
  levels: Record<string, number>;
  discredited: string[];
  /** Whether trust weighting is in effect (any rating exists). */
  trustActive: boolean;
}

export interface Outcome extends Standing {
  weights: Record<string, number>;
  winner: string | null;
  ballots: Record<string, string[]>;
  mode: string;
}

export class GovError extends Error {}

/** Contracts answer `("gov-error", reason, …)` instead of failing silently. Surface it. */
function check(v: RhoValue[]): RhoValue[] {
  const first = v[0];
  if (Array.isArray(first) && first[0] === "gov-error") {
    throw new GovError(humanError(first.slice(1).map(String)));
  }
  return v;
}

function humanError(parts: string[]): string {
  const [reason] = parts;
  const known: Record<string, string> = {
    "no identity": "The node could not derive your identity from this deploy.",
    "not an admin": "Only a group admin can do that.",
    "not invited": "This group is invite-only and you haven't been invited yet.",
    "no such group": "That group doesn't exist (yet) on this community's contract.",
    "no such issue": "That issue doesn't exist.",
    "not the opener": "Only the person who opened this issue can do that.",
    "not on the roll": "You're not on this issue's voter roll. Ask the opener to refresh the roll.",
    "not open": "Voting on this issue is closed.",
    closed: "This issue is closed.",
    "invite-only locker": "That inbox only accepts messages from people its owner has invited.",
    "no such locker": "That inbox doesn't exist.",
    "no facet": "The community's contract couldn't be reached at that address. Check the community settings.",
    "bad verb or arity": "The contract didn't recognise that request — this app and the contract may be different versions.",
  };
  return known[reason] ?? `The contract refused: ${parts.join(" · ")}`;
}

const asMap = (v: RhoValue): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const asList = (v: RhoValue): any[] => (Array.isArray(v) ? v : []);
const keys = (v: RhoValue) => Object.keys(asMap(v));

export function toGroup(id: string, raw: RhoValue): Group | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const g = raw as Record<string, any>;
  const members: Member[] = Object.entries(asMap(g.members)).map(([addr, m]) => ({
    addr, role: (asMap(m).role === "admin" ? "admin" : "member"), label: String(asMap(m).label ?? ""),
  }));
  const censures: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(asMap(g.censures))) censures[k] = keys(v as RhoValue);
  return {
    id,
    name: String(g.name ?? id),
    policy: g.policy === "invite" ? "invite" : "open",
    admins: keys(g.admins),
    members,
    invited: keys(g.invited),
    deleg: asMap(g.deleg) as Record<string, string>,
    topic: asMap(g.topic) as Record<string, Record<string, string>>,
    ratings: asMap(g.ratings) as Record<string, Record<string, number>>,
    censures,
  };
}

export function toIssue(id: string, raw: RhoValue): Issue | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const i = raw as Record<string, any>;
  const ballots: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(asMap(i.ballots))) ballots[k] = asList(v as RhoValue).map(String);
  return {
    id,
    gid: String(i.gid ?? ""),
    title: String(i.title ?? id),
    by: String(i.by ?? ""),
    status: i.status === "closed" ? "closed" : i.status === "locked" ? "locked" : "open",
    mode: i.mode === "ranked" ? "ranked" : "approval",
    options: asList(i.options).map(String),
    voters: keys(i.voters),
    guests: keys(i.guests),
    ballots,
    results: asMap(i.results),
  };
}

/** A stable, readable id: slug plus a short random suffix so two "Budget"s don't collide. */
export function makeId(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "item";
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 5);
  return `${slug}-${rand}`;
}

/** The facet-lookup prologue rgov-core uses: accepts both registry reply shapes. */
const lookupRead = (uri: string, caps: string, rec: string) =>
  `lookup!(\`${uri}\`, *${rec}) | for (@r <- ${rec}) { match r { (_, c) => { ${caps}!(c) } c => { ${caps}!(c) } } }`;

/**
 * One read-only query that has the node compute a group's standing — and, given
 * an issue, its weighted outcome — with its own natives:
 *
 *   Group.ratingsOf + adminsOf ─▶ rho:gov:trustLevels ─▶ levels
 *   Group.censuresOf + levels + vouchersOf ─▶ rho:gov:censure ─▶ (discredited, levels')
 *   ballots + Group.delegationsOf(gid, iid) + levels' ─▶ rho:gov:resolveWeights ─▶ weights
 *   ballots + weights + mode ─▶ rho:gov:tally ─▶ winner
 *
 * With no ratings at all, trust is passed as {} so every member weighs 1 —
 * one person, one vote — matching quantum-os's trustWeightsFor.
 */
export function standingProgram(groupUri: string, gid: string, issueUri?: string, iid?: string, ballotsLiteral?: string): string {
  const withIssue = !!(issueUri && iid);
  return `new return, lookup(\`rho:registry:lookup\`),
    trustLevels(\`rho:gov:trustLevels\`), censure(\`rho:gov:censure\`),
    resolveWeights(\`rho:gov:resolveWeights\`), tally(\`rho:gov:tally\`),
    gRec, gCaps, iRec, iCaps, r1, r2, r3, r4, r5, r6, lv, cs, trustCh, w, t in {
  ${lookupRead(groupUri, "gCaps", "gRec")} |
  ${withIssue ? lookupRead(issueUri!, "iCaps", "iRec") : `iCaps!({"read": Nil})`} |
  for (@gc <- gCaps; @ic <- iCaps) {
    match [gc, ic] {
      [{"read": gRead, ..._}, {"read": iRead, ..._}] => {
        @gRead!("ratingsOf", [${q(gid)}], *r1) |
        @gRead!("adminsOf", [${q(gid)}], *r2) |
        @gRead!("censuresOf", [${q(gid)}], *r3) |
        ${withIssue
          ? `@gRead!("delegationsOf", [${q(gid)}, ${q(iid!)}], *r4) | ${ballotsLiteral ? `r5!(${ballotsLiteral}) | r6!("approval") |` : `@iRead!("ballotsOf", [${q(iid!)}], *r5) | @iRead!("modeOf", [${q(iid!)}], *r6) |`}`
          : `r4!({}) | r5!({}) | r6!("approval") |`}
        for (@ratings <- r1; @admins <- r2; @censures <- r3; @deleg <- r4; @ballots <- r5; @mode <- r6) {
          trustLevels!(ratings, admins, *lv) |
          for (@levels <- lv) {
            censure!(censures, levels, ratings, *cs) |
            for (@(discredited, levels2) <- cs) {
              match ratings.length() == 0 {
                true  => { trustCh!({}) }
                false => { trustCh!(levels2) }
              } |
              for (@trust <- trustCh) {
                ${withIssue ? `resolveWeights!(ballots.keys().toList(), deleg, trust, *w) |
                for (@weights <- w) {
                  match ballots.keys().toList().length() == 0 {
                    true  => { t!(Nil) }
                    false => { tally!(ballots, weights, mode, *t) }
                  } |
                  for (@winner <- t) {
                    return!({"levels": levels2, "discredited": discredited, "trustActive": ratings.length() > 0,
                             "weights": weights, "winner": winner, "ballots": ballots, "mode": mode})
                  }
                }` : `return!({"levels": levels2, "discredited": discredited, "trustActive": ratings.length() > 0})`}
              }
            }
          }
        }
      }
      _ => { return!(("gov-error", "no facet", "read", ${q(groupUri)})) }
    }
  }
}`;
}

/** A rholang literal for a ballots map {voter: [choice, …]}. */
export const ballotsLiteral = (b: Record<string, string[]>) =>
  `{${Object.entries(b).map(([k, v]) => `${q(k)}: ${qList(v)}`).join(", ")}}`;

/**
 * Several `self` calls on ONE contract in ONE deploy, run in order, answering
 * the list of their answers. Same lookup and facet binding as rgov-core's
 * writeProgram (both registry reply shapes; the facet bound out of the map by a
 * pattern), so it costs one signature and one block instead of N.
 */
export function batchProgram(uri: string, calls: [string, string[]][]): string {
  const step = (k: number): string => {
    if (k === calls.length) return `return!(acc${k}) | deployId!(acc${k})`;
    const [verb, args] = calls[k];
    return `new r${k} in {
          @found!(*deployerId, ${q(verb)}, [${args.join(", ")}], *r${k}) |
          for (@a${k} <- r${k}) { let @acc${k + 1} <- acc${k} ++ [a${k}] in { ${step(k + 1)} } }
        }`;
  };
  const err = `("gov-error", "no facet", "self", ${q(uri)})`;
  return forDeploy(`new lookup(\`rho:registry:lookup\`), deployerId(\`rho:rchain:deployerId\`),
    deployId(\`rho:rchain:deployId\`), stored, capsCh in {
  lookup!(\`${uri}\`, *stored) |
  for (@record <- stored) {
    match record { (_, c) => { capsCh!(c) } c => { capsCh!(c) } } |
    for (@caps <- capsCh) {
      match caps {
        {"self": found, ..._} => { let @acc0 <- [] in { ${step(0)} } }
        _ => { return!(${err}) | deployId!(${err}) }
      }
    }
  }
}`);
}

export class Gov {
  readonly node: RNode;
  constructor(public c: Community, private key: () => string | null) {
    this.node = new RNode(c.node);
  }

  // --- plumbing --------------------------------------------------------------

  private async read(uri: string, verb: string, args: string[] = []): Promise<RhoValue> {
    const v = check(await this.node.explore(core.readProgram(uri, verb, args)));
    return v[0] ?? null;
  }

  private async write(uri: string, verb: string, args: string[], onTick?: (s: string) => void): Promise<RhoValue[]> {
    const key = this.key();
    if (!key) throw new GovError("Set up your identity first (Account).");
    const term = forDeploy(core.writeProgram(uri, "self", verb, args));
    return check(await this.node.deploy(term, key, { onTick }));
  }

  /** The exact rholang a write would sign — shown to the user before signing. */
  preview(kind: "inbox" | "group" | "issue", verb: string, args: string[]): string {
    return forDeploy(core.writeProgram(this.c[kind], "self", verb, args));
  }

  // --- groups ----------------------------------------------------------------

  async groupIds(): Promise<string[]> { return asList(await this.read(this.c.group, "groups")).map(String); }

  async group(gid: string): Promise<Group | null> { return toGroup(gid, await this.read(this.c.group, "groupOf", [q(gid)])); }

  async groups(): Promise<Group[]> {
    const ids = await this.groupIds();
    const all = await Promise.all(ids.map((id) => this.group(id).catch(() => null)));
    return all.filter((g): g is Group => !!g);
  }

  createGroup(gid: string, name: string, policy: "open" | "invite", t?: (s: string) => void) {
    return this.write(this.c.group, "create", [q(gid), q(name), q(policy)], t);
  }
  join(gid: string, label: string, t?: (s: string) => void) { return this.write(this.c.group, "join", [q(gid), q(label)], t); }
  leave(gid: string, t?: (s: string) => void) { return this.write(this.c.group, "leave", [q(gid)], t); }
  invite(gid: string, addr: string, t?: (s: string) => void) { return this.write(this.c.group, "invite", [q(gid), q(addr)], t); }
  setRole(gid: string, addr: string, role: "admin" | "member", t?: (s: string) => void) {
    return this.write(this.c.group, "setRole", [q(gid), q(addr), q(role)], t);
  }
  delegate(gid: string, to: string, issueId: string | null, t?: (s: string) => void) {
    return this.write(this.c.group, "delegate", [q(gid), q(to), issueId ? q(issueId) : "Nil"], t);
  }
  undelegate(gid: string, issueId: string | null, t?: (s: string) => void) {
    return this.write(this.c.group, "undelegate", [q(gid), issueId ? q(issueId) : "Nil"], t);
  }
  rate(gid: string, ratee: string, level: number, t?: (s: string) => void) {
    return this.write(this.c.group, "rate", [q(gid), q(ratee), String(Math.max(0, Math.min(5, Math.round(level))))], t);
  }
  censure(gid: string, target: string, on: boolean, t?: (s: string) => void) {
    return this.write(this.c.group, on ? "censure" : "uncensure", [q(gid), q(target)], t);
  }

  async standing(gid: string): Promise<Standing> {
    const v = check(await this.node.explore(standingProgram(this.c.group, gid)));
    const m = asMap(v[0] ?? null);
    return { levels: asMap(m.levels), discredited: asList(m.discredited).map(String), trustActive: m.trustActive === true };
  }

  // --- issues ----------------------------------------------------------------

  async issueIds(gid: string): Promise<string[]> { return asList(await this.read(this.c.issue, "issuesOf", [q(gid)])).map(String); }
  async issue(iid: string): Promise<Issue | null> { return toIssue(iid, await this.read(this.c.issue, "issueOf", [q(iid)])); }
  async issues(gid: string): Promise<Issue[]> {
    const ids = await this.issueIds(gid);
    const all = await Promise.all(ids.map((id) => this.issue(id).catch(() => null)));
    return all.filter((i): i is Issue => !!i);
  }

  openIssue(iid: string, gid: string, title: string, mode: "approval" | "ranked" | "estimate" | "args", options: string[], voters: string[], t?: (s: string) => void) {
    return this.write(this.c.issue, "open", [q(iid), q(gid), q(title), q(mode), qList(options), qSet(voters)], t);
  }
  addOption(iid: string, opt: string, t?: (s: string) => void) { return this.write(this.c.issue, "addOption", [q(iid), q(opt)], t); }
  setRoll(iid: string, voters: string[], t?: (s: string) => void) { return this.write(this.c.issue, "setRoll", [q(iid), qSet(voters)], t); }
  cast(iid: string, choices: string[], t?: (s: string) => void) { return this.write(this.c.issue, "cast", [q(iid), qList(choices)], t); }
  lock(iid: string, t?: (s: string) => void) { return this.write(this.c.issue, "lock", [q(iid)], t); }
  close(iid: string, t?: (s: string) => void) { return this.write(this.c.issue, "close", [q(iid)], t); }
  propose(iid: string, winner: string | null, t?: (s: string) => void) {
    return this.write(this.c.issue, "propose", [q(iid), winner === null ? "Nil" : q(winner)], t);
  }

  async outcome(gid: string, iid: string): Promise<Outcome> {
    const v = check(await this.node.explore(standingProgram(this.c.group, gid, this.c.issue, iid)));
    const m = asMap(v[0] ?? null);
    const ballots: Record<string, string[]> = {};
    for (const [k, b] of Object.entries(asMap(m.ballots))) ballots[k] = asList(b as RhoValue).map(String);
    return {
      levels: asMap(m.levels), discredited: asList(m.discredited).map(String), trustActive: m.trustActive === true,
      weights: asMap(m.weights), winner: typeof m.winner === "string" ? m.winner : null, ballots, mode: String(m.mode ?? "approval"),
    };
  }

  /**
   * A chamber's weighted standing on an issue, counting ONLY the ballots given
   * (its own members'): the chamber's trust, censure and delegation, run
   * through the same natives. Delegating outside the chamber abstains here.
   */
  async chamberOutcome(chamberGid: string, iid: string, ballots: Record<string, string[]>): Promise<Outcome> {
    const v = check(await this.node.explore(standingProgram(this.c.group, chamberGid, this.c.issue, iid, ballotsLiteral(ballots))));
    const m = asMap(v[0] ?? null);
    return {
      levels: asMap(m.levels), discredited: asList(m.discredited).map(String), trustActive: m.trustActive === true,
      weights: asMap(m.weights), winner: typeof m.winner === "string" ? m.winner : null, ballots, mode: "approval",
    };
  }

  /** Run several self calls on one contract in a single deploy. Fails if any answers gov-error. */
  async batch(kind: "group" | "issue" | "inbox", calls: [string, string[]][], t?: (s: string) => void): Promise<RhoValue[]> {
    const key = this.key();
    if (!key) throw new GovError("Set up your identity first (Account).");
    const v = await this.node.deploy(batchProgram(this.c[kind], calls), key, { onTick: t, phloLimit: 20_000_000 });
    const answers = asList(v[0] ?? null);
    const bad = answers.find((a) => Array.isArray(a) && a[0] === "gov-error");
    if (bad) throw new GovError(humanError((bad as RhoValue[]).slice(1).map(String)));
    check(v);
    return answers;
  }

  /** Record an arbitrary rholang value as this caller's result on an issue. */
  proposeTerm(iid: string, term: string, t?: (s: string) => void) {
    return this.write(this.c.issue, "propose", [q(iid), term], t);
  }

  // --- inbox -----------------------------------------------------------------

  /** Message counts by type in someone's default locker. Public: counts, never bodies. */
  async inboxCounts(addr: string): Promise<Record<string, number>> {
    const types = asList(await this.read(this.c.inbox, "typesIn", [q(addr), q("inbox")])).map(String);
    const out: Record<string, number> = {};
    await Promise.all(types.map(async (ty) => {
      const n = await this.read(this.c.inbox, "countIn", [q(addr), q("inbox"), q(ty)]);
      if (typeof n === "number" && n > 0) out[ty] = n;
    }));
    return out;
  }

  /**
   * Send a message. The contract stamps `from` with the sender's derived
   * address, so it cannot be forged. `fields` become a rholang map.
   */
  send(to: string, type: string, fields: Record<string, string | number>, t?: (s: string) => void) {
    const body = Object.entries({ ...fields, type, at: Date.now() })
      .map(([k, v]) => `${q(k)}: ${typeof v === "number" ? String(Math.trunc(v)) : q(v)}`).join(", ");
    return this.write(this.c.inbox, "send", [q(to), q("inbox"), `{${body}}`], t);
  }

  /** Consume everything in your default locker. Returns messages; the locker is left empty on chain. */
  async receive(t?: (s: string) => void): Promise<InboxMessage[]> {
    let v: RhoValue[];
    try {
      v = await this.write(this.c.inbox, "receive", [q("inbox")], t);
    } catch (e) {
      if (e instanceof GovError && /inbox doesn't exist/.test(e.message)) return [];
      throw e;
    }
    const r = asList(v[0] ?? null);
    const byType = asMap(r[1] ?? null);
    const out: InboxMessage[] = [];
    for (const list of Object.values(byType)) {
      for (const m of asList(list as RhoValue)) {
        const mm = asMap(m);
        out.push({
          from: String(mm.from ?? ""), type: String(mm.type ?? ""), at: Number(mm.at ?? 0),
          fields: Object.fromEntries(Object.entries(mm).filter(([k]) => !["from", "type", "at"].includes(k)).map(([k, x]) => [k, typeof x === "object" ? JSON.stringify(x) : String(x)])),
        });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  // --- installation ----------------------------------------------------------

  /** Deploy fresh Inbox, Group and Issue contracts; returns their registry URIs. */
  static async install(nodeUrl: string, key: string, onTick?: (s: string) => void): Promise<{ inbox: string; group: string; issue: string }> {
    const node = new RNode(nodeUrl);
    const progs = { inbox: core.installInboxProgram(), group: core.installGroupProgram(), issue: core.installIssueProgram() };
    const out: Record<string, string> = {};
    for (const [k, term] of Object.entries(progs)) {
      onTick?.(`installing ${k}…`);
      const v = await node.deploy(forDeploy(term), key, { phloLimit: 50_000_000, onTick: (s) => onTick?.(`installing ${k}: ${s}`) });
      const uri = JSON.stringify(v).match(/rho:id:[a-z0-9]+/)?.[0];
      if (!uri) throw new GovError(`Installing ${k} produced no address: ${JSON.stringify(v).slice(0, 200)}`);
      out[k] = uri;
    }
    return out as { inbox: string; group: string; issue: string };
  }
}

export interface InboxMessage { from: string; type: string; at: number; fields: Record<string, string> }
