// membership.spec.ts — a group invitation is chain state. It follows the key to
// a fresh browser, tracks the live membership, and survives deleting the note.
//
//   npm run build && RHOGOV_NODE=http://127.0.0.1:40403 npm run test:e2e -- membership
import { expect, test, type Page } from "@playwright/test";
import { revAddressOf } from "../../src/chain/keys";
import { KEYS, open, onboard, person, settle, startCommunity } from "./helpers";
import { seed, type Invite } from "./helpers-audit";

const keyFor = (addr: string, group: string) => `rhogov:membership:${group}:${addr}`;
const bobAddr = revAddressOf(KEYS.Bob);

test.describe.serial("a group invitation follows the key", () => {
  let alice!: Page, bobA!: Page, bobB!: Page;
  let invite = "", inner = "";

  test.beforeAll(async ({ browser }) => {
    alice = await person(browser, "membership-alice");
    await onboard(alice, "Alice");
    invite = await startCommunity(alice, `Membership ${Date.now()}`);
    await settle(alice);

    // An invite-only group, and Bob's address written into its invited set.
    await open(alice, "#/groups");
    await alice.getByRole("button", { name: "＋ New group" }).click();
    await alice.getByPlaceholder("e.g. Budget committee").fill("Inner circle");
    await alice.locator("label.choice", { hasText: "Invite only" }).click();
    await alice.getByRole("button", { name: "Create group" }).click();
    await settle(alice);
    inner = await alice.evaluate(() => location.hash);

    await open(alice, inner + "/members");
    await alice.getByRole("button", { name: "Invite someone" }).click();
    await alice.locator(".modal").getByLabel("Who").fill(bobAddr);
    await expect(alice.locator(".modal").getByText("not known in your communities yet")).toBeVisible();
    await alice.getByRole("button", { name: "Invite", exact: true }).click();
    await settle(alice);
  });

  test.afterAll(async () => {
    for (const p of [alice, bobA, bobB]) if (p) await p.context().close();
  });

  test("the invitee sees the pending invitation, then the note", async ({ browser }) => {
    bobA = await person(browser, "membership-bob-a");
    await onboard(bobA, "Bob", invite);
    await settle(bobA);

    await open(bobA, "#/");
    await expect(bobA.getByText("You're invited to join")).toBeVisible();

    await open(bobA, "#/inbox");
    const card = bobA.locator(".card", { hasText: "Inner circle" });
    await expect(card.getByText("Waiting for you")).toBeVisible();
    await expect(bobA.getByText("An invitation message is waiting on chain")).toBeVisible();

    await bobA.getByRole("button", { name: "Collect" }).click();
    await settle(bobA);
    await expect(card.getByText("You're invited to join Inner circle.")).toBeVisible();

    // A note is a message, not the invitation: deleting it changes this browser only.
    await card.getByRole("button", { name: "Delete the note" }).click();
    await expect(card.getByText("You're invited to join Inner circle.")).toHaveCount(0);
    await expect(card.getByText("Waiting for you")).toBeVisible();
  });

  test("a second browser sees the invitation from chain, without the note", async ({ browser }) => {
    bobB = await person(browser, "membership-bob-b");
    await onboard(bobB, "Bob", invite);
    await settle(bobB);

    await open(bobB, "#/inbox");
    const card = bobB.locator(".card", { hasText: "Inner circle" });
    await expect(card.getByText("Waiting for you")).toBeVisible();
    await expect(card.getByText("The message that announced it isn't in this browser.")).toBeVisible();
  });

  test("joining clears the invitation in both browsers", async () => {
    await open(bobA, "#/inbox");
    await bobA.locator(".card", { hasText: "Inner circle" }).getByRole("button", { name: "Join group" }).click();
    await settle(bobA);
    await expect(bobA.getByText("Waiting for you")).toHaveCount(0);

    await open(bobB, "#/inbox");
    await expect(bobB.getByText("Waiting for you")).toHaveCount(0);

    await open(bobB, "#/");
    await expect(bobB.getByText("You're invited to join")).toHaveCount(0);
    await expect(bobB.getByText("Inner circle")).toBeVisible();
  });

  test("a different key doesn't inherit the invitation", async ({ browser }) => {
    const carol = await person(browser, "membership-carol");
    await onboard(carol, "Carol", invite);
    await settle(carol);
    await open(carol, "#/inbox");
    await expect(carol.getByText("Waiting for you")).toHaveCount(0);
    await expect(carol.getByText("Inner circle")).toHaveCount(0);
    await carol.context().close();
  });
});

test("last-known membership is shown when the node cannot be read", async ({ browser }) => {
  const p = await person(browser, "membership-offline");
  const now = Date.now();
  const offline: Invite = {
    name: "Offline co-op", node: "http://127.0.0.1:9",
    inbox: "rho:id:offline1", group: "rho:id:offline2", issue: "rho:id:offline3",
  };
  await seed(p, {
    key: KEYS.Bob,
    name: "Bob",
    communities: [offline],
    active: offline.group,
    membership: {
      [keyFor(bobAddr, offline.group)]: {
        v: 1,
        at: now,
        entries: [{ gid: "g-offline", name: "Offline circle", policy: "invite", status: "invited", at: now }],
      },
    },
  });

  await open(p, "#/inbox");
  const card = p.locator(".card", { hasText: "Offline circle" });
  await expect(card.getByText("Waiting for you")).toBeVisible();
  await expect(card.getByText("Last known")).toBeVisible();
  // A write control must never come from the cache.
  await expect(card.getByRole("button", { name: "Join group" })).toHaveCount(0);

  await open(p, "#/");
  await expect(p.getByText("You were invited to join")).toBeVisible();
  await expect(p.getByText("Last known")).toBeVisible();
  await p.context().close();
});
