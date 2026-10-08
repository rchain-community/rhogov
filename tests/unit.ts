// unit.ts — offline checks (no node): decoding, keys, council arithmetic.
import { approvalShare, chamberPower, combine, decodeArg, encodeArg, estimateBallot, parseEstimate } from "../src/chain/council";
import { toGroup } from "../src/chain/gov";
import { revAddressOf } from "../src/chain/keys";
import { decode } from "../src/chain/node";

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, got?: unknown) => {
  if (cond) pass++; else fail++;
  console.log(`${cond ? "  ok  " : "  FAIL"} ${label}${cond ? "" : `  got ${JSON.stringify(got)}`}`);
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// RhoExpr: both the C38 `data` envelope and the older bare form.
ok("decode envelope int", decode({ ExprInt: { data: 42 } }) === 42);
ok("decode bare int", decode({ ExprInt: 42 }) === 42);
ok("decode envelope map", eq(decode({ ExprMap: { data: { a: { ExprString: { data: "x" } } } } }), { a: "x" }));
ok("decode bare map as pairs", eq(decode({ ExprMap: [["a", { ExprInt: 1 }]] }), { a: 1 }));
ok("decode tuple → array", eq(decode({ ExprTuple: { data: [{ ExprBool: { data: true } }, { ExprString: { data: "s" } }] } }), [true, "s"]));
ok("decode unforgeable", eq(decode({ ExprUnforg: { data: { UnforgPrivate: { data: "ab" } } } }), { unforgeable: "UnforgPrivate", hex: "ab" }));

// The REV address derivation matches quantum-os localnet wallet.txt for alice.
ok("rev address of alice", revAddressOf("0b60b3ffcc43a607e037c3da3c1ed366261d742288abdf92d53cf80b9e3cf98f") === "1111bn92xHbttqWHEXqD8PiykFxgeUjizzquT6JRePj2pAoHFAuiK");

// Group decoding.
const g = toGroup("g", { name: "G", policy: "invite", admins: { a: true }, members: { a: { role: "admin", label: "G" }, b: { role: "member", label: "Bee" } }, invited: { c: true }, deleg: { b: "a" }, topic: {}, ratings: { a: { b: 3 } }, censures: { a: { b: true } } })!;
ok("toGroup", g.policy === "invite" && g.members.length === 2 && eq(g.invited, ["c"]) && eq(g.censures, { a: ["b"] }) && g.ratings.a.b === 3, g);

// Estimates and the median.
ok("estimate round trip", eq(parseEstimate(estimateBallot({ "c.dev": 30, "c.val": 70 })), { "c.dev": 30, "c.val": 70 }));
ok("malformed estimate entries ignored", eq(parseEstimate(["x=1", "junk", "y=-3", "z=abc"]), { x: 1 }));
const issue = (ballots: Record<string, string[]>) => ({ ballots } as any);
let p = chamberPower(["a", "b"], null);
ok("no estimates → equal power", p.share.a === 0.5 && p.share.b === 0.5 && p.estimators === 0, p);
p = chamberPower(["a", "b", "c"], issue({ v1: ["a=60", "b=20", "c=20"], v2: ["a=20", "b=60", "c=20"], v3: ["a=1", "b=1", "c=8"] }));
// normalised: v1 60/20/20, v2 20/60/20, v3 10/10/80 → medians a 20, b 20, c 20 → equal thirds
ok("median resists one extreme estimate", Math.abs(p.share.c - 1 / 3) < 1e-9 && p.estimators === 3, p);
p = chamberPower(["a", "b"], issue({ v1: ["a=3", "b=1"] }));
ok("only proportions matter", p.share.a === 0.75, p);

// Combination across stakeholder groups.
const out = (weights: Record<string, number>, ballots: Record<string, string[]>) => ({ weights, ballots, levels: {}, discredited: [], trustActive: false, winner: null, mode: "approval" });
const sA = approvalShare(["x", "y"], out({ v1: 3, v2: 1 }, { v1: ["x"], v2: ["y"] }));
ok("weighted approval share", sA.x === 0.75 && sA.y === 0.25, sA);
const sB = approvalShare(["x", "y"], out({ v3: 1 }, { v3: ["y", "y"] }));
ok("duplicate approvals count once", sB.y === 1, sB);
const groups = [{ chamber: { id: "A" }, share: sA }, { chamber: { id: "B" }, share: sB }, { chamber: { id: "C" }, share: { x: 0, y: 0 } }] as any;
const c = combine(["x", "y"], groups, { share: { A: 0.5, B: 0.3, C: 0.2 }, median: {}, estimators: 0 });
ok("Σ power × share", Math.abs(c.score.x - 0.375) < 1e-9 && Math.abs(c.score.y - 0.425) < 1e-9 && c.winner === "y", c);
const t = combine(["x", "y"], [{ chamber: { id: "A" }, share: { x: 0.5, y: 0.5 } }] as any, { share: { A: 1 }, median: {}, estimators: 0 });
ok("a tie names no winner", t.winner === null && eq(t.tie.sort(), ["x", "y"]), t);

// Arguments.
ok("argument round trip keeps pipes in text", eq(decodeArg(encodeArg("con", "2s", "a | b")), { raw: "con|2s|a | b", side: "con", option: "2s", text: "a | b" }));
ok("non-argument rejected", decodeArg("hello") === null);

console.log(`unit: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
