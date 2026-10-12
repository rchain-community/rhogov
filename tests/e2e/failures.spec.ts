// When the chain can't be read, or an invite is broken: say what and where, and
// always offer a way out (#15, #16).
import { expect, test } from "@playwright/test";
import { parseInvite } from "../../src/state";
import { APP, KEYS, NODE, onboard, open, person, startCommunity } from "./helpers";
import { seed } from "./helpers-audit";

test("a damaged invite offers ways forward in the page", async ({ browser }) => {
  const p = await person(browser, "Stranger");
  await p.goto(APP + "#/join?c=notbase64");
  await expect(p.getByRole("heading", { name: "This invite link is damaged" })).toBeVisible();
  await expect(p.locator("main").getByRole("link", { name: "Start your own community" })).toBeVisible();
  await expect(p.locator("main").getByRole("link", { name: "Read the user guide" })).toBeVisible();
  await p.locator("main").getByRole("link", { name: "Enter contract addresses by hand" }).click();
  await expect(p.getByRole("dialog", { name: "Use existing contracts" })).toBeVisible();
});

test("a community whose node moved can be pointed at its new address", async ({ browser }) => {
  // A real community, then the browser's record of its node goes stale.
  const alice = await person(browser, "Alice");
  await onboard(alice, "Alice");
  const c = parseInvite(await startCommunity(alice, `Moved ${Date.now()}`))!;
  const p = await person(browser, "Alice again");
  await seed(p, { key: KEYS.Alice, name: "Alice", communities: [{ ...c, node: "http://127.0.0.1:1" }], active: c.group });
  await open(p, "#/");
  const card = p.locator("main .callout.danger");
  await expect(card).toContainText(`Couldn't read the chain for ${c.name}`);
  await expect(card).toContainText("http://127.0.0.1:1");
  await expect(card).toContainText("isn't answering");
  await card.getByRole("button", { name: "Change network address" }).click();
  const dlg = p.getByRole("dialog");
  await dlg.locator("input").fill(NODE);
  await dlg.getByRole("button", { name: "Check" }).click();
  await expect(dlg.getByText("contracts answer there")).toBeVisible();
  await dlg.getByRole("button", { name: "Use this address" }).click();
  await expect(p.getByRole("heading", { name: /^Hello/ })).toBeVisible();
  await expect(p.locator("main .callout.danger")).toHaveCount(0);
});

test("a community whose contracts are gone can be forgotten, with no way to fake a move", async ({ browser }) => {
  const p = await person(browser, "Carol");
  const ghost = { name: "Ghost council", node: NODE, inbox: "rho:id:zzzzzzzz", group: "rho:id:zzzzzzzz", issue: "rho:id:zzzzzzzz" };
  await seed(p, { key: KEYS.Carol, name: "Carol", communities: [ghost], active: ghost.group });
  await open(p, "#/");
  const card = p.locator("main .callout.danger");
  await expect(card).toContainText("Couldn't read the chain for Ghost council");
  // Moving it to the same network can't help: the contracts aren't there.
  await card.getByRole("button", { name: "Change network address" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Check" }).click();
  await expect(p.getByRole("dialog").getByText("don't answer there")).toBeVisible();
  await expect(p.getByRole("dialog").getByRole("button", { name: "Use this address" })).toBeDisabled();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  p.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "Forget Ghost council" }).click();
  await expect(p.getByRole("heading", { name: "Welcome to rhogov" })).toBeVisible();
});
