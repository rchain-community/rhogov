// Adding a stakeholder group to a council that already exists: the facilitator
// adds it, people join it, and estimates made before it existed don't count it as 0.
import { expect, test } from "@playwright/test";
import { onboard, open, person, settle, startCommunity } from "./helpers";

test("the facilitator adds a stakeholder group to a running council", async ({ browser }) => {
  const alice = await person(browser, "Alice");
  await onboard(alice, "Alice");
  const invite = await startCommunity(alice, "Research Co-op");
  await settle(alice);

  await open(alice, "#/councils");
  await alice.getByRole("button", { name: "＋ New council" }).click();
  await alice.getByPlaceholder("e.g. Protocol upgrade council").fill("Grants council");
  await alice.getByPlaceholder("e.g. Decide which protocol upgrades").fill("Decide which grants to fund.");
  await alice.getByRole("button", { name: "Create council" }).click();
  await settle(alice);
  const council = await alice.evaluate(() => location.hash);

  // An estimate made while the council had its first four groups.
  await open(alice, council + "/power");
  await alice.getByLabel("Validators estimate").fill("60");
  await alice.getByRole("button", { name: /estimate/ }).click();
  await settle(alice);

  // Only the facilitator is offered the button.
  const bob = await person(browser, "Bob");
  await onboard(bob, "Bob", invite);
  await settle(bob);
  await open(bob, council + "/stakeholders");
  await expect(bob.locator(".card", { hasText: "Developers" })).toBeVisible();
  await expect(bob.getByRole("button", { name: "＋ Add a stakeholder group" })).toHaveCount(0);

  await open(alice, council + "/stakeholders");
  await alice.getByRole("button", { name: "＋ Add a stakeholder group" }).click();
  const modal = alice.locator(".modal");
  await expect(modal.getByText("Service providers")).toBeVisible();
  await expect(modal.getByText("Developers", { exact: true })).toHaveCount(0); // already in the council
  await expect(modal.getByText("The 1 voting-power estimate already made don't include it")).toBeVisible();
  await modal.getByPlaceholder("Another stakeholder group").fill("Researchers");
  await modal.getByRole("button", { name: "Add group" }).click();
  await settle(alice);

  await open(bob, council + "/stakeholders");
  await bob.locator(".card", { hasText: "Researchers" }).getByText("I belong here").click();
  await bob.getByRole("button", { name: /^Join \d group/ }).click();
  await settle(bob);
  await open(bob, council + "/stakeholders");
  await expect(bob.locator(".card", { hasText: "Researchers" }).getByText("You're a member")).toBeVisible();
  await expect(bob.getByText("participants in 5 stakeholder groups")).toBeVisible();

  // Alice's estimate predates Researchers: it isn't read as 0 for it, and she's told.
  await open(alice, council + "/power");
  await expect(alice.getByText("Researchers (in 0 of 1)")).toBeVisible();
  await alice.getByLabel("Researchers estimate").fill("40");
  await alice.getByRole("button", { name: "Update my estimate" }).click();
  await settle(alice);
  await open(alice, council + "/power");
  await expect(alice.getByText("Added after estimates were made")).toHaveCount(0);
  // 40 of 25+25+60+25+40, with one estimator the median is her own.
  await expect(alice.locator(".result", { hasText: "Researchers" })).toContainText("23%");
});
