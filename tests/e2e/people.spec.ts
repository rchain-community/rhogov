// People you know from one community can be chosen by name in another
// (same network): Bob is in "Colab" in one community; Alice invites him by
// name into "Users" in her second community.
import { expect, test } from "@playwright/test";
import { generateKey, revAddressOf } from "../../src/chain/keys";
import { RNode } from "../../src/chain/node";
import { NODE, onboard, open, person, settle, startCommunity } from "./helpers";

test("invite by a name known from another community", async ({ browser }) => {
  const alice = await person(browser, "Alice");
  await onboard(alice, "Alice");
  const invite = await startCommunity(alice, `Colab ${Date.now()}`);
  await open(alice, "#/groups");
  await alice.getByRole("button", { name: "＋ New group" }).click();
  await alice.getByPlaceholder("e.g. Budget committee").fill("Colab");
  await alice.getByRole("button", { name: "Create group" }).click();
  await settle(alice);
  const colab = await alice.evaluate(() => location.hash);

  const bob = await person(browser, "Bob");
  await onboard(bob, "Bob", invite);
  await settle(bob);
  await open(bob, colab);
  await bob.getByRole("button", { name: "Join group" }).click();
  await settle(bob);

  // Alice's second community, with a Users group that Bob has never seen.
  await open(alice, "#/community");
  await alice.getByRole("button", { name: "Join or start another community" }).click();
  await startCommunity(alice, `Second ${Date.now()}`);
  await open(alice, "#/groups");
  await alice.getByRole("button", { name: "＋ New group" }).click();
  await alice.getByPlaceholder("e.g. Budget committee").fill("Users");
  await alice.getByRole("button", { name: "Create group" }).click();
  await settle(alice);
  await open(alice, (await alice.evaluate(() => location.hash)) + "/members");
  await alice.getByRole("button", { name: "Invite someone" }).click();
  await alice.locator(".modal").getByLabel("Who").fill("Bo");
  await alice.locator(".modal").getByRole("option", { name: "Bob" }).click();
  await expect(alice.locator(".modal").getByText("→")).toContainText("Bob");
  await expect(alice.getByRole("button", { name: "Invite", exact: true })).toBeEnabled();
});

// Peter joins a community from an invite with a brand-new, unfunded key and no
// group. Home tells him others can't find him by name yet and lets him get test
// REV; once he has it, his name goes on the list and Alice can invite him by name.
test("a newcomer in no group becomes findable by name", async ({ browser }) => {
  const alice = await person(browser, "Alice");
  await onboard(alice, "Alice");
  const invite = await startCommunity(alice, `Colab ${Date.now()}`);
  await open(alice, "#/groups");
  await alice.getByRole("button", { name: "＋ New group" }).click();
  await alice.getByPlaceholder("e.g. Budget committee").fill("Users");
  await alice.getByRole("button", { name: "Create group" }).click();
  await settle(alice);
  const users = await alice.evaluate(() => location.hash);

  const peterKey = generateKey();
  const name = `Peter${Date.now() % 100000}`;
  const peter = await person(browser, "Peter");
  await onboard(peter, name, invite, peterKey);
  await open(peter, "#/");
  const note = peter.locator(".callout", { hasText: "Others can't find you by name yet" });
  await expect(note).toBeVisible();
  await note.getByRole("button", { name: "Get test REV" }).click();
  await expect.poll(async () => (await new RNode(NODE).balance(revAddressOf(peterKey))) ?? 0, { timeout: 120_000 }).toBeGreaterThan(0);
  await expect(note).toHaveCount(0, { timeout: 180_000 }); // his name went on the list by itself

  await open(alice, users + "/members");
  await alice.getByRole("button", { name: "Invite someone" }).click();
  await alice.locator(".modal").getByLabel("Who").fill(name.slice(0, 4));
  await alice.locator(".modal").getByRole("option", { name }).click();
  await expect(alice.locator(".modal").getByText("→")).toContainText(name);
});
