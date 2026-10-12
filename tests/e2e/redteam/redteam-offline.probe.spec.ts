// redteam-offline.probe.spec.ts — the red-team probes that need NO node.
//
// EXPECTED RED. Each probe asserts the behaviour a competent user needs and fails until the
// finding it names (RT-nnn, docs/audit/register-redteam.md) is fixed. A red here is a finding,
// not a broken test.   npm run test:redteam
//
// No community is installed and no third-party link is opened: these read the app's own copy
// and its handling of a forged invite link.
import { expect, test } from "@playwright/test";
import { APP, NODE, forgeInvite, makeInvite, visibleText } from "../helpers-redteam";

// Scenario T1 — a hostile node named by a forwarded invite link. Rungs RA and RC.
// The attacker's only move is to change the `node` field and forward the link.
const base = { name: "Seed Co-op", node: NODE, inbox: "rho:id:aaaa", group: "rho:id:bbbb", issue: "rho:id:cccc" };
const ATTACKER = "https://node.attacker.example";

test("RP2 — a foreign node in an invite is named as unchosen before anything is signed [RT-01]", async ({ browser }) => {
  const p = await (await browser.newContext()).newPage();
  const link = makeInvite(forgeInvite(makeInvite(base), { node: ATTACKER }));

  await p.goto(link);

  // The host IS shown — but as `small muted` (src/ui/settings.tsx:147), so document that the
  // probe is not merely looking for a missing string.
  await expect(p.locator("main"), "the invite's host is displayed").toContainText(ATTACKER);

  // What is missing: any warning that this is not a network the user chose. parseInvite accepts
  // any http(s) host (src/state.ts:105-106), and the app then POSTs signed deploys to it.
  await expect(
    p.locator("main").getByText(/not one of|isn't one of|unknown network|didn't choose|did not choose|unrecognised|unrecognized|only join a network you/i).first(),
    "an invite naming an unchosen node must say so prominently, before a signature",
  ).toBeVisible();
});

// Scenario T12 — the inbox that is neither private nor name-stamped. Rungs RA and RC.
test("RP8 — the welcome screen does not promise 'private inboxes' [RT-12]", async ({ browser }) => {
  const p = await (await browser.newContext()).newPage();
  await p.goto(APP);
  const text = await visibleText(p);
  // Message bodies sit plaintext in chain state until collected (src/ui/inbox.tsx:63 says so).
  // The headline does not: src/ui/setup.tsx:225 says "private inboxes — all on chain".
  expect(text, "the headline must not claim privacy the chain does not provide")
    .not.toMatch(/private inboxes/i);
});
