// cold-start.spec.ts — the first ten minutes' *working* behaviour, kept green.
//
// The audit of this path (docs/audit/register.md) found eight things wrong. Those are
// probed, red, under tests/e2e/audit/ and deliberately kept out of this suite. What is
// here is the part that already works and must not regress while the findings are fixed:
// the wizard's step machine, Help's next-step advice, the resume path for a returning
// user, and opening an invite to a community you already know.
//
//   npm run build && RHOGOV_NODE=http://127.0.0.1:40403 npm run test:e2e -- cold-start
import { expect, test, type Page } from "@playwright/test";
import { APP, KEYS, NODE, coldStart, decodeInvite, lsCommunities, open, person, seed, type Invite } from "./helpers-audit";

test.describe("cold start keeps working", () => {
  let page: Page;
  let invite = "";
  let c: Invite;

  test.beforeAll(async ({ browser }) => {
    page = await person(browser, "coldstart-guard");
    invite = await coldStart(page, "Carol");
    c = decodeInvite(invite);
  });
  test.afterAll(async () => { await page.context().close(); });

  test("Help knows the right next step for a brand-new community", async () => {
    await open(page, "#/");
    await page.getByRole("link", { name: "Help for you" }).click();
    await expect(page.locator(".modal .tips").getByText("You're not in any group yet")).toBeVisible();
    await page.locator(".modal").getByRole("button", { name: "Close" }).click();
  });

  test("the wizard's steps advance and “Change” returns you", async ({ browser }) => {
    const p = await person(browser, "wizard");
    await p.goto(APP);
    await p.getByRole("radio", { name: /Another node/ }).check();
    await p.getByPlaceholder("https://your-node:40403").fill(NODE);
    await p.getByRole("button", { name: "Use" }).click();
    await expect(p.getByText("Connected")).toBeVisible();
    await p.getByRole("button", { name: "Continue" }).click();
    // Step 2 is current: the identity form is up, and step 1 is collapsed but still
    // reachable behind "Change".
    await expect(p.getByRole("button", { name: "I have a key" })).toBeVisible();
    await p.getByRole("button", { name: "Change" }).click();
    await expect(p.getByRole("radio", { name: /Another node/ })).toBeVisible();
    await p.context().close();
  });

  test("a keyed user with no community resumes at the community step", async ({ browser }) => {
    const p = await person(browser, "resume");
    await seed(p, { key: KEYS.Dave, name: "Dave", communities: [], active: null });
    await open(p, "#/");
    await expect(p.getByRole("heading", { name: "Join or start a community" })).toBeVisible();
    await p.context().close();
  });

  test("an invite to a community you already have opens it", async ({ browser }) => {
    const p = await person(browser, "known-invite");
    await seed(p, { key: KEYS.Alice, name: "Alice", communities: [c], active: c.group });
    await open(p, invite.slice(invite.indexOf("#")));
    const openBtn = p.getByRole("button", { name: `Open ${c.name}` });
    await expect(openBtn).toBeVisible();
    await openBtn.click();
    await expect(p).toHaveURL(/#\/$/);
    expect((await lsCommunities(p)).length, "opening a known community must not add a duplicate").toBe(1);
    await p.context().close();
  });
});
