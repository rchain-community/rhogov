// redteam.probe.spec.ts — the red-team probes that need a live node.
//
// EXPECTED RED. Each probe asserts the behaviour a competent user needs and fails until the
// finding it names (RT-nnn, docs/audit/register-redteam.md) is fixed. A red here is a finding,
// not a broken test.   npm run test:redteam
//
// One throwaway community, installed this run by a key from tests/e2e/helpers.ts:KEYS. No link
// from outside the session is opened and no third-party community is touched.
//
// Declaration order matters and is deliberate: RP6 kills this page's API routes, so it runs last.
import { expect, test, type Dialog, type Page } from "@playwright/test";
import {
  coldStart, firstGroupAndVote, joinGroup, onboard, open, person, reviewDialog, settle, visibleText,
} from "../helpers-redteam";

test.describe("red team, live", () => {
  let page: Page;
  let invite = "";
  let groupHash = "";
  let voteHash = "";

  test.beforeAll(async ({ browser }) => {
    page = await person(browser, "redteam");
    invite = await coldStart(page, "Alice");
    ({ groupHash, voteHash } = await firstGroupAndVote(page, "First group"));
    // A second person, so the roll control exists (it needs members who are not on the roll).
    const bob = await person(browser, "second-person");
    await onboard(bob, "Bob", invite);
    await joinGroup(bob, groupHash);
    await bob.context().close();
  });
  test.afterAll(async () => { await page.context().close(); });

  // Scenario T7 — review-before-sign, kept for 2 of ~25 writes. Rung RC.
  test("RP1 — with review on, casting a vote shows the exact term [RT-07]", async () => {
    await open(page, "#/account");
    await page.getByRole("checkbox", { name: /exact rholang/i }).check();

    await open(page, voteHash);
    await page.locator("label.choice", { hasText: "Yes" }).click();
    await page.getByRole("button", { name: "Vote", exact: true }).click();

    // act() gates the modal on `reviewBeforeSign && opts.preview` (src/ui/kit.tsx:175-178), and
    // only Create group / Join group pass a preview. Casting a vote does not, even though the
    // setting says "each action" and the guide says "precisely what you're signing each time".
    await expect(reviewDialog(page), "the setting promises every action, not two of them")
      .toBeVisible({ timeout: 15_000 });

    // Only reached once the finding is fixed: close the dialog so later probes are not blocked.
    if (await reviewDialog(page).count()) {
      await reviewDialog(page).getByRole("button", { name: "Cancel" }).click();
      await expect(reviewDialog(page)).toHaveCount(0);
    }
  });

  // Scenario T2 — changing the electorate after ballots exist. Rungs RD and RB.
  test("RP3 — changing the roll after ballots exist asks first [RT-02]", async () => {
    await open(page, voteHash);
    let fired = false;
    const onDialog = async (d: Dialog) => { fired = true; await d.dismiss(); };
    page.on("dialog", onDialog);
    try {
      const roll = page.getByRole("button", { name: /new member.*to the vote/i }).first();
      await expect(roll, "the opener's roll control is present").toBeVisible();
      await roll.click();
      // Closing the vote confirms (src/ui/votes.tsx:111). Changing who may vote does not
      // (src/ui/votes.tsx:168) — and it sits beside the live "Standing so far" panel.
      await expect.poll(() => fired, { timeout: 10_000, message: "changing the electorate after ballots exist must confirm first" }).toBe(true);
    } finally {
      page.off("dialog", onDialog);
    }
  });

  // Scenario T6 — the frozen chain: silent staleness. Rungs RC and RA.
  test("RP6 — a failed re-read is visible instead of silently stale [RT-06]", async () => {
    await open(page, "#/");
    await visibleText(page); // let it load for real first

    // The chain goes away while the page keeps showing what it last saw.
    await page.route("**/api/**", (r) => r.abort());
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await settle(page).catch(() => { /* a refused read is the point */ });

    // useAsync keeps old data on error (src/ui/kit.tsx:41,44) and Loading shows the error only
    // when data is undefined (src/ui/kit.tsx:216-217). Nothing anywhere says how old this is.
    const text = await visibleText(page);
    expect(text, "a screen showing old data must say so when it cannot refresh")
      .toMatch(/last updated|last read|as of |stale|updating/i);
  });
});
