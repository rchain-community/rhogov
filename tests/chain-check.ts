// chain-check.ts — drive the Gov API the UI uses against a live rchain-rust node.
//
//   npx tsx tests/chain-check.ts [--node http://127.0.0.1:40403]
//
// Needs funded keys: by default the throwaway dev keys from quantum-os
// scripts/localnet/pk.txt, which its wallet.txt funds at genesis. Never use them
// on a network that holds value.
import { Gov, makeId, type Community } from "../src/chain/gov";
import { revAddressOf } from "../src/chain/keys";

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const NODE = arg("--node", "http://127.0.0.1:40403");
const KEYS = {
  alice: "0b60b3ffcc43a607e037c3da3c1ed366261d742288abdf92d53cf80b9e3cf98f",
  bob: "13487106542b1c1472c4af4bf29031ecbad42464a82e38b6f0e18a09bbf54f12",
  carol: "babf57fd43a2c5b46596fa24f20e7f4b7892f66c5d0413f146cac2b9ce9ea902",
};
const A = revAddressOf(KEYS.alice), B = revAddressOf(KEYS.bob), C = revAddressOf(KEYS.carol);
let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) pass++; else fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 220)}` : ""}`);
};
const expectErr = async (label: string, p: Promise<unknown>, re: RegExp) => {
  try { await p; ok(label, false, "no error"); } catch (e) { ok(label, re.test((e as Error).message), (e as Error).message); }
};

const t0 = Date.now();
const uris = await Gov.install(NODE, KEYS.alice, (s) => process.stdout.write(`\r${s}                    `));
console.log();
ok("install three contracts", /^rho:id:/.test(uris.inbox) && /^rho:id:/.test(uris.group) && /^rho:id:/.test(uris.issue), uris);
const c: Community = { name: "test", node: NODE, ...uris };
const as = (k: keyof typeof KEYS) => new Gov(c, () => KEYS[k]);
const alice = as("alice"), bob = as("bob"), carol = as("carol");

const gid = makeId("Garden club");
await alice.createGroup(gid, "Garden club", "open");
let g = await alice.group(gid);
ok("alice creates a group and is its admin", !!g && g.admins.includes(A) && g.members.length === 1, g);
ok("group is listed", (await bob.groupIds()).includes(gid));

await Promise.all([bob.join(gid, "Bob"), carol.join(gid, "Carol")]);
g = await alice.group(gid);
ok("bob and carol join an open group", g!.members.length === 3, g!.members);

const inv = makeId("Inner");
await alice.createGroup(inv, "Inner circle", "invite");
await expectErr("uninvited join is refused", bob.join(inv, "Bob"), /invite-only/);
await alice.invite(inv, B);
await bob.join(inv, "Bob");
ok("invited bob can join", (await bob.group(inv))!.members.some((m) => m.addr === B));
await expectErr("non-admin can't set a role", bob.setRole(gid, C, "admin"), /admin/);

let st = await alice.standing(gid);
ok("no ratings → trust inactive (one person one vote)", st.trustActive === false, st);
await alice.rate(gid, B, 4);
st = await alice.standing(gid);
ok("alice (admin, 5) rates bob 4 → bob capped at level 4", st.trustActive && st.levels[A] === 5 && st.levels[B] === 4, st.levels);

const iid = makeId("Plant what");
const roll = (await alice.group(gid))!.members.map((m) => m.addr);
await alice.openIssue(iid, gid, "What do we plant?", "approval", ["Tomatoes", "Beans"], roll);
let is = await bob.issue(iid);
ok("alice opens an issue with the group roll", !!is && is.voters.length === 3 && is.options.length === 2, is);
ok("issue listed under the group", (await bob.issueIds(gid)).includes(iid));
await bob.addOption(iid, "Squash");
await carol.delegate(gid, B, iid);
await Promise.all([alice.cast(iid, ["Tomatoes"]), bob.cast(iid, ["Beans", "Squash"])]);
is = await alice.issue(iid);
ok("two ballots recorded", Object.keys(is!.ballots).length === 2, is!.ballots);
let out = await alice.outcome(gid, iid);
// weights: alice 1+5=6; bob 1+4=5 plus carol (delegated, level 0) 1 = 6.  Tie 6–6 between Tomatoes and Beans/Squash.
ok("weights come from the node: alice 6, bob 6 (5 + carol's delegated 1)", out.weights[A] === 6 && out.weights[B] === 6, out.weights);
ok("tally names a winner", typeof out.winner === "string", out.winner);
await carol.cast(iid, ["Beans"]);
out = await alice.outcome(gid, iid);
ok("carol voting directly overrides her delegation", out.weights[B] === 5 && out.weights[C] === 1 && out.winner === "Beans", out);
await expectErr("bob can't close alice's issue", bob.close(iid), /opened/);
await alice.close(iid);
await expectErr("closed issue refuses ballots", bob.cast(iid, ["Tomatoes"]), /closed/);
await alice.propose(iid, out.winner);
is = await alice.issue(iid);
ok("closed, with alice's proposed result recorded", is!.status === "closed" && is!.results[A] === "Beans", is);

// A censure counts only from members at or above the target's level, so bob (4)
// and carol (0) cannot discredit alice (5) — the admin root is not toppled by
// lower-trust members.
await Promise.all([bob.censure(gid, A, true), carol.censure(gid, A, true)]);
st = await alice.standing(gid);
ok("lower-trust members cannot discredit an admin", !st.discredited.includes(A), st);
await Promise.all([bob.censure(gid, A, false), carol.censure(gid, A, false)]);
// Lift carol to 4; then alice (5) and carol (4) — every eligible peer of bob — censure bob.
await alice.rate(gid, C, 4);
await Promise.all([alice.censure(gid, B, true), carol.censure(gid, B, true)]);
st = await alice.standing(gid);
ok("⅔ of eligible peers censure bob → discredited, level 0", st.discredited.includes(B) && (st.levels[B] ?? 0) === 0, st);
ok("alice, who vouched for bob at 4, is slashed", (st.levels[A] ?? 0) < 5, st.levels);
await alice.censure(gid, B, false);
st = await alice.standing(gid);
ok("withdrawing a censure lifts it", !st.discredited.includes(B), st);

await bob.send(A, "note", { subject: "Hello", body: "Seeds arrive Tuesday" });
const counts = await carol.inboxCounts(A);
ok("anyone can see alice has 1 note (count only)", counts.note === 1, counts);
const msgs = await alice.receive();
ok("alice receives it, stamped from bob", msgs.length === 1 && msgs[0].from === B && msgs[0].fields.body === "Seeds arrive Tuesday", msgs);
ok("receiving empties the locker", Object.keys(await carol.inboxCounts(A)).length === 0);

console.log(`\n${pass} ok, ${fail} failed  (${Math.round((Date.now() - t0) / 1000)}s)`);
process.exit(fail ? 1 : 0);
