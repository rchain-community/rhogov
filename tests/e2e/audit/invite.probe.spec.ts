// invite.probe.spec.ts — entry states S5–S6: arriving from an invite link.
// Personas: the stranded stranger (P-A) and the invited outsider with no key (P-F).
//
// EXPECTED RED. Each probe asserts the behaviour a first-time user needs and fails
// until the finding it names (CS-nnn, docs/audit/register.md) is fixed. A red here is
// a finding, not a broken test.   npm run test:audit
//
// The *working* invite behaviour — opening a community you already know — is a guard
// and lives in tests/e2e/cold-start.spec.ts, where it runs in the normal suite.
import { expect, test } from "@playwright/test";
import { APP, KEYS, coldStart, decodeInvite, open, person, seed, type Invite } from "../helpers-audit";

// NOT .serial: an audit must enumerate every finding. See cold-start.probe.spec.ts.
test.describe("invitations (S5–S7)", () => {
  let invite = "";
  let c: Invite;

  test.beforeAll(async ({ browser }) => {
    const host = await person(browser, "invite-host");
    invite = await coldStart(host, "Bob");
    c = decodeInvite(invite);
    await host.context().close();
  });

  test("P6 — a damaged invite offers a way out in the page [CS-006]", async ({ browser }) => {
    const p = await person(browser, "stranded");
    await p.goto(APP + "#/join?c=notbase64");
    // Measured: main renders the message with no links and no buttons; the app's menu
    // is hidden (not ready). The only escape is the always-mounted Help panel — which
    // is not a way out a stranded user would find. So scope this to <main>.
    await expect(
      p.locator("main").getByRole("link", { name: /home|start your own|try again|user guide|enter.*address/i }).first(),
      "a damaged invite must offer a way forward in the page itself, not only in Help",
    ).toBeVisible();
  });

  test("P7a — the invite answers the network step [CS-007]", async ({ browser }) => {
    const p = await person(browser, "invited-network");
    await p.goto(APP + invite.slice(invite.indexOf("#")));
    await p.getByRole("button", { name: "Get started" }).click();
    // The invite already named the network. The only thing left to ask for is a name,
    // so the identity step must be the current one — not "Choose a network".
    await expect(
      p.locator(".steps > .step.current").getByRole("heading", { name: "Your identity" }),
      "the invite named the network; the wizard must not ask for it again",
    ).toBeVisible();
  });

  test("P7b — the invite's community is not offered again [CS-007]", async ({ browser }) => {
    const p = await person(browser, "invited-community");
    await p.goto(APP + invite.slice(invite.indexOf("#")));
    await p.getByRole("button", { name: "Get started" }).click();
    // Walk to the community step, tolerating whether or not the network step is asked.
    if (await p.getByRole("radio", { name: /Another node/ }).count()) {
      await p.getByRole("button", { name: "Continue" }).click();
    }
    await p.getByPlaceholder("e.g. Ada").fill("Guest");
    await p.getByRole("button", { name: "Continue" }).click();
    // The community was joined when the invite was accepted; it must not be offered again.
    await expect(
      p.getByRole("button", { name: "Start a new community" }),
      "the invited community is already joined",
    ).toHaveCount(0);
  });

  test("P8 — a community whose contracts are gone fails with a next step [CS-008]", async ({ browser }) => {
    const p = await person(browser, "stale-community");
    const dead: Invite = { name: "Ghost council", node: c.node, inbox: "rho:id:zzzzzzzz", group: "rho:id:zzzzzzzz", issue: "rho:id:zzzzzzzz" };
    await seed(p, { key: KEYS.Carol, name: "Carol", communities: [dead], active: dead.group });
    await open(p, "#/");
    await expect(p.locator("main").getByText(/couldn't read the chain/i).first(), "the failure must be visible")
      .toBeVisible({ timeout: 90_000 });
    await expect(
      p.locator("main").getByRole("button", { name: /switch community|forget|another community|change network|use another/i }).first(),
      "a dead community must offer a way out, not only a Retry",
    ).toBeVisible();
  });
});
