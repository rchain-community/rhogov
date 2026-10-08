// council.ts — multi-stakeholder governance on the rgov-core contracts.
//
// Design source: rchain-rust docs/src/qucalc/multi-stakeholder-governance.md.
// It asks for stakeholder groups whose voting power is "the median of
// individual estimates", a facilitated, phased decision process with pros and
// cons (à la ConsiderIt), and "tally estimates and stakeholder-weighted results".
//
// Everything here is a CONVENTION over the three contracts that are already
// installed, so a council needs no new contract and stays readable by any
// rgov-core client:
//
//   council          Group   id  council-<slug>          (everyone taking part)
//   chamber          Group   id  <councilId>.<slug>      (one stakeholder group:
//                                                         its own admins, trust,
//                                                         delegation and censure)
//   power estimates  Issue   id  <councilId>.weights     mode "estimate"; a ballot is
//                                                         ["<chamberId>=<percent>", …]
//   decision         Issue   gid <councilId>              mode "approval"
//   deliberation     Issue   id  <decisionId>.args       mode "args"; options are
//                                                         pro/con arguments, ballots
//                                                         are endorsements
//   phase & record   Issue.results[facilitator] on the decision — a map
//                    {"phase", "rationale", "actions", "winner", "scores"}
//
// What is computed where:
//   - each chamber's weights and winner: the node's natives, over that
//     chamber's members' ballots only (Gov.chamberOutcome);
//   - chamber power: the median of the published estimates (here, from public
//     ballots — anyone can recompute it);
//   - the combined score: Σ chamber power × chamber's weighted approval share.

import type { Group, Issue, Outcome } from "./gov";

export const COUNCIL_PREFIX = "council-";
export const isCouncilId = (id: string) => id.startsWith(COUNCIL_PREFIX) && !id.includes(".");
export const chamberId = (cid: string, slug: string) => `${cid}.${slug}`;
export const weightsIssueId = (cid: string) => `${cid}.weights`;
export const argsIssueId = (iid: string) => `${iid}.args`;
export const isChamberOf = (cid: string, gid: string) => gid.startsWith(cid + ".") && !gid.slice(cid.length + 1).includes(".");
export const isAuxIssue = (iid: string) => iid.endsWith(".weights") || iid.endsWith(".args");

/** The stakeholder kinds the design doc lists, as starting suggestions. */
export const STAKEHOLDERS: { slug: string; name: string; blurb: string; policy: "open" | "invite" }[] = [
  { slug: "users", name: "Users", blurb: "People and organisations who transact and use dApps.", policy: "open" },
  { slug: "developers", name: "Developers", blurb: "Build and maintain the protocol, contracts, tools and dApps.", policy: "open" },
  { slug: "validators", name: "Validators", blurb: "Stake to secure the network and reach consensus.", policy: "invite" },
  { slug: "holders", name: "Token holders", blurb: "Hold the native token.", policy: "open" },
  { slug: "providers", name: "Service providers", blurb: "Wallets, exchanges and services built on the chain.", policy: "open" },
  { slug: "stewards", name: "Governance stewards", blurb: "Foundation, DAO or elected committee members.", policy: "invite" },
];

export const PHASES = [
  { id: "prepare", name: "Prepare", what: "Frame the question, the goal and the options; bring the right stakeholders in." },
  { id: "deliberate", name: "Deliberate", what: "Share information; everyone adds pros and cons and endorses the points they find convincing." },
  { id: "vote", name: "Decide", what: "Each stakeholder group votes; results are combined by each group's voting power." },
  { id: "decided", name: "Record & follow up", what: "The decision of record: outcome, rationale, dissent and action items." },
] as const;
export type PhaseId = (typeof PHASES)[number]["id"];

export interface Council { group: Group; chambers: Group[] }

