// helpers-redteam.ts — helpers for the adversarial red-team probes.
//
// Self-contained by design: this branch is based on `main`, where the cold-start audit's
// harness (helpers-audit.ts, the testIgnore entry, docs/audit/) does not exist yet. It
// re-exports the pre-existing tests/e2e/helpers.ts verbatim and adds what the red-team
// probes need. When the cold-start PR merges, this module can be folded into helpers-audit.ts.
//
// The ONE permitted fixture is browser state (rhogov:* in localStorage). Every community a
// probe touches is installed by a real key from helpers.ts:KEYS, this run.
import { expect, type Browser, type Page } from "@playwright/test";
import { generateKey, revAddressOf } from "../../src/chain/keys";
import { RNode } from "../../src/chain/node";
import { APP, KEYS, NODE, open, onboard, person, settle, startCommunity } from "./helpers";

export { APP, KEYS, NODE, open, onboard, person, settle, startCommunity };

/** The community an invite link carries (src/chain/gov.ts:31-38). */
export interface Invite { name: string; node: string; inbox: string; group: string; issue: string }

/**
 * Encode a community into an invite link, the way the app does (src/state.ts:95-98).
 * Implemented here rather than imported because the app's version reads `location`, which
 * a Node test process has no access to.
 */
export function makeInvite(c: Invite): string {
  const b64 = Buffer.from(JSON.stringify(c), "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${APP}#/join?c=${b64}`;
}

export function decodeInvite(invite: string): Invite {
  const m = /[?&]c=([A-Za-z0-9_-]+)/.exec(invite);
  if (!m) throw new Error(`no invite in ${invite}`);
  const json = Buffer.from(m[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return JSON.parse(json) as Invite;
}

/**
 * Rewrite fields of an invite — the red team's forwarding-a-link tool (scenario T1).
 * A hostile sender changes the `node`, and the victim signs to whatever host it names.
 */
export function forgeInvite(invite: string, patch: Partial<Invite>): Invite {
  return { ...decodeInvite(invite), ...patch };
}

export interface Seed {
  key?: string | null;
  name?: string;
  communities?: Invite[];
  active?: string | null;
  setupNode?: string;
  /** Enable "Show me the exact rholang before I sign each action" (src/state.ts:19,112). */
  review?: boolean;
}

/**
 * Write rhogov:* browser state before the app loads. `setupNode` is stored RAW — the app
 * reads and writes it with a bare get/setItem (src/ui/setup.tsx:14-15), unlike every other
 * key, which goes through the JSON helper in src/state.ts.
 */
export async function seed(page: Page, s: Seed) {
  await page.addInitScript((v: Seed) => {
    const put = (k: string, val: unknown) => localStorage.setItem(k, JSON.stringify(val));
    if (v.key !== undefined) (v.key === null ? localStorage.removeItem("rhogov:key") : put("rhogov:key", v.key));
    if (v.name !== undefined) put("rhogov:name", v.name);
    if (v.communities !== undefined) put("rhogov:communities", v.communities);
    if (v.active !== undefined) (v.active === null ? localStorage.removeItem("rhogov:active") : put("rhogov:active", v.active));
    if (v.setupNode !== undefined) localStorage.setItem("rhogov:setupNode", v.setupNode);
    if (v.review !== undefined) put("rhogov:review", v.review);
  }, s);
}

export async function lsCommunities(page: Page): Promise<Invite[]> {
  return (await page.evaluate(() => JSON.parse(localStorage.getItem("rhogov:communities") ?? "[]"))) as Invite[];
}

/** A real key, a real community, nothing in it. Returns the community's invite link. */
export async function coldStart(page: Page, name = "Alice"): Promise<string> {
  await onboard(page, name, undefined, KEYS[name]);
  const invite = await startCommunity(page, `Redteam ${name} ${Date.now()}`);
  await open(page, "#/");
  return invite;
}

/** Create the first group and the first vote. Returns the hashes that reach them. */
export async function firstGroupAndVote(page: Page, groupName = "First group") {
  await open(page, "#/groups");
  await page.getByRole("button", { name: "＋ New group" }).click();
  await page.getByPlaceholder("e.g. Budget committee").fill(groupName);
  await page.getByRole("button", { name: "Create group" }).click();
  await settle(page);
  const groupHash = await page.evaluate(() => location.hash);
  await page.getByRole("button", { name: "＋ New vote" }).click();
  await page.getByPlaceholder("e.g. Which venue for the spring meetup?").fill("Does it work?");
  await page.getByPlaceholder("Option 1").fill("Yes");
  await page.getByPlaceholder("Option 2").fill("No");
  await page.getByRole("button", { name: "Open vote" }).click();
  await settle(page);
  const voteHash = await page.evaluate(() => location.hash);
  return { groupHash, voteHash };
}

/** Join an open group from its page, as a second person would. */
export async function joinGroup(page: Page, groupHash: string) {
  await open(page, groupHash);
  await page.getByRole("button", { name: "Join group" }).first().click();
  await settle(page);
}

/**
 * A fresh, faucet-funded key — a second or third member the red team can spend.
 * Needs a dev node with a faucet, which is rate-limited: budget a few per run.
 */
export async function sockpuppet(): Promise<string> {
  const key = generateKey(), node = new RNode(NODE);
  await node.faucet(revAddressOf(key));
  await expect.poll(async () => (await node.balance(revAddressOf(key))) ?? 0, { timeout: 120_000 }).toBeGreaterThan(0);
  return key;
}

/**
 * The text a user actually reads: everything in <main> except the mechanism words tucked in
 * collapsed "How does this work?" expanders. Waits for the chain read first — while a screen
 * loads, main contains only "Reading the chain…", and reading then is a race.
 */
export async function visibleText(page: Page): Promise<string> {
  await expect(page.locator("main")).not.toContainText("Reading the chain…", { timeout: 90_000 });
  return page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return "";
    const clone = main.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("details:not([open])").forEach((d) => d.remove());
    return clone.textContent ?? "";
  });
}

/** The review-before-sign dialog (src/ui/kit.tsx:157-168), titled "Sign: <action>". */
export const reviewDialog = (page: Page) => page.getByRole("dialog", { name: /^Sign:/ });

/** A page that keeps every `pageerror`, so a probe can report it rather than throw blind. */
export async function watcher(browser: Browser, name: string): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  return { page, errors };
}
