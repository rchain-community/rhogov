// A network restarted from a new genesis (#89): rhogov says so, keeps what the
// browser held from the old chain apart, and carries your identity over.
import { expect, test } from "@playwright/test";
import { APP, KEYS, NODE, person, settle, startCommunity } from "./helpers";

const ALICE = "1111bn92xHbttqWHEXqD8PiykFxgeUjizzquT6JRePj2pAoHFAuiK";

test("a reset network: keep my identity, start again, and the old community is kept apart", async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await person(browser, "Alice");
  await page.goto(APP);
  // The chain this browser knew at the node, a community stamped with it, and one
  // remembered from before #89 (no chain). Neither's contracts are on the chain the node runs now.
  const old = "00".repeat(32);
  await page.evaluate(([k, node, old]) => {
    localStorage.setItem("rhogov:key", JSON.stringify(k));
    localStorage.setItem("rhogov:name", JSON.stringify("Alice"));
    localStorage.setItem("rhogov:setupNode", node);
    localStorage.setItem("rhogov:genesis", JSON.stringify({ [node]: old }));
    localStorage.setItem("rhogov:communities", JSON.stringify([
      { name: "Old Coop", node, chain: old, inbox: "rho:id:aaaa", group: "rho:id:bbbb", issue: "rho:id:cccc" },
      { name: "Older Coop", node, inbox: "rho:id:dddd", group: "rho:id:eeee", issue: "rho:id:ffff" },
    ]));
  }, [KEYS.Alice, NODE, old]);
  await page.reload();

  await expect(page.getByRole("heading", { name: "This network was reset" })).toBeVisible();
  await expect(page.getByText(/every community, group, vote, delegation, trust rating, censure, decision/)).toBeVisible();
  await expect(page.getByText(/Old Coop, Older Coop were on the old chain/)).toBeVisible();
  await page.getByRole("button", { name: "Keep my identity" }).click();

  // Straight to joining or starting a community on the new chain, as the same person.
  await expect(page.getByText("Join or start a community")).toBeVisible();
  await expect(page.getByText("Alice", { exact: true })).toBeVisible();
  await startCommunity(page, "New Coop");
  await expect(page.getByRole("heading", { name: "Earlier chains" })).toBeVisible();
  const earlier = page.locator(".card", { has: page.getByRole("heading", { name: "Earlier chains" }) });
  await expect(earlier.getByText("Old Coop", { exact: true })).toBeVisible();
  await expect(earlier.getByText("Older Coop", { exact: true })).toBeVisible();
  await page.goto(APP + "#/account");
  await expect(page.getByText(ALICE, { exact: true })).toBeVisible();
  await expect(page.getByText(/same key is your identity on every network/)).toBeVisible();

  // Reloading doesn't ask again: the new chain is the one this browser knows now.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "This network was reset" })).toHaveCount(0);
  await settle(page);
});

test("a reset network: use a new key there only", async ({ browser }) => {
  const page = await person(browser, "Alice");
  await page.goto(APP);
  // As left by rhogov since #89: the chain this browser knew at the node, and a community on it.
  const old = "00".repeat(32);
  await page.evaluate(([k, node, old]) => {
    localStorage.setItem("rhogov:key", JSON.stringify(k));
    localStorage.setItem("rhogov:name", JSON.stringify("Alice"));
    localStorage.setItem("rhogov:genesis", JSON.stringify({ [node]: old }));
    localStorage.setItem("rhogov:communities", JSON.stringify([{ name: "Old Coop", node, chain: old, inbox: "rho:id:aaaa", group: "rho:id:bbbb", issue: "rho:id:cccc" }]));
  }, [KEYS.Alice, NODE, old]);
  await page.reload();

  await expect(page.getByRole("heading", { name: "This network was reset" })).toBeVisible();
  await page.getByRole("button", { name: "Use a new key on this network" }).click();
  await page.getByPlaceholder("e.g. Ada").fill("Bob");
  await page.getByRole("button", { name: "I have a key" }).click();
  await page.getByPlaceholder("0b60b3ff…").fill(KEYS.Bob);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Join or start a community")).toBeVisible();
  await expect(page.getByText("Bob", { exact: true })).toBeVisible();
  await expect(page.getByText(ALICE)).toHaveCount(0);
});
