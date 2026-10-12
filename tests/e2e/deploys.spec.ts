// #39: never invite a repeat that could happen twice.
import { expect, test } from "@playwright/test";
import { APP, onboard, person, settle } from "./helpers";

test("a deploy the node refuses without a reason, but carried anyway, is found and finished", async ({ browser }) => {
  const alice = await person(browser, "Alice");
  await onboard(alice, "Alice");
  // The node carries the deploy but answers with its reasonless refusal.
  await alice.route("**/api/deploy", async (route) => {
    await route.fetch();
    await route.fulfill({ status: 400, body: "deploy error message not available in cache or deploy executed on another node" });
  });
  await alice.getByRole("button", { name: "Start a new community" }).click();
  await alice.getByPlaceholder("e.g. RChain Cooperative").fill(`Carried ${Date.now()}`);
  await alice.getByRole("button", { name: "Start community" }).click();
  await expect(alice.getByText("Three contracts installed")).toBeVisible({ timeout: 150_000 });
  await expect(alice.getByText(/try again/i)).toHaveCount(0);
});

test("an install that never confirmed is looked for, not installed again", async ({ browser }) => {
  const alice = await person(browser, "Alice");
  await onboard(alice, "Alice");
  const name = `Resumed ${Date.now()}`;
  await alice.getByRole("button", { name: "Start a new community" }).click();
  await alice.getByPlaceholder("e.g. RChain Cooperative").fill(name);
  // Close the page as soon as the deploy is sent: it may land later, unseen.
  const sent = alice.waitForResponse("**/api/deploy");
  await alice.getByRole("button", { name: "Start community" }).click();
  await sent;
  await alice.goto(APP + "#/welcome");
  await alice.reload();
  // Back on setup, it offers to look for that one instead of installing another.
  await alice.getByRole("button", { name: "Start a new community" }).click();
  await expect(alice.getByText(`You started ${name} earlier`)).toBeVisible();
  let installs = 0;
  await alice.route("**/api/deploy", async (route) => { installs++; await route.continue(); });
  await alice.getByRole("button", { name: `Look for “${name}”` }).click();
  await settle(alice);
  await expect(alice.getByText(name).first()).toBeVisible();
  expect(installs, "no second install").toBe(0);
});
