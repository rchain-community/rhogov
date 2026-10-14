// unit.ts — offline checks (no node): decoding, keys, council arithmetic.
import { approvalShare, approvals, chamberPower, combine, decodeArg, encodeArg, estimateBallot, parseEstimate } from "../src/chain/council";
import { readRecord, toGroup } from "../src/chain/gov";
import {
  active, chainIdOf, chainReset, displayName, earlier, fromEarlierChain, knownGenesis, liveGenesis, myAddr, ownKeyHere,
  setDisplayName, setKey, setSetupNode, UNKNOWN_CHAIN, usable,
} from "../src/state";
import { addCommunity, addressBook, learnListed, learnNames, nameNotes, setActive } from "../src/state";
import { filterPeople, looksLike, nameError, resolvePerson, suggestNames } from "../src/chain/people";
import { revAddressOf } from "../src/chain/keys";
import { decryptKeystore, encryptKeystore, ethAddressOf, keystoreFileName, looksLikeKeystore } from "../src/chain/keystore";
import { decode, NotCarried, RNode } from "../src/chain/node";

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
ok("vote counts: one per person per option, unknown options ignored",
  eq(approvals(["x", "y", "z"], { a: ["x", "y"], b: ["x", "x"], c: ["w"] }), { x: 2, y: 1, z: 0 }));

// Choosing a person by name or address.
{
  const A = "1111bn92xHbttqWHEXqD8PiykFxgeUjizzquT6JRePj2pAoHFAuiK", B = "1111pJu4TJaJDNJDTinnftr2fcHvMfnDeTRXRzwgPfwuKmGMa5juj";
  const C = "1111gW5kkGxHg7xDg6dRkZx2f7qxTizJzaCH9VEM1oJKWRvSX9Sk5";
  const people: Record<string, string> = { [A]: "Aria", [B]: "Jim", [C]: "jim" };
  const r1 = resolvePerson(" Aria ", people);
  ok("a name resolves, ignoring surrounding space", r1.ok && r1.addr === A);
  ok("capitals count: Jim and jim are two people", (() => { const x = resolvePerson("Jim", people), y = resolvePerson("jim", people); return x.ok && y.ok && x.addr === B && y.addr === C; })());
  ok("a name in the wrong case is not someone else's", !resolvePerson("aria", people).ok);
  const r2 = resolvePerson(B, people);
  ok("an address is taken as typed", r2.ok && r2.addr === B && r2.name === "Jim");
  const r5 = resolvePerson("Zed", people);
  ok("an unknown name is refused", !r5.ok && r5.why === "unknown");
  const r6 = resolvePerson("1111bn92xHbttqWHEX", people);
  ok("text starting with a digit is an address, and a cut-short one is called out", !r6.ok && r6.why === "bad-address");
  ok("names that start with what's typed are offered", eq(suggestNames("J", ["Jim", "jim", "Jo", "Aria"]), ["Jim", "Jo", "jim"]));
  ok("…none once it reads as an address", eq(suggestNames("11", ["11 is not a name"]), []));
  const nm = (a: string) => people[a];
  ok("filtering people: names starting with what's typed, exact capitals first", eq(filterPeople("j", [A, B, C], nm), [C, B]));
  ok("…an empty filter keeps everyone; digits filter by address", eq(filterPeople("", [A, B], nm), [A, B]) && eq(filterPeople("1111pJ", [A, B, C], nm), [B]));
  ok("look-alikes are one name: Greek α, Cyrillic а, fullwidth, zero-width", looksLike("Ada", "Adα") && looksLike("Ada", "Аda") && looksLike("Ada", "Ａｄａ") && looksLike("Ada", "Ad\u200Ba"));
  ok("…and shapes that coincide: l/I/1, O/0, rn/m", looksLike("Ian", "lan") && looksLike("B0b", "BOb") && looksLike("Kim", "Kirn"));
  ok("capitals still count where shapes differ", !looksLike("Jim", "jim") && !looksLike("Ada", "ada"));
  ok("mixed alphabets and invisible characters are refused", nameError("Adα") !== "" && nameError("Ad\u200Ba") !== "" && nameError("Αδα") === "" && nameError("Анна") === "");
  ok("a name can't start with a digit", nameError("1st") !== "" && nameError("Ada") === "" && nameError("  ") !== "");
}

// Names belong to one community (#38a): a group label learned in A isn't shown in B.
{
  const A = { name: "A", node: "http://n", inbox: "rho:id:a1", group: "rho:id:a2", issue: "rho:id:a3" };
  const B = { name: "B", node: "http://n", inbox: "rho:id:b1", group: "rho:id:b2", issue: "rho:id:b3" };
  addCommunity(A); addCommunity(B);
  setActive(A.group);
  learnNames([{ addr: "1111T", label: "Treasurer" }, { addr: "1111U", label: "Ada" }, { addr: "1111V", label: "Adα" }]);
  ok("look-alike labels are numbered, neither shown as the owner", addressBook.value["1111U"] === "Ada (1)" && addressBook.value["1111V"] === "Adα (2)" && !!nameNotes.value["1111U"]);
  ok("a label shows in the community that gave it", addressBook.value["1111T"] === "Treasurer");
  setActive(B.group);
  learnNames([]);
  ok("…and not in another community", addressBook.value["1111T"] === undefined);

  const C = { name: "C", node: "http://n", inbox: "rho:id:c1", group: "rho:id:c2", issue: "rho:id:c3" };
  addCommunity(C);
  setActive(C.group);
  learnListed({ "1111A": "Ada", "1111B": "Adα" });
  ok("two claimed look-alikes are both numbered",
    addressBook.value["1111A"] === "Ada (1)" && addressBook.value["1111B"] === "Adα (2)", addressBook.value);
  setActive(null);
}

