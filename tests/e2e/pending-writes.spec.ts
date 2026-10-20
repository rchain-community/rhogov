// A signed write that may still land is remembered across a reload, is not
// started again, and can be looked up from Account (#65's reload half).
import { expect, test } from "@playwright/test";
import { APP, onboard, open, person, settle, startCommunity } from "./helpers";

test("a write still unknown is remembered across a reload, not repeated, and checked from Account", async ({ browser }) => {
  const alice = await person(browser, "Alice");
  await onboard(alice, "Alice");
  await startCommunity(alice, `Pending ${Date.now()}`);
  await settle(alice);

  await open(alice, "#/groups");
  await alice.getByRole("button", { name: "＋ New group" }).click();
  await alice.getByPlaceholder("e.g. Budget committee").fill("Stalled club");
  await alice.getByRole("button", { name: "Create group" }).click();
  await settle(alice);
  const groupHash = (await alice.evaluate(() => location.hash)).replace(/\/?$/, "") + "/about";
  await open(alice, groupHash);
  alice.on("dialog", (d) => d.accept());

  // The node takes the deploy, but no status read ever finds it in a block.
  await alice.route("**/api/deploy", (route) => route.fulfill({ status: 200, body: "Success" }));
  await alice.route("**/api/v1/deploy-status/*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ NotProcessed: { status: "Block not yet available" } }),
  }));
  await alice.clock.install();
  await alice.getByRole("button", { name: "Leave group" }).click();
  await expect(alice.getByText("Signed and sent. Waiting for a block…")).toBeVisible();
  await alice.clock.fastForward(15 * 60_000 + 1_000);
  await expect(alice.getByText(/Don't repeat it yet/)).toBeVisible();

  // After a reload, the same action is refused, and nothing new is sent.
  let deploys = 0;
  await alice.unroute("**/api/deploy");
  await alice.route("**/api/deploy", async (route) => { deploys++; await route.fulfill({ status: 200, body: "Success" }); });
  await open(alice, groupHash);
  await alice.getByRole("button", { name: "Leave group" }).click();
  await expect(alice.getByText("Not repeated: Leaving Stalled club")).toBeVisible();
  expect(deploys, "no second deploy").toBe(0);
  await alice.locator(".toast button[aria-label=Dismiss]").evaluateAll((bs) => bs.forEach((b) => (b as HTMLElement).click()));

  // Account lists it; checking it while it's still out says so and keeps it.
  await alice.goto(APP + "#/account");
  await expect(alice.getByRole("heading", { name: "Waiting to hear about" })).toBeVisible();
  await expect(alice.getByText("Leaving Stalled club", { exact: true })).toBeVisible();
  await alice.getByRole("button", { name: "Check it" }).click();
  await expect(alice.getByText(/Not in a block yet/)).toBeVisible();

  // Once the node has an answer, checking says what happened and lets it go.
  await alice.unroute("**/api/v1/deploy-status/*");
  await alice.route("**/api/v1/deploy-status/*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ ProcessedWithError: { deployError: "deliberate test failure" } }),
  }));
  await alice.getByRole("button", { name: "Check it" }).click();
  await expect(alice.getByText("It failed: Leaving Stalled club")).toBeVisible();
  await expect(alice.getByText(/It ran in a block and failed/)).toBeVisible();
  await expect(alice.getByRole("heading", { name: "Waiting to hear about" })).toHaveCount(0);
});

test("when the browser can't keep a note of the signature, nothing is sent", async ({ browser }) => {
  const alice = await person(browser, "Alice");
  await onboard(alice, "Alice");
  await startCommunity(alice, `Refused ${Date.now()}`);
  await settle(alice);
  await open(alice, "#/groups");
  await alice.getByRole("button", { name: "＋ New group" }).click();
  await alice.getByPlaceholder("e.g. Budget committee").fill("Refused club");
  await alice.getByRole("button", { name: "Create group" }).click();
  await settle(alice);
  const groupHash = (await alice.evaluate(() => location.hash)).replace(/\/?$/, "") + "/about";
  alice.on("dialog", (d) => d.accept());

  // From here on, this browser refuses to store a pending-write record.
  await alice.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k.startsWith("rhogov:pending-write:")) throw new DOMException("quota", "QuotaExceededError");
      return set.call(this, k, v);
    };
  });
  await open(alice, groupHash);
  let deploys = 0;
  await alice.route("**/api/deploy", async (route) => { deploys++; await route.continue(); });
  await alice.getByRole("button", { name: "Leave group" }).click();
  await expect(alice.getByText(/couldn't keep a note of the signature, so nothing was sent/)).toBeVisible();
  expect(deploys, "nothing sent").toBe(0);
  await expect(alice.getByRole("button", { name: "Leave group" })).toBeVisible();
});

test("with review on, the exact rholang is shown, and Cancel signs nothing", async ({ browser }) => {
  const alice = await person(browser, "Alice");
  await onboard(alice, "Alice");
  await startCommunity(alice, `Review ${Date.now()}`);
  await settle(alice);
  await alice.goto(APP + "#/account");
  await alice.getByLabel("Show me the exact rholang before I sign each action").check();

  await open(alice, "#/groups");
  let deploys = 0;
  await alice.route("**/api/deploy", async (route) => { deploys++; await route.continue(); });
  await alice.getByRole("button", { name: "＋ New group" }).click();
  await alice.getByPlaceholder("e.g. Budget committee").fill("Reviewed club");
  await alice.getByRole("button", { name: "Create group" }).click();
  await expect(alice.getByText("Sign: Creating “Reviewed club”")).toBeVisible();
  await expect(alice.locator("pre.code")).toContainText("Reviewed club");
  await alice.getByRole("button", { name: "Cancel" }).click();
  await expect(alice.getByText("Sign: Creating “Reviewed club”")).toHaveCount(0);
  expect(deploys, "nothing signed").toBe(0);

  await alice.getByRole("button", { name: "＋ New group" }).click();
  await alice.getByPlaceholder("e.g. Budget committee").fill("Reviewed club");
  await alice.getByRole("button", { name: "Create group" }).click();
  await alice.getByRole("button", { name: "Sign and send" }).click();
  await settle(alice);
  await expect(alice.getByRole("heading", { name: "Reviewed club" })).toBeVisible();
  expect(deploys).toBe(1);
});
