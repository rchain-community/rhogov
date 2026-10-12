// returning.probe.spec.ts — the user who comes back later: a key in this browser,
// and a community whose node is no longer there. Persona: P-D.
//
// P11 is EXPECTED RED. S4 (a keyed user with no community) is recorded as a
// NO FINDING: the wizard resumes at the community step, which is correct — see
// guard G5 in cold-start.guard.spec.ts.   npm run test:audit
import { expect, test } from "@playwright/test";
import { KEYS, open, person, seed, type Invite } from "../helpers-audit";

test("P11 — an unreachable node is explained and escapable [CS-008]", async ({ browser }) => {
  const p = await person(browser, "unreachable");
  const c: Invite = { name: "Far away", node: "http://127.0.0.1:1", inbox: "rho:id:aaaa", group: "rho:id:aaaa", issue: "rho:id:aaaa" };
  await seed(p, { key: KEYS.Carol, name: "Carol", communities: [c], active: c.group });
  await open(p, "#/");
  await expect(p.locator("main").getByText(/couldn't read the chain/i).first(), "the failure must be visible")
    .toBeVisible({ timeout: 90_000 });
  // Desired: the failure tells them what to do — the node can be changed from here,
  // not only by starting the whole wizard over.
  await expect(
    p.locator("main").getByRole("button", { name: /change network|another node|switch community|choose another|use another/i }).first(),
    "an unreachable node must offer a way to change it",
  ).toBeVisible();
});