// A reasonless refusal that was not carried is safe to retry (#63).
{
  let caught: unknown;

  // This zero-timeout offline check pins the NotCarried message/contract only; the
  // network path into this branch is covered separately by the browser scenarios.
  try { await new RNode("http://offline").outcome("sig", { timeoutMs: 0, unconfirmed: true }); }
  catch (e) { caught = e; }

  ok("not-carried outcome says retry is safe",
    caught instanceof NotCarried && /safe to try again/i.test(caught.message) && /nothing was charged/i.test(caught.message),
    caught instanceof Error ? caught.message : caught);
}

// The same write cannot be started twice while the first is still in flight (#63).
{
  const g = globalThis as any;
  g.location ??= { hash: "", origin: "http://unit", pathname: "/" };
  g.window ??= { addEventListener() {}, removeEventListener() {}, scrollTo() {}, innerWidth: 1024, innerHeight: 768 };
  const { act } = await import("../src/ui/kit");
  let finish!: (value: number) => void;
  let secondRan = false;
  const first = act("First title", () => new Promise<number>((resolve) => { finish = resolve; }), { risk: "routine", key: "same-write" });
  await Promise.resolve();
  const second = await act("Changed title", async () => { secondRan = true; return 2; }, { risk: "routine", key: "same-write" });
  ok("an in-flight write rejects a duplicate identity even if its title changes", second === undefined && !secondRan, { second, secondRan });
  finish(1);
  await first;
}

// Arguments.
ok("argument round trip keeps pipes in text", eq(decodeArg(encodeArg("con", "2s", "a | b")), { raw: "con|2s|a | b", side: "con", option: "2s", text: "a | b" }));
ok("non-argument rejected", decodeArg("hello") === null);

// Recorded results (RT-13). Closing a vote records the node's answer and the weights it
// was taken over, so the record can be checked against the weights rather than against a
// tally that keeps moving. Records made before that are a bare winner string.
{
  const frozen = readRecord({ winner: "Alpha", weight: 7, ballots: 3 });
  ok("a frozen record gives back what it was taken over", frozen.winner === "Alpha" && frozen.weight === 7 && frozen.ballots === 3 && frozen.frozen);
  ok("a frozen record with no winner reads as no winner", readRecord({ winner: null }).winner === null);
  const legacy = readRecord("Beta");
  ok("an older bare-string record still reads, and is not claimed as frozen", legacy.winner === "Beta" && !legacy.frozen);
  ok("a value that is neither shape reads as nothing rather than guessing", readRecord([]).winner === null && !readRecord([]).frozen);
}

