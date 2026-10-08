// Multi-stakeholder governance end to end, three people in three browsers:
// council → stakeholder groups → voting-power estimates (median) →
// deliberation (pros/cons) → stakeholder-weighted vote → decision of record.
import { expect, test } from "@playwright/test";
import { hasNameDirectory, onboard, open, person, settle, startCommunity } from "./helpers";

test("a council reaches a decision of record across stakeholder groups", async ({ browser }) => {
  const alice = await person(browser, "Alice");
  await onboard(alice, "Alice");
  const invite = await startCommunity(alice, "Protocol Co-op");
  await settle(alice);

  await open(alice, "#/councils");
  await alice.getByRole("button", { name: "＋ New council" }).click();
  await alice.getByPlaceholder("e.g. Protocol upgrade council").fill("Protocol council");
  await alice.getByPlaceholder("e.g. Decide which protocol upgrades").fill("Decide which protocol changes ship next.");
  await alice.getByRole("button", { name: "Create council" }).click();
  await settle(alice);
  const council = await alice.evaluate(() => location.hash);
  await expect(alice.getByRole("heading", { name: "Protocol council" })).toBeVisible();

  // The facilitator starts out in every stakeholder group; she keeps only Validators.
  await open(alice, council + "/stakeholders");
  await expect(alice.getByText("Leave the ones you don't belong to")).toBeVisible();
  for (const g of ["Developers", "Token holders", "Users"]) {
    alice.once("dialog", (d) => d.accept());
    await alice.locator(".card", { hasText: g }).getByRole("button", { name: "Leave" }).click();
    await settle(alice);
  }

  const bob = await person(browser, "Bob"), carol = await person(browser, "Carol");
  for (const [p, name, groups] of [[bob, "Bob", ["Developers"]], [carol, "Carol", ["Users", "Token holders"]]] as const) {
    await onboard(p, name, invite);
    await settle(p);
    await open(p, council + "/stakeholders");
    for (const g of groups) await p.locator(".card", { hasText: g }).getByText("I belong here").click();
    await p.getByRole("button", { name: /^Join \d group/ }).click();
    await settle(p);
  }

  await open(alice, council);
  await alice.getByRole("button", { name: "Add them" }).click();
  await settle(alice);

  // Voting power: each estimates; the median decides.
  for (const [p, est] of [[alice, { Validators: 60 }], [bob, { Developers: 70 }], [carol, { Users: 80 }]] as const) {
    await open(p, council + "/power");
    for (const [k, v] of Object.entries(est)) await p.getByLabel(`${k} estimate`).fill(String(v));
    await p.getByRole("button", { name: /estimate/ }).click();
    await settle(p);
  }
  await open(bob, council + "/power");
  await expect(bob.getByText("The median of 3 participant estimates.")).toBeVisible();

  // Prepare.
  await open(alice, council);
  await alice.getByRole("button", { name: "＋ New decision" }).click();
  await alice.getByPlaceholder("e.g. Which block-time target").fill("Which block time for the next release?");
  await alice.locator(".modal textarea").fill("Faster blocks help UX but load validators.");
  await alice.getByPlaceholder("Option 1").fill("2 seconds");
  await alice.getByPlaceholder("Option 2").fill("5 seconds");
  await alice.getByRole("button", { name: "Open for deliberation" }).click();
  await settle(alice);
  const decision = await alice.evaluate(() => location.hash);

  // Deliberate.
  await open(bob, decision);
  await bob.getByRole("button", { name: "For", exact: true }).click();
  await bob.locator(".card.soft select").selectOption("2 seconds");
  await bob.getByPlaceholder("One clear point").fill("Snappier wallets");
  await bob.getByRole("button", { name: "Add", exact: true }).click();
  await settle(bob);
  await open(carol, decision);
  await carol.getByRole("button", { name: "Against", exact: true }).click();
  await carol.locator(".card.soft select").selectOption("2 seconds");
  await carol.getByPlaceholder("One clear point").fill("Small validators fall behind");
  await carol.getByRole("button", { name: "Add", exact: true }).click();
  await settle(carol);
  await open(carol, decision);
  await carol.locator(".arg", { hasText: "Small validators fall behind" }).getByRole("button", { name: /👍/ }).click();
  await settle(carol);
  await open(carol, decision);
  await expect(carol.locator(".arg", { hasText: "Small validators fall behind" }).getByRole("button", { name: "👍 1" })).toBeVisible();

  // Decide.
  await open(alice, decision);
  await alice.getByRole("button", { name: "Close deliberation and open voting" }).click();
  await settle(alice);
  for (const [p, choice] of [[alice, "5 seconds"], [bob, "2 seconds"], [carol, "5 seconds"]] as const) {
    await open(p, decision);
    await p.locator("label.choice", { hasText: choice }).click();
    await p.getByRole("button", { name: "Vote", exact: true }).click();
    await settle(p);
  }
  await open(bob, decision);
  await expect(bob.getByText("Leading overall: 5 seconds")).toBeVisible();
  // Each stakeholder group's own choice comes from the node's tally over its members.
  await expect(bob.locator(".item", { hasText: "Developers" }).getByText("Group's choice (node tally): 2 seconds")).toBeVisible();
  await expect(bob.locator(".item", { hasText: "Validators" }).getByText("Group's choice (node tally): 5 seconds")).toBeVisible();

  // Record.
  await open(alice, decision);
  await alice.getByRole("button", { name: "Record the decision" }).click();
  await alice.locator(".modal textarea").first().fill("Sustainable for validators; revisit after a hardware survey.");
  await alice.locator(".modal textarea").nth(1).fill("Carol: hardware survey\nBob: benchmark 3s");
  await alice.getByRole("button", { name: "Record and close" }).click();
  await settle(alice);
  await open(carol, decision);
  const record = carol.locator(".card", { hasText: "Decision of record" });
  await expect(record.getByText("5 seconds")).toBeVisible();
  await expect(record.getByText("Bob: benchmark 3s")).toBeVisible();
  await expect(record.getByText("Small validators fall behind")).toHaveCount(0); // dissent is about the winner only
  // Names come from the chain's name directory; without one (the playground) the
  // facilitator shows as her short address.
  await expect(carol.getByText(`Facilitated by ${(await hasNameDirectory()) ? "Alice" : "1111bn92"}`)).toBeVisible();
});
