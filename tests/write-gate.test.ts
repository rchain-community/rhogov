import assert from "node:assert/strict";
import { test } from "node:test";
import { ActionLocks, BusyAction, PendingWrite, Receipts, actionKey, assertSigningContext, type ActionRef, type ReceiptStorage, type WriteObserver } from "../src/chain/write-gate";
import { DeployFailed, RNode, StillUnknown } from "../src/chain/node";
import { revAddressOf } from "../src/chain/keys";

class MemoryStorage implements ReceiptStorage {
  entries = new Map<string, string>();
  get length() { return this.entries.size; }
  key(i: number) { return [...this.entries.keys()][i] ?? null; }
  getItem(k: string) { return this.entries.get(k) ?? null; }
  setItem(k: string, v: string) { this.entries.set(k, v); }
  removeItem(k: string) { this.entries.delete(k); }
}
const ref = (target = "alice", actor = "signer", node = "https://node.example"): ActionRef =>
  ({ node, actor, contract: "rho:id:group", verb: "role", targets: ["group", target] });

test("one logical target is reserved before review begins", () => {
  const locks = new ActionLocks(new Receipts(new MemoryStorage()));
  const release = locks.acquire(ref());
  assert.throws(() => locks.acquire(ref()), BusyAction);
  release();
  assert.doesNotThrow(() => locks.acquire(ref())());
});
test("independent targets do not collide even when their display title is the same", () => {
  const locks = new ActionLocks(new Receipts(new MemoryStorage()));
  const a = locks.acquire(ref("alice")), b = locks.acquire(ref("bob"));
  a(); b();
});
test("display labels and payload changes cannot change the logical lock key", () => {
  const a = ref();
  assert.equal(actionKey(a), actionKey({ ...a, targets: [...a.targets] }));
  // The descriptor has no title, name, ballot or rating-value field.
  assert.notEqual(actionKey(a), actionKey(ref("bob")));
});
test("actor, endpoint, contract, verb and target namespaces are distinct", () => {
  const a = ref();
  for (const b of [ref("alice", "other"), ref("alice", "signer", "https://other.example"),
      { ...a, contract: "rho:id:other" }, { ...a, verb: "leave" }, ref("bob")])
    assert.notEqual(actionKey(a), actionKey(b));
  assert.equal(actionKey(ref()), actionKey(ref("alice", "signer", "https://NODE.example:443/")));
});
test("an unresolved signature survives a new gate instance and blocks a new submit", () => {
  const storage = new MemoryStorage(), receipts = new Receipts(storage);
  receipts.remember(ref(), "signed-receipt", "Removing admin");
  const reloaded = new ActionLocks(new Receipts(storage));
  assert.throws(() => reloaded.acquire(ref()), PendingWrite);
  assert.doesNotThrow(() => reloaded.acquire(ref(), "signed-receipt")());
  assert.throws(() => reloaded.acquire(ref(), "another-receipt"), PendingWrite);
});
test("journal stores only public action identity and receipt metadata", () => {
  const storage = new MemoryStorage(), receipts = new Receipts(storage);
  receipts.remember(ref(), "signature", "Changing a role");
  const record = JSON.parse([...storage.entries.values()][0]);
  assert.deepEqual(Object.keys(record).sort(), ["action", "at", "signature", "title"]);
  assert.equal(receipts.list().length, 1);
  receipts.forget(ref());
  assert.deepEqual(receipts.list(), []);
});
test("storage denial refuses submission rather than pretending the receipt is durable", () => {
  const storage = new MemoryStorage();
  storage.setItem = () => { throw new Error("denied"); };
  assert.throws(() => new Receipts(storage).remember(ref(), "sig", "Role"), /No deploy was sent/);
});
test("a damaged pending record does not become permission to repeat", () => {
  const storage = new MemoryStorage(), receipts = new Receipts(storage);
  receipts.remember(ref(), "sig", "Role");
  storage.setItem([...storage.entries.keys()][0], "not-json");
  assert.throws(() => new ActionLocks(receipts).acquire(ref()), /damaged/);
});
test("signing context is bound to the actor and normalized endpoint", () => {
  const request = { node: "https://node.example/", actor: "signer", term: "exact term", phloLimit: 123 };
  assert.doesNotThrow(() => assertSigningContext(ref(), request));
  assert.throws(() => assertSigningContext(ref(), { ...request, actor: "other" }), /changed/);
  assert.throws(() => assertSigningContext(ref(), { ...request, node: "https://evil.example" }), /changed/);
});

