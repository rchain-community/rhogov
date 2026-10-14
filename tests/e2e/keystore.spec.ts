// A key saved as a password-protected keystore file comes back from that file (#86).
// Needs no node: every request to one is refused, and the key's name lookup gives up.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { APP, KEYS } from "./helpers";

const ALICE = "1111bn92xHbttqWHEXqD8PiykFxgeUjizzquT6JRePj2pAoHFAuiK";

test("save the key as a keystore file, then bring it back from the file", async ({ page }) => {
  await page.route(/^https?:/, (r) => r.abort());
  await page.goto(APP);
  // A key and a community already in this browser, as after setup (the contracts are never read).
  await page.evaluate((k) => {
    localStorage.setItem("rhogov:key", JSON.stringify(k));
    localStorage.setItem("rhogov:communities", JSON.stringify([{ name: "Test", node: "http://127.0.0.1:9", inbox: "rho:id:a", group: "rho:id:b", issue: "rho:id:c" }]));
  }, KEYS.Alice);
  await page.goto(APP + "#/account");
  await page.reload();
  await expect(page.getByText(ALICE, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Save keystore file" }).click();
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByLabel("Password again").fill("correct horse battery");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file" }).click();
  const file = await (await download).path();
  expect((await download).suggestedFilename()).toMatch(/^UTC--.+--[0-9a-f]{40}\.json$/);
  const text = readFileSync(file, "utf8");
  expect(text).not.toContain(KEYS.Alice);
  expect(JSON.parse(text).crypto.kdf).toBe("scrypt");

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Remove from this browser" }).click();
  // The community is still chosen, so setup asks only for the name and key.
  await page.getByPlaceholder("e.g. Ada").fill("Alice");
  await page.getByRole("button", { name: "I have a key" }).click();
  await page.getByLabel("Or a keystore file").setInputFiles(file);
  await page.getByLabel("Keystore password").fill("wrong password");
  await page.getByRole("button", { name: "Open keystore" }).click();
  await expect(page.getByText("Wrong password for this keystore file.")).toBeVisible();
  await page.getByLabel("Keystore password").fill("correct horse battery");
  await page.getByRole("button", { name: "Open keystore" }).click();
  await expect(page.getByText(`Address: ${ALICE}`)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.goto(APP + "#/account");
  await expect(page.getByText(ALICE, { exact: true })).toBeVisible();
});
