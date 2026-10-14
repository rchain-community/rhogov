// Member onboarding: someone asks to join an invite-only stakeholder group, shows
// as pending, and the facilitator approves them in one step: invited into the
// group, trusted there, and added to the open votes. They then join with one click.
import { expect, test } from "@playwright/test";
import { onboard, open, person, settle, startCommunity } from "./helpers";

test("a request to join is approved in one step", async ({ browser }) => {
  const alice = await person(browser, "Alice");
  await onboard(alice, "Alice");
  const invite = await startCommunity(alice, "Validator Guild");
  await settle(alice);

  await open(alice, "#/councils");
  await alice.getByRole("button", { name: "＋ New council" }).click();
  await alice.getByPlaceholder("e.g. Protocol upgrade council").fill("Upgrade council");
  await alice.getByPlaceholder("e.g. Decide which protocol upgrades").fill("Schedule upgrades.");
  await alice.getByRole("button", { name: "Create council" }).click();
  await settle(alice);
  const council = await alice.evaluate(() => location.hash);

  // Bob belongs with Users (open) and Validators (invite-only): he joins one and asks for the other, in one deploy.
  const bob = await person(browser, "Bob");
  await onboard(bob, "Bob", invite);
  await settle(bob);
  await open(bob, council + "/stakeholders");
  await expect(bob.locator(".card", { hasText: "Validators" })).toContainText("ask to join");
  await bob.locator(".card", { hasText: "Users" }).getByText("I belong here").click();
  await bob.locator(".card", { hasText: "Validators" }).getByText("I belong here (ask to join)").click();
  await bob.getByRole("button", { name: "Join 1 group and Ask to join 1" }).click();
  await settle(bob);
  await open(bob, council + "/stakeholders");
  await expect(bob.locator(".card", { hasText: "Validators" }).getByText("Asked · pending approval")).toBeVisible();
  await open(bob, council);
  await expect(bob.getByText("You asked to join Validators")).toBeVisible();

  // The facilitator is prompted on Home, and sees Bob as pending on the council.
  await open(alice, "#/");
  await expect(alice.getByText("1 person is asking to join Upgrade council")).toBeVisible();
  await alice.getByRole("button", { name: "Review" }).click();
  const row = alice.locator(".card", { hasText: "Waiting to take part" }).locator(".row", { hasText: "Bob" });
  await expect(row).toContainText("asking to join Validators");
  await expect(row.getByText("Pending approval")).toBeVisible();

  // One step: invite to Validators, trust him there, add him to the voting-power estimates.
  await row.getByRole("button", { name: "Approve…" }).click();
  const modal = alice.locator(".modal");
  await expect(modal.locator("label.choice", { hasText: "Validators" }).locator("input")).toBeChecked();
  await modal.locator("select").selectOption("3");
  await expect(modal.getByText("Add them to the voting-power estimates too")).toBeVisible();
  await modal.getByRole("button", { name: "Approve", exact: true }).click();
  await settle(alice);
  await open(alice, council);
  await expect(alice.getByText("Waiting to take part")).toHaveCount(0);
  await expect(alice.getByText("is asking to join")).toHaveCount(0);

  // Bob joins with one click, and is a trusted Validator who can estimate.
  await open(bob, council);
  await expect(bob.getByText("You're approved for Validators")).toBeVisible();
  await bob.getByRole("button", { name: "Join", exact: true }).click();
  await settle(bob);
  await open(bob, council + "/stakeholders");
  await expect(bob.locator(".card", { hasText: "Validators" }).getByText("You're a member")).toBeVisible();
  await open(bob, council + "/power");
  await expect(bob.getByRole("button", { name: "Submit estimate" })).toBeVisible();
  const validators = council.replace("#/c/", "#/g/") + ".validators/members";
  await open(alice, validators);
  await expect(alice.locator(".item", { hasText: "Bob" })).toContainText("Solid");

  // A plain invite-only group works the same way, from its Members tab.
  await open(alice, "#/groups");
  await alice.getByRole("button", { name: "＋ New group" }).click();
  await alice.getByPlaceholder("e.g. Budget committee").fill("Treasury");
  await alice.getByText("Invite only", { exact: true }).click();
  await alice.getByRole("button", { name: "Create group" }).click();
  await settle(alice);
  const treasury = await alice.evaluate(() => location.hash);
  await open(bob, treasury);
  await bob.getByRole("button", { name: "Ask to join" }).click();
  await settle(bob);
  await open(bob, treasury);
  await expect(bob.getByText("You asked to join · waiting for an admin to approve")).toBeVisible();
  await open(alice, treasury + "/members");
  const asking = alice.locator(".card", { hasText: "Asking to join (1)" });
  await expect(asking.getByText("Pending approval")).toBeVisible();
  await asking.getByRole("button", { name: "Approve…" }).click();
  await alice.locator(".modal").getByRole("button", { name: "Approve", exact: true }).click();
  await settle(alice);
  await open(bob, "#/");
  await expect(bob.getByText("You're invited to join Treasury")).toBeVisible();
  await bob.getByRole("button", { name: "Join group" }).click();
  await settle(bob);
  await open(alice, treasury + "/members");
  await expect(alice.getByText("Asking to join")).toHaveCount(0);
  await expect(alice.locator(".item", { hasText: "Bob" })).toBeVisible();
});
