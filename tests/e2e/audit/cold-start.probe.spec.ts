// cold-start.probe.spec.ts — entry state S2: a real key, a real community, and
// nothing in it. Personas: the impatient clicker (P-B) and the non-crypto user (P-E).
//
// EXPECTED RED. Each probe below asserts the behaviour a first-time user needs and
// fails until the finding it names (CS-nnn, docs/audit/cold-start-protocol.md) is
// fixed. A red here is a finding, not a broken test.   npm run test:audit
import { expect, test, type Page } from "@playwright/test";
import { coldStart, firstGroupAndVote, jargonHits, onboard, open, person, settle, visibleText } from "../helpers-audit";

// NOT .serial: an audit must enumerate every finding, and serial mode aborts a file
// at the first failure. Declaration order is preserved (workers: 1), which is all the
// shared-state tests below need.
test.describe("cold start with an empty community (S2)", () => {
  let page: Page;
  let invite = "";
  let groupHash = "";
  let voteHash = "";

  test.beforeAll(async ({ browser }) => {
    page = await person(browser, "coldstart");
    invite = await coldStart(page, "Alice");
  });
  test.afterAll(async () => { await page.context().close(); });

  test("P1 — Home says what rhogov is for [CS-001]", async () => {
    await open(page, "#/");
    expect(await visibleText(page), "Home must state what the app is for, not only greet you")
      .toMatch(/decide things together|together on rchain|governance/i);
  });

  test("P2 — an empty community is not told it is caught up [CS-002]", async () => {
    await open(page, "#/");
    expect(await visibleText(page), "nothing has ever happened here; there is nothing to be caught up on")
      .not.toContain("You're all caught up");
  });

  test("P3 — the first-run call to action is the primary one [CS-003]", async () => {
    await open(page, "#/");
    const cta = page.getByRole("link", { name: /start the first|create your first|start a group/i }).first();
    await expect(cta, "an empty community must offer a way to start one").toBeVisible();
    const needs = page.getByRole("heading", { name: /needs your vote/i });
    const ctaBox = await cta.boundingBox();
    const needsBox = await needs.boundingBox();
    expect(ctaBox, "the call to action must be laid out").toBeTruthy();
    expect(ctaBox!.y, "the call to action must come before the “Needs your vote” section")
      .toBeLessThan(needsBox?.y ?? Number.POSITIVE_INFINITY);
  });

  test("setup — the first group and the first vote, as a newcomer makes them", async () => {
    ({ groupHash, voteHash } = await firstGroupAndVote(page, "First group"));
  });

  // A governance app with one member is degenerate: the Members tab only offers Rate
  // and Censure against *other* people (`member && !self`), and the vote's roll only
  // grows once someone joins late. So the census runs against a two-person community —
  // which is also the first moment the app is really a governance app.
  test("setup — a second person joins the community and the group", async ({ browser }) => {
    const bob = await person(browser, "second-person");
    await onboard(bob, "Bob", invite);
    await open(bob, groupHash);
    await bob.getByRole("button", { name: "Join group" }).first().click();
    await settle(bob);
    await bob.context().close();
  });

  test("P4 — no unglossed jargon on the cold-start screens [CS-004]", async () => {
    const routes = ["#/", "#/groups", groupHash, `${groupHash}/members`, voteHash];
    const offenders: Record<string, string[]> = {};
    for (const r of routes) {
      await open(page, r);
      const hits = jargonHits(await visibleText(page));
      if (hits.length) offenders[r] = hits;
    }
    expect(offenders, "mechanism words belong inside the “How does this work?” expander, not on a first visit")
      .toEqual({});
  });

  test("P5 — delegation is offered in plain words [CS-005]", async () => {
    await open(page, `${groupHash}/members`);
    const btn = page.getByRole("button", { name: /my vote/i }).first();
    await expect(btn).toHaveAccessibleName(/hand my vote|give my vote|pass my vote/i);
  });
});
