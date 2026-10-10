import { type Browser, type Page, expect } from "@playwright/test";
import { resolve } from "node:path";

export const APP = "file://" + resolve("dist/index.html");
export const NODE = process.env.RHOGOV_NODE ?? "http://127.0.0.1:40403";

// Throwaway keys funded at genesis by quantum-os scripts/localnet/wallet.txt.
// Worthless anywhere else; never use them on a network that holds value.
export const KEYS: Record<string, string> = {
  Alice: "0b60b3ffcc43a607e037c3da3c1ed366261d742288abdf92d53cf80b9e3cf98f",
  Bob: "13487106542b1c1472c4af4bf29031ecbad42464a82e38b6f0e18a09bbf54f12",
  Carol: "babf57fd43a2c5b46596fa24f20e7f4b7892f66c5d0413f146cac2b9ce9ea902",
  Dave: "7707a3e05728428b7a2f4464169eeb3436ea5eda112a4c4a97685d2651bf9895",
};

export async function person(browser: Browser, name: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { throw new Error(`${name}: ${e.message}`); });
  return page;
}

/** Wait until no chain action is in flight; fail on any error toast. */
const T0 = Date.now();
export async function settle(page: Page) {
  const t = Date.now();
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !document.querySelector(".toast .spinner"), null, { timeout: 180_000 });
  const errors = await page.locator(".toast.error").allTextContents();
  expect(errors, "no error toasts").toEqual([]);
  console.log(`settle ${((Date.now() - t) / 1000).toFixed(1)}s @${((Date.now() - T0) / 1000).toFixed(0)}s`);
  await page.locator(".toast button[aria-label=Dismiss]").evaluateAll((bs) => bs.forEach((b) => (b as HTMLElement).click()));
}

/** Go to a route and re-read the chain (a same-hash goto would not). */
export async function open(page: Page, hash: string) {
  await page.goto(APP + hash);
  await page.reload();
}

export async function onboard(page: Page, name: string, invite?: string) {
  await page.goto(invite ? APP + invite.slice(invite.indexOf("#")) : APP);
  if (invite) await page.getByRole("button", { name: "Get started" }).click();
  if (!invite) {
    await page.getByRole("radio", { name: /Another node/ }).check();
    await page.getByPlaceholder("https://your-node:40403").fill(NODE);
    await page.getByRole("button", { name: "Use" }).click();
  }
  await expect(page.getByText("Connected")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByPlaceholder("e.g. Ada").fill(name);
  await page.getByRole("button", { name: "I have a key" }).click();
  await page.getByPlaceholder("0b60b3ff…").fill(KEYS[name]);
  await page.getByRole("button", { name: "Continue" }).click();
}

export async function startCommunity(page: Page, name: string): Promise<string> {
  await page.getByRole("button", { name: "Start a new community" }).click();
  await page.getByPlaceholder("e.g. RChain Cooperative").fill(name);
  await page.getByRole("button", { name: "Start community" }).click();
  await settle(page);
  await page.goto(APP + "#/community");
  return page.locator("input[readonly]").inputValue();
}

/** Does this chain have the genesis name directory? (The playground's genesis predates it.) */