// Transport is entirely mocked. No public node, faucet or funded test key is contacted.
const key = "1".padStart(64, "0");
const actor = revAddressOf(key);
async function withNode(fn: (node: RNode, posts: any[]) => Promise<void>, deploy = () => new Response(JSON.stringify("Success"))) {
  const oldFetch = globalThis.fetch, posts: any[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/status")) return Response.json({ latestBlockNumber: 1, minPhloPrice: 1, shardId: "/root" });
    if (url.endsWith("/api/blocks/1")) return Response.json([{ blockHash: "mock-tip" }]);
    if (url.includes("explore-deploy")) return Response.json({ expr: [{ ExprInt: 10_000_000 }] });
    if (url.endsWith("/api/deploy")) { posts.push(JSON.parse(String(init?.body))); return deploy(); }
    throw new Error("unexpected mocked request: " + url);
  };
  try { await fn(new RNode("https://mock.example"), posts); } finally { globalThis.fetch = oldFetch; }
}
test("cancelled review performs no signing callback and no deploy POST", async () => {
  await withNode(async (node, posts) => {
    let signed = false;
    const onTick: WriteObserver = Object.assign(() => {}, {
      beforeSign: async () => { throw new Error("cancelled"); },
      onSigned: () => { signed = true; },
    });
    await assert.rejects(node.deploy("new return in { return!(1) }", key, { onTick }), /cancelled/);
    assert.equal(signed, false);
    assert.equal(posts.length, 0);
  });
});
test("review sees the exact submitted term and receipt is stored before POST", async () => {
  const storage = new MemoryStorage(), receipts = new Receipts(storage);
  const action = { ...ref(), node: "https://mock.example", actor };
  const term = "new return in { return!(7) }";
  let reviewed = "", signed = "";
  await withNode(async (node, posts) => {
    node.outcome = async () => [7];
    const onTick: WriteObserver = Object.assign(() => {}, {
      beforeSign: async (request: any) => { assertSigningContext(action, request); reviewed = request.term; },
      onSigned: (sig: string) => { signed = sig; receipts.remember(action, sig, "Example"); },
      onSettled: () => receipts.forget(action),
    });
    assert.deepEqual(await node.deploy(term, key, { onTick }), [7]);
    assert.equal(posts[0].data.term, reviewed);
    assert.equal(posts[0].signature, signed);
    assert.equal(receipts.get(action), null);
  }, () => {
    assert.equal(receipts.get(action)?.signature, signed);
    return new Response(JSON.stringify("Success"));
  });
});
test("receipt persistence failure happens before the network POST", async () => {
  await withNode(async (node, posts) => {
    const onTick: WriteObserver = Object.assign(() => {}, { onSigned: () => { throw new Error("storage denied"); } });
    await assert.rejects(node.deploy("new return in { return!(1) }", key, { onTick }), /storage denied/);
    assert.equal(posts.length, 0);
  });
});
test("lost transport response retains a receipt across reload", async () => {
  const storage = new MemoryStorage(), receipts = new Receipts(storage);
  const action = { ...ref(), node: "https://mock.example", actor };
  await withNode(async (node, posts) => {
    const onTick: WriteObserver = Object.assign(() => {}, {
      onSigned: (sig: string) => receipts.remember(action, sig, "Example"),
      onSettled: () => receipts.forget(action),
    });
    await assert.rejects(node.deploy("new return in { return!(1) }", key, { onTick }));
    assert.equal(posts.length, 1);
    assert.ok(receipts.get(action));
    assert.throws(() => new ActionLocks(new Receipts(storage)).acquire(action), PendingWrite);
  }, () => { throw new Error("connection lost"); });
});
test("unknown outcomes retain receipts; an observed execution failure releases them", async () => {
  for (const failed of [false, true]) {
    const storage = new MemoryStorage(), receipts = new Receipts(storage);
    const action = { ...ref(), node: "https://mock.example", actor };
    await withNode(async (node) => {
      node.outcome = async (sig) => { if (failed) throw new DeployFailed("executed and failed"); throw new StillUnknown(sig, "unknown"); };
      const onTick: WriteObserver = Object.assign(() => {}, {
        onSigned: (sig: string) => receipts.remember(action, sig, "Example"),
        onSettled: () => receipts.forget(action),
      });
      await assert.rejects(node.deploy("new return in { return!(1) }", key, { onTick }));
      assert.equal(!!receipts.get(action), !failed);
    });
  }
});
