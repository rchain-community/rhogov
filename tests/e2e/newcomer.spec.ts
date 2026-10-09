// A newcomer with nothing: a fresh key, test REV from the node's faucet, then a
// community, a group and a vote. Needs a dev-mode node with a faucet (the
// playground is one):  RHOGOV_NODE=https://playground.rhobot.net npm run test:e2e -- newcomer
import { expect, test } from "@playwright/test";
import { APP, NODE, open, person, settle } from "./helpers";

test("a newcomer goes from nothing to a decision", async ({ browser }) => {
  const me = await person(browser, "Newcomer");
  await me.goto(APP);
  // The default network is the playground; pick NODE explicitly so the spec runs anywhere.
  await me.getByRole("radio", { name: /Another node/ }).check();
  await me.getByPlaceholder("https://your-node:40403").fill(NODE);
  await me.getByRole("button", { name: "Use" }).click();
  await expect(me.getByText("Connected")).toBeVisible();
  await expect(me.getByText("dev mode")).toBeVisible();
  await me.getByRole("button", { name: "Continue" }).click();
  await me.getByPlaceholder("e.g. Ada").fill("Newcomer");
  await me.getByRole("button", { name: "Continue" }).click(); // "Create a new key" is the default

  await expect(me.getByText("0 REV").first()).toBeVisible();
  // Unfunded, starting a community must be refused up front, saying why,
  // not attempted and failed by the node with no reason given.
  await me.getByRole("button", { name: "Start a new community" }).click();
  await me.getByPlaceholder("e.g. RChain Cooperative").fill("Too early");
  await expect(me.getByText("needs about 0.02 REV")).toBeVisible();
  await expect(me.getByRole("button", { name: "Start community" })).toBeDisabled();
  await me.getByRole("button", { name: "Get test REV" }).first().click();
  await expect(me.getByText("Test REV requested")).toBeVisible();
  // The balance re-reads itself after a faucet request; the button enables when it lands.
  await expect(me.getByRole("button", { name: "Start community" })).toBeEnabled({ timeout: 120_000 });
  await me.getByPlaceholder("e.g. RChain Cooperative").fill(`Newcomer test ${Date.now()}`);
  await me.getByRole("button", { name: "Start community" }).click();
  await settle(me);

  await open(me, "#/groups");
  await me.getByRole("button", { name: "＋ New group" }).click();
  await me.getByPlaceholder("e.g. Budget committee").fill("First group");
  await me.getByRole("button", { name: "Create group" }).click();
  await settle(me);
  await me.getByRole("button", { name: "＋ New vote" }).click();
  await me.getByPlaceholder("e.g. Which venue for the spring meetup?").fill("Does it work?");
  await me.getByPlaceholder("Option 1").fill("Yes");
  await me.getByPlaceholder("Option 2").fill("No");
  await me.getByRole("button", { name: "Open vote" }).click();
  await settle(me);
  await open(me, await me.evaluate(() => location.hash));
  await me.locator("label.choice", { hasText: "Yes" }).click();
  await me.getByRole("button", { name: "Vote", exact: true }).click();
  await settle(me);
  await open(me, await me.evaluate(() => location.hash));
  await expect(me.getByText("Leading: Yes")).toBeVisible();
});
