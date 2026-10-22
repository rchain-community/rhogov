// helpers-audit.ts — shared helpers for the cold-start UX audit probes.
//
// Re-exports the existing harness verbatim (tests/e2e/helpers.ts) so the probes
// behave exactly like the rest of the suite, and adds only what the audit needs.
//
// The ONE permitted fixture is browser state: rhogov:* keys in localStorage, so a
// probe can stand in a returning user's shoes. Governance data must be real — every
// community a probe touches is installed on chain by a real deploy, never mocked.
import { expect, type Page } from "@playwright/test";
import { APP, KEYS, NODE, open, onboard, person, settle, startCommunity } from "./helpers";

export { APP, KEYS, NODE, open, onboard, person, settle, startCommunity };

/** The community an invite link carries (see src/chain/gov.ts). */
export interface Invite { name: string; node: string; inbox: string; group: string; issue: string }

export function decodeInvite(invite: string): Invite {
  const m = /[?&]c=([A-Za-z0-9_-]+)/.exec(invite);
  if (!m) throw new Error(`no invite in ${invite}`);
  const json = Buffer.from(m[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return JSON.parse(json) as Invite;
}

export interface Seed {
  key?: string | null;
  name?: string;
  communities?: Invite[];
  active?: string | null;
  setupNode?: string;
  /** Full localStorage keys → JSON values, e.g. a rhogov:membership:* snapshot. */
  membership?: Record<string, unknown>;
}

/**
 * Write rhogov:* browser state before the app loads. The only sanctioned fixture.
 * Note setupNode is stored RAW: setup.tsx reads and writes it with a bare
 * localStorage.getItem/setItem, unlike the JSON helper every other key uses.
 */
export async function seed(page: Page, s: Seed) {
  await page.addInitScript((v: Seed) => {
    const put = (k: string, val: unknown) => localStorage.setItem(k, JSON.stringify(val));
    if (v.key !== undefined) (v.key === null ? localStorage.removeItem("rhogov:key") : put("rhogov:key", v.key));
    if (v.name !== undefined) put("rhogov:name", v.name);
    if (v.communities !== undefined) put("rhogov:communities", v.communities);
    if (v.active !== undefined) (v.active === null ? localStorage.removeItem("rhogov:active") : put("rhogov:active", v.active));
    if (v.setupNode !== undefined) localStorage.setItem("rhogov:setupNode", v.setupNode);
    if (v.membership) for (const [k, value] of Object.entries(v.membership)) put(k, value);
  }, s);
}

/** How many communities this browser holds — for the "known invite" guard. */
export async function lsCommunities(page: Page): Promise<Invite[]> {
  return (await page.evaluate(() => JSON.parse(localStorage.getItem("rhogov:communities") ?? "[]"))) as Invite[];
}

/**
 * The S2 cold-start: a real key, a real community, and nothing in it. Returns the
 * community's invite link so callers can reuse the community afterwards.
 */
export async function coldStart(page: Page, name = "Alice"): Promise<string> {
  await onboard(page, name, undefined, KEYS[name]);
  const invite = await startCommunity(page, `Audit ${name} ${Date.now()}`);
  await open(page, "#/");
  return invite;
}

/**
 * Create the first group and the first vote, the way a newcomer actually would.
 * Returns the hashes that reach them.
 */
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

/**
 * The text a first-time user actually reads: everything inside <main> except the
 * mechanism words tucked inside collapsed "How does this work?" expanders. That
 * exclusion encodes a product decision — jargon belongs in Info, not on a first
 * visit. textContent (not innerText) so it does not depend on layout.
 *
 * Waits for the chain read first: while a screen is loading, main contains only
 * "Reading the chain…", and reading then is a race (see the note in the body).
 */
export async function visibleText(page: Page): Promise<string> {
  // The screen reads the chain on mount; until it finishes, main shows only
  // "Reading the chain…". Reading then is a race — a spurious PASS for a
  // "must not contain X" assertion, and a spurious FAIL for a "must contain X" one.
  await expect(page.locator("main")).not.toContainText("Reading the chain…", { timeout: 90_000 });
  return page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return "";
    const clone = main.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("details:not([open])").forEach((d) => d.remove());
    return clone.textContent ?? "";
  });
}

/** Words that assume knowledge the cold-start user does not have. */
const JARGON = /\bcensure|withdraw censure|facilitator|\broll\b|\bphlo\b|rho:gov:/gi;

export function jargonHits(text: string): string[] {
  return [...new Set((text.match(JARGON) ?? []).map((s) => s.toLowerCase()))];
}