// Keystore files (#86): the Web3 Secret Storage v3 test vectors, and a round trip.
{
  const secret = "7a28b5ba57c53603b0b07b56bba752f7784bf506fa95edc395f5cf6c7514fe9d";
  const vector = (kdf: string, kdfparams: object, iv: string, ciphertext: string, mac: string) => ({
    version: 3, id: "3198bc9c-6672-5ab3-d995-4942343ae5b6", address: "008aeeda4d805471df9b2a5b0f38a0c3bcba786b",
    crypto: { cipher: "aes-128-ctr", cipherparams: { iv }, ciphertext, kdf, kdfparams, mac },
  });
  const pbkdf2 = vector("pbkdf2", { c: 262144, dklen: 32, prf: "hmac-sha256", salt: "ae3cd4e7013836a3df6bd7241b12db061dbe2c6785853cce422d148a624ce0bd" },
    "6087dab2f9fdbbfaddc31a909735c1e6", "5318b4d5bcd28de64ee5559e671353e16f075ecae9f99c7a79a38af5f869aa46", "517ead924a9d0dc3124507e3393d175ce3ff7c1e96529c6c555ce9e51205e9b2");
  const scrypt = vector("scrypt", { dklen: 32, n: 262144, p: 8, r: 1, salt: "ab0c7876052600dd703518d6fc3fe8984592145b591fc8fb5c6d43190334ba19" },
    "83dbcc02d8ccb40e466191a123791e0e", "d172bf743a674da9cdad04534d56926ef8358534d458fffccd4e6ad2fbde479c", "2103ac29920d71da29f15d75b4a16dbe95cfd7ff8faea1056c33131d846e3097");
  const fails = async (f: () => Promise<unknown>, re: RegExp) => f().then(() => false, (e) => re.test(String(e?.message)));
  ok("eth address of the vector key", ethAddressOf(secret) === "008aeeda4d805471df9b2a5b0f38a0c3bcba786b");
  ok("keystore: pbkdf2 test vector opens", (await decryptKeystore(pbkdf2, "testpassword")) === secret);
  ok("keystore: scrypt test vector opens", (await decryptKeystore(JSON.stringify(scrypt), "testpassword")) === secret);
  ok("keystore: a wrong password says so", await fails(() => decryptKeystore(pbkdf2, "nope"), /Wrong password/));
  ok("keystore: a file whose address isn't its key's is refused", await fails(() => decryptKeystore({ ...pbkdf2, address: "00".repeat(20) }, "testpassword"), /doesn't match/));
  ok("keystore: not JSON says so", await fails(() => decryptKeystore("0b60b3ff", "x"), /isn't JSON/));
  const alice = "0b60b3ffcc43a607e037c3da3c1ed366261d742288abdf92d53cf80b9e3cf98f";
  const ks = await encryptKeystore(alice, "correct horse", { n: 1024, r: 8, p: 1 });
  ok("keystore: round trip", (await decryptKeystore(JSON.stringify(ks), "correct horse")) === alice);
  ok("keystore: written as v3 scrypt aes-128-ctr", ks.version === 3 && ks.crypto.kdf === "scrypt" && ks.crypto.cipher === "aes-128-ctr" && !JSON.stringify(ks).includes(alice));
  ok("keystore: recognised, a hex key isn't", looksLikeKeystore(JSON.stringify(ks)) && !looksLikeKeystore(alice));
  ok("keystore: geth file name", keystoreFileName(ks, new Date("2026-10-14T09:53:52Z")) === `UTC--2026-10-14T09-53-52.000Z--${ks.address}.json`);
}

// Per-chain state (#89): a chain is a node URL plus its genesis hash.
{
  const A = "aa".repeat(32), B = "bb".repeat(32);
  const node = "http://pg.example:40403";
  const k1 = "0b60b3ffcc43a607e037c3da3c1ed366261d742288abdf92d53cf80b9e3cf98f", k2 = "11".repeat(32);
  setSetupNode(node + "/");
  knownGenesis.value = { [node]: A }; liveGenesis.value = { [node]: A };
  ok("chain id: URL without trailing slash, plus genesis", chainIdOf(node + "/") === `${node}#${A}`);
  ok("no reset while the node serves the known chain", chainReset.value === null);
  const old = { name: "Old", node, chain: A, inbox: "rho:id:i", group: "rho:id:gold", issue: "rho:id:s" };
  const pre = { name: "Pre89", node, inbox: "rho:id:i2", group: "rho:id:gpre", issue: "rho:id:s2" };
  addCommunity(old); addCommunity(pre);
  ok("a community on the known chain is usable", !fromEarlierChain(old) && active.value?.group === "rho:id:gpre");
  setKey(k1, "Ada");
  const addr = myAddr.value;
  ok("main key and name", !!addr && displayName.value === "Ada" && !ownKeyHere.value);

  liveGenesis.value = { [node]: B };
  ok("a new genesis at the same URL is a reset", chainReset.value?.was === A && chainReset.value?.now === B, chainReset.value);
  ok("the old chain's community stays usable until the reset is accepted", !fromEarlierChain(old));
  ok("identity carries over to the reset chain", myAddr.value === addr && displayName.value === "Ada");
  knownGenesis.value = { [node]: B };
  ok("after accepting, the old community is from an earlier chain", fromEarlierChain(old) && earlier.value.some((c) => c.group === "rho:id:gold") && !usable.value.some((c) => c.group === "rho:id:gold"));
  ok("a community marked unknown is earlier too", fromEarlierChain({ ...pre, chain: UNKNOWN_CHAIN }));

  ok("a community added while the node serves a chain is stamped with it", earlier.value.some((c) => c.group === "rho:id:gpre"));
  addCommunity({ name: "New", node, inbox: "rho:id:i3", group: "rho:id:gnew", issue: "rho:id:s3" });
  ok("a community on the new chain is usable and active", active.value?.group === "rho:id:gnew" && !fromEarlierChain(active.value!));
  setKey(k2, "Bea", { here: true });
  ok("a key of this chain's own, with its own name", ownKeyHere.value && myAddr.value !== addr && displayName.value === "Bea");
  liveGenesis.value = { [node]: A }; knownGenesis.value = { [node]: A };
  addCommunity(old);
  ok("the other chain keeps the main key and name", myAddr.value === addr && displayName.value === "Ada" && !ownKeyHere.value);
  setDisplayName("Ada2");
  liveGenesis.value = { [node]: B }; knownGenesis.value = { [node]: B };
  addCommunity({ name: "New", node, chain: B, inbox: "rho:id:i3", group: "rho:id:gnew", issue: "rho:id:s3" });
  ok("renaming on one chain doesn't rename a chain with its own key", displayName.value === "Bea");
  setKey(null);
  ok("removing a chain's own key goes back to the main key and name", !ownKeyHere.value && myAddr.value === addr && displayName.value === "Ada2");
}

console.log(`unit: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
