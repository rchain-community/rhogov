import { strict as assert } from "node:assert";
import { afterEach, beforeEach, test } from "node:test";
import { RNode } from "../src/chain/node";
import { namePath } from "../src/chain/profile";
import {
  addCommunity, addressBook, communities, learnListed, learnNames,
  nameNotes, notePublished, publishedName, setActive,
} from "../src/state";

const A = { name: "A", node: "http://network-a", inbox: "rho:id:a1", group: "rho:id:a2", issue: "rho:id:a3" };
const B = { name: "B", node: A.node, inbox: "rho:id:b1", group: "rho:id:b2", issue: "rho:id:b3" };
const C = { name: "C", node: "http://network-b", inbox: "rho:id:c1", group: "rho:id:c2", issue: "rho:id:c3" };
const explore = RNode.prototype.explore;

beforeEach(() => {
  communities.value = [];
  addCommunity(A); addCommunity(B); addCommunity(C);
  setActive(A.group);
  RNode.prototype.explore = async () => [];
});
afterEach(() => { RNode.prototype.explore = explore; communities.value = []; });

test("same-network switch preserves directory names immediately but removes community names", () => {
  notePublished("directory", "Ada");
  learnListed({ listed: "Alice" });
  learnNames([{ addr: "label", label: "Bob" }]);
  setActive(B.group);
  assert.deepEqual(addressBook.value, { directory: "Ada" });
  assert.equal(publishedName("directory"), "Ada");
  learnListed({ listed: "Beatrice" });
  assert.deepEqual(addressBook.value, { directory: "Ada", listed: "Beatrice" });
});

test("switch recalculates duplicate markers from retained directory claims only", () => {
  notePublished("a", "Ada"); notePublished("b", "Ada");
  learnListed({ c: "Ada" });
  learnNames([{ addr: "d", label: "Ada" }]);
  assert.equal(addressBook.value.c, "Ada (3)");
  assert.equal(addressBook.value.d, "Ada (unclaimed)");
  setActive(B.group);
  assert.deepEqual(addressBook.value, { a: "Ada (1)", b: "Ada (2)" });
  assert.equal(nameNotes.value.c, undefined);
  assert.equal(nameNotes.value.d, undefined);
});

test("network switch clears directory names and their markers", () => {
  notePublished("a", "Ada"); notePublished("b", "Ada");
  setActive(C.group);
  assert.deepEqual(addressBook.value, {});
  assert.deepEqual(nameNotes.value, {});
  assert.equal(publishedName("a"), undefined);
});

async function pendingLookup() {
  let begin!: () => void, finish!: (value: Record<string, string>[]) => void;
  const started = new Promise<void>((resolve) => { begin = resolve; });
  const result = new Promise<Record<string, string>[]>((resolve) => { finish = resolve; });
  RNode.prototype.explore = async () => { begin(); return result; };
  learnNames([{ addr: "late", label: "Fallback" }]);
  await started;
  return async () => {
    finish([{ [namePath("late")]: "Directory" }]);
    // Let both resolveNames and flushNames finish, without a timed sleep.
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
}

test("in-flight directory lookup survives a same-network community switch", async () => {
  const finish = await pendingLookup();
  setActive(B.group);
  learnListed({ b: "Community B" });
  await finish();
  assert.deepEqual(addressBook.value, { b: "Community B", late: "Directory" });
});

test("late directory response cannot contaminate another network", async () => {
  const finish = await pendingLookup();
  setActive(C.group);
  notePublished("current", "Current");
  await finish();
  assert.deepEqual(addressBook.value, { current: "Current" });
  assert.equal(publishedName("late"), undefined);
});

test("leaving and returning to the same node still invalidates the old lookup", async () => {
  const finish = await pendingLookup();
  setActive(C.group); setActive(A.group);
  notePublished("current", "New lookup");
  await finish();
  assert.deepEqual(addressBook.value, { current: "New lookup" });
  assert.equal(publishedName("late"), undefined);
});