export function councilsOf(groups: Group[]): Council[] {
  return groups.filter((g) => isCouncilId(g.id)).map((g) => ({
    group: g,
    chambers: groups.filter((c) => isChamberOf(g.id, c.id)).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

// --- chamber power -----------------------------------------------------------

/** "<chamberId>=<n>" ballot entries → {chamberId: n}. Malformed entries are ignored. */
export function parseEstimate(ballot: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of ballot) {
    const i = e.lastIndexOf("=");
    const n = Number(e.slice(i + 1));
    if (i > 0 && Number.isFinite(n) && n >= 0) out[e.slice(0, i)] = n;
  }
  return out;
}
export const estimateBallot = (est: Record<string, number>) => Object.entries(est).map(([k, v]) => `${k}=${Math.round(v)}`);

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface Power {
  /** Normalised share per chamber, summing to 1 (equal shares when nobody has estimated). */
  share: Record<string, number>;
  /** Raw median estimate per chamber. */
  median: Record<string, number>;
  estimators: number;
}

/**
 * Each chamber's power is the MEDIAN of everyone's estimate for it (robust to a
 * few extreme estimates — a whale cannot drag it), then normalised so the
 * shares sum to 1. Each estimator's own numbers are first normalised to 100 so
 * an estimate's scale does not matter, only its proportions.
 */
export function chamberPower(chambers: string[], weightsIssue: Issue | null): Power {
  const ballots = Object.values(weightsIssue?.ballots ?? {}).map(parseEstimate)
    .map((e) => {
      const tot = chambers.reduce((s, c) => s + (e[c] ?? 0), 0);
      return tot > 0 ? Object.fromEntries(chambers.map((c) => [c, (100 * (e[c] ?? 0)) / tot])) : null;
    })
    .filter((e): e is Record<string, number> => !!e);
  const med = Object.fromEntries(chambers.map((c) => [c, median(ballots.map((b) => b[c] ?? 0))]));
  const tot = Object.values(med).reduce((s, x) => s + x, 0);
  const share = Object.fromEntries(chambers.map((c) => [c, tot > 0 ? med[c] / tot : 1 / Math.max(1, chambers.length)]));
  return { share, median: med, estimators: ballots.length };
}

// --- the combined tally --------------------------------------------------------

export interface ChamberResult {
  chamber: Group;
  outcome: Outcome | null;
  /** Weighted approval share per option within the chamber (0..1). */
  share: Record<string, number>;
  ballots: number;
  members: number;
}

/** Only the ballots of a chamber's own members. */
export function chamberBallots(chamber: Group, ballots: Record<string, string[]>): Record<string, string[]> {
  const ms = new Set(chamber.members.map((m) => m.addr));
  return Object.fromEntries(Object.entries(ballots).filter(([v]) => ms.has(v)));
}

export function approvalShare(options: string[], out: Outcome | null): Record<string, number> {
  const share = Object.fromEntries(options.map((o) => [o, 0]));
  if (!out) return share;
  const total = Object.values(out.weights).reduce((a, b) => a + b, 0);
  if (!total) return share;
  for (const [voter, choices] of Object.entries(out.ballots)) {
    const w = out.weights[voter] ?? 0;
    for (const c of new Set(choices)) if (c in share) share[c] += w / total;
  }
  return share;
}

/**
 * Σ_chamber power(chamber) × share(chamber, option). A chamber with no ballots
 * contributes nothing, and its power is NOT redistributed — an absent
 * stakeholder group is visible as missing support, not silently re-weighted.
 */
export function combine(options: string[], results: ChamberResult[], power: Power) {
  const score = Object.fromEntries(options.map((o) => [o, 0]));
  for (const r of results) for (const o of options) score[o] += (power.share[r.chamber.id] ?? 0) * (r.share[o] ?? 0);
  const ranked = [...options].sort((a, b) => score[b] - score[a] || a.localeCompare(b));
  const top = ranked[0];
  const winner = top !== undefined && score[top] > 0 && (ranked.length < 2 || score[ranked[1]] < score[top]) ? top : null;
  const tie = top !== undefined && score[top] > 0 && !winner ? ranked.filter((o) => score[o] === score[top]) : [];
  return { score, ranked, winner, tie };
}

// --- arguments (deliberation) -------------------------------------------------------

export interface Argument { raw: string; side: "pro" | "con"; option: string; text: string }
export const encodeArg = (side: "pro" | "con", option: string, text: string) => `${side}|${option}|${text}`;
export function decodeArg(raw: string): Argument | null {
  const [side, option, ...rest] = raw.split("|");
  if ((side !== "pro" && side !== "con") || !rest.length) return null;
  return { raw, side, option, text: rest.join("|") };
}
