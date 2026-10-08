// Groups end to end: invite link, names, trust, delegation, a weighted vote, inbox, invitations.
import { expect, test } from "@playwright/test";
import { hasNameDirectory, onboard, open, person, settle, startCommunity } from "./helpers";

test("a community decides with trust and delegation", async ({ browser }) => {
  const alice = await person(browser, "Alice");
  await onboard(alice, "Alice");
  const invite = await startCommunity(alice, "Garden Co-op");
  expect(invite).toContain("#/join?c=");
  await settle(alice); // her name is published once she's set up

  await open(alice, "#/groups");
  await alice.getByRole("button", { name: "＋ New group" }).click();
  await alice.getByPlaceholder("e.g. Budget committee").fill("Garden club");
  await alice.getByRole("button", { name: "Create group" }).click();
  await settle(alice);
  await expect(alice.getByRole("heading", { name: "Garden club" })).toBeVisible();
  const groupHash = await alice.evaluate(() => location.hash);

  // Bob and Carol arrive by the invite link and join.
  const bob = await person(browser, "Bob"), carol = await person(browser, "Carol");
  for (const p of [bob, carol]) {
    await onboard(p, p === bob ? "Bob" : "Carol", invite);
    await settle(p);
    await open(p, groupHash);
    await p.getByRole("button", { name: "Join group" }).click();
    await settle(p);
  }

  // Names come from the chain's name directory, not from the group. Without one
  // (the playground), the group's creator shows as her short address.
  await open(bob, groupHash.replace(/\/?$/, "") + "/members");
  const named = await hasNameDirectory();
  const ALICE = "1111bn92xHbttqWHEXqD8PiykFxgeUjizzquT6JRePj2pAoHFAuiK";
  const aliceShown = named ? "Alice" : ALICE.slice(0, 8);
  await expect(bob.locator(".list .item", { hasText: aliceShown })).toBeVisible();
  await expect(bob.getByRole("heading", { name: "3 members" })).toBeVisible();

  // Alice (admin, level 5) vouches for Bob at 4.
  await open(alice, groupHash + "/members");
  await alice.locator(".list .item", { hasText: "Bob" }).getByRole("button", { name: /^Rate/ }).click();
  await alice.locator("label.choice", { hasText: "4 — Strong" }).click();
  await alice.getByRole("button", { name: "Save rating" }).click();
  await settle(alice);

  // Carol hands her vote to Bob.
  await open(carol, groupHash + "/members");
  await carol.getByRole("button", { name: "Delegate my vote" }).click();
  await carol.locator(".modal label.choice", { hasText: "Bob" }).click();
  await carol.getByRole("button", { name: "Delegate", exact: true }).click();
  await settle(carol);
  await open(carol, groupHash + "/members");
  await expect(carol.getByText("your vote goes to")).toBeVisible();

  // A vote.
  await open(alice, groupHash);
  await alice.getByRole("button", { name: "＋ New vote" }).click();
  await alice.getByPlaceholder("e.g. Which venue for the spring meetup?").fill("What should we plant?");
  await alice.getByPlaceholder("Option 1").fill("Tomatoes");
  await alice.getByPlaceholder("Option 2").fill("Beans");
  await alice.getByRole("button", { name: "Open vote" }).click();
  await settle(alice);
  const issueHash = await alice.evaluate(() => location.hash);
  expect(issueHash).toMatch(/^#\/v\//);

  for (const [p, choice] of [[alice, "Tomatoes"], [bob, "Beans"]] as const) {
    await open(p, issueHash);
    await p.locator("label.choice", { hasText: choice }).click();
    await p.getByRole("button", { name: "Vote", exact: true }).click();
    await settle(p);
  }
  // Weights from the node: Alice 1+5 = 6; Bob 1+4 plus Carol's delegated 1 = 6.
  await open(bob, issueHash);
  await bob.getByText("Who voted, and with what weight").click();
  await expect(bob.locator(".item", { hasText: aliceShown }).getByText("×6")).toBeVisible();
  await expect(bob.locator(".item", { hasText: "You" }).getByText("×6")).toBeVisible();

  // Carol votes herself — overriding her delegation — and tips it.
  await open(carol, issueHash);
  await carol.locator("label.choice", { hasText: "Tomatoes" }).click();
  await carol.getByRole("button", { name: "Vote", exact: true }).click();
  await settle(carol);
  await open(carol, issueHash);
  await expect(carol.getByText("Leading: Tomatoes")).toBeVisible();

  // Alice closes and records; the record is checked against the node's tally.
  await open(alice, issueHash);
  alice.once("dialog", (d) => d.accept());
  await alice.getByRole("button", { name: "Close voting and record result" }).click();
  await settle(alice);
  await open(alice, issueHash);
  await expect(alice.getByText("matches the node's tally")).toBeVisible();
  await expect(alice.getByText("Closed", { exact: true })).toBeVisible();

  // Inbox: Bob writes to Alice; Alice collects it, stamped from Bob.
  await open(bob, "#/inbox");
  await bob.getByRole("button", { name: "✎ New message" }).click();
  if (named) await bob.locator(".modal select").selectOption({ label: "Alice" });
  else await bob.getByPlaceholder("or paste a REV address (1111…)").fill(ALICE);
  await bob.locator(".modal label", { hasText: "Subject" }).locator("input").fill("Seeds");
  await bob.locator(".modal textarea").fill("They arrive Tuesday.");
  await bob.getByRole("button", { name: "Send" }).click();
  await settle(bob);
  await open(alice, "#/");
  await expect(alice.getByText("1 new message")).toBeVisible();
  await open(alice, "#/inbox");
  await alice.getByRole("button", { name: "Collect" }).click();
  await settle(alice);
  await expect(alice.locator(".card", { hasText: "They arrive Tuesday." }).getByText("Bob")).toBeVisible();
  await open(alice, "#/inbox");
  await expect(alice.getByText("No new messages on chain.")).toBeVisible();

  // An invite-only group: Alice invites Carol by address, with a message.
  await open(alice, "#/groups");
  await alice.getByRole("button", { name: "＋ New group" }).click();
  await alice.getByPlaceholder("e.g. Budget committee").fill("Inner circle");
  await alice.locator("label.choice", { hasText: "Invite only" }).click();
  await alice.getByRole("button", { name: "Create group" }).click();
  await settle(alice);
  const inner = await alice.evaluate(() => location.hash);
  await open(carol, "#/account");
  const carolFull = await carol.locator(".card .mono").first().textContent();
  await open(alice, inner + "/members");
  await alice.getByRole("button", { name: "Invite someone" }).click();
  await alice.getByPlaceholder("1111…").fill(carolFull!.trim());
  await alice.getByRole("button", { name: "Invite", exact: true }).click();
  await settle(alice);
  await open(carol, "#/");
  await expect(carol.getByText("You're invited to join")).toBeVisible();
  await carol.locator(".callout", { hasText: "Inner circle" }).getByRole("button", { name: "Join group" }).click();
  await settle(carol);
  await open(carol, inner + "/members");
  await expect(carol.getByRole("heading", { name: "2 members" })).toBeVisible();
});
