// Offline adversarial coverage of the built app. All node requests are intercepted.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { revAddressOf } from "../../src/chain/keys";
import { MASTERDICT_RESOLVE } from "../../src/chain/profile";
const APP = pathToFileURL(resolve("dist/index.html")).href;
const KEY = "1".padStart(64, "0");
const ME = revAddressOf(KEY);
const BOB = "1111bob", CAROL = "1111carol";
const community = { name: "Offline fixture", node: "https://fixture.example", inbox: "rho:id:inbox", group: "rho:id:group", issue: "rho:id:issue" };
const encode = (v: any): any => v === null ? { ExprNil: {} } : typeof v === "string" ? { ExprString: v }
  : typeof v === "number" ? { ExprInt: v } : typeof v === "boolean" ? { ExprBool: v }
  : Array.isArray(v) ? { ExprList: v.map(encode) } : { ExprMap: Object.entries(v).map(([k, x]) => [k, encode(x)]) };
test.setTimeout(30_000);
test.use({ viewport: { width: 1200, height: 900 } });

async function fixture(browser: Browser, review = true) {
  const context = await browser.newContext();
  const state = { posts: [] as any[], pending: true, failPost: false, receiptBeforePost: false, namesPublished: true,
    result: ["cast", "v", ME] as any };
  const p = await context.newPage();
  await context.addInitScript(({ KEY, community, review }) => {
    localStorage.setItem("rhogov:key", JSON.stringify(KEY));
    localStorage.setItem("rhogov:name", JSON.stringify("Alice"));
    localStorage.setItem("rhogov:communities", JSON.stringify([community]));
    localStorage.setItem("rhogov:active", JSON.stringify(community.group));
    localStorage.setItem("rhogov:review", JSON.stringify(review));
    localStorage.setItem("rhogov:setupNode", community.node);
  }, { KEY, community, review });
  const group = { name: "Fixture group", policy: "open", admins: { [ME]: true, [BOB]: true, [CAROL]: true },
    members: { [ME]: { role: "admin", label: "Alice" }, [BOB]: { role: "admin", label: "Bob" }, [CAROL]: { role: "admin", label: "Carol" } },
    invited: {}, deleg: {}, topic: {}, ratings: {}, censures: {} };
  const names = { ...group, name: "~names", members: group.members };
  const issue = { gid: "g", title: "Fixture vote", by: ME, status: "open", mode: "approval", options: ["A", "B"],
    voters: { [ME]: true, [BOB]: true }, guests: {}, ballots: {}, results: {} };
  await context.route(/^https?:/, async (route) => {
    const request = route.request(), url = request.url();
    if (!url.startsWith(community.node)) return route.abort();
    if (url.endsWith("/api/status")) return route.fulfill({ json: { latestBlockNumber: 1, minPhloPrice: 1, shardId: "/root", devMode: false } });
    if (url.endsWith("/api/blocks/1")) return route.fulfill({ json: [{ blockHash: "fixture-block" }] });
    if (url.endsWith("/api/deploy")) {
      const body = request.postDataJSON(); state.posts.push(body);
      state.receiptBeforePost = await p.evaluate((sig) => Object.keys(localStorage).some((k) =>
        k.startsWith("rhogov:pending-write:") && JSON.parse(localStorage.getItem(k)!).signature === sig), body.signature);
      if (state.failPost) return route.abort("failed");
      return route.fulfill({ json: "Success" });
    }
    if (url.includes("/api/v1/deploy-status/")) return route.fulfill({ json: state.pending
      ? { NotProcessed: { status: "Pooled" } }
      : { ProcessedWithSuccess: { deployResult: [encode(state.result)] } } });
    if (url.includes("explore-deploy")) {
      const body = request.postDataJSON();
      const term = typeof body === "string" ? body : body.term;
      let value: any = null;
      if (term.includes('"getBalance"')) value = 10_000_000;
      else if (term.includes(MASTERDICT_RESOLVE)) value = { [ME + "/profile/name"]: "Alice", [BOB + "/profile/name"]: "Bob", [CAROL + "/profile/name"]: "Carol" };
      else if (term.includes("rho:gov:trustLevels")) value = { levels: { [ME]: 5, [BOB]: 5, [CAROL]: 5 }, discredited: [], trustActive: false, weights: {}, ballots: {}, winner: null, mode: "approval" };
      else if (term.includes('"groupOf", ["~names"]')) value = state.namesPublished ? names : { ...names, members: {} };
      else if (term.includes('"groupOf"')) value = group;
      else if (term.includes('"groups"')) value = ["g"];
      else if (term.includes('"issuesOf"')) value = ["v"];
      else if (term.includes('"issueOf"')) value = issue;
      else if (term.includes('"typesIn"')) value = [];
      else if (term.includes('"countIn"')) value = 0;
      return route.fulfill({ json: { expr: value === null ? [] : [encode(value)] } });
    }
    throw new Error("Unexpected mocked node request: " + url);
  });
  p.setDefaultTimeout(10_000);
  p.on("dialog", (dialog) => dialog.accept());
  return { p, context, state };
}
async function vote(p: Page) {
  await p.goto(APP + "#/v/g/v");
  await p.getByRole("heading", { name: "Fixture vote", exact: true }).waitFor();
  await p.locator('label.choice').filter({ hasText: /^A$/ }).locator("input").check();
  await p.getByRole("button", { name: "Vote", exact: true }).click();
}
test("review is supplied by the actual casting term; Cancel sends nothing", async ({ browser }) => {
  const f = await fixture(browser);
  await vote(f.p);
  const dialog = f.p.getByRole("dialog", { name: "Sign: Casting your vote", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("pre")).toContainText('"cast"');
  await expect(dialog.locator("pre")).toContainText('"A"');
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(f.state.posts).toHaveLength(0);
  await f.context.close();
});
test("repeat click while reviewing does not replace or add a review; only one POST is sent", async ({ browser }) => {
  const f = await fixture(browser);
  await vote(f.p);
  const dialog = f.p.getByRole("dialog", { name: "Sign: Casting your vote", exact: true });
  const term = await dialog.locator("pre").innerText();
  await f.p.getByRole("button", { name: "Vote", exact: true }).dispatchEvent("click");
  await expect(f.p.getByRole("dialog", { name: /^Sign:/ })).toHaveCount(1);
  await expect(dialog.locator("pre")).toHaveText(term);
  await dialog.getByRole("button", { name: "Sign and send", exact: true }).click();
  await expect.poll(() => f.state.posts.length).toBe(1);
  expect(f.state.posts[0].data.term).toBe(term);
  expect(f.state.receiptBeforePost).toBe(true);
  await f.p.getByRole("button", { name: "Vote", exact: true }).dispatchEvent("click");
  await expect(f.p.getByRole("dialog", { name: /^Sign:/ })).toHaveCount(0);
  expect(f.state.posts).toHaveLength(1);
  await f.context.close();
});
test("two targets with the same title have distinct locks and queued reviews", async ({ browser }) => {
  const f = await fixture(browser);
  await f.p.goto(APP + "#/g/g/members");
  const buttons = f.p.getByRole("button", { name: "Remove admin", exact: true });
  await expect(buttons).toHaveCount(2);
  await buttons.nth(0).click();
  const dialog = f.p.getByRole("dialog", { name: "Sign: Removing admin", exact: true });
  const first = await dialog.locator("pre").innerText();
  await buttons.nth(1).dispatchEvent("click");
  await expect(f.p.getByRole("dialog", { name: /^Sign:/ })).toHaveCount(1);
  await dialog.getByRole("button", { name: "Sign and send", exact: true }).click();
  await expect.poll(() => f.state.posts.length).toBe(1);
  await expect(dialog.locator("pre")).not.toHaveText(first);
  await dialog.getByRole("button", { name: "Sign and send", exact: true }).click();
  await expect.poll(() => f.state.posts.length).toBe(2);
  expect(f.state.posts[0].data.term).not.toBe(f.state.posts[1].data.term);
  await f.context.close();
});
test("a submitted action remains blocked after reload; status checks do not POST", async ({ browser }) => {
  const f = await fixture(browser);
  await vote(f.p);
  await f.p.getByRole("dialog", { name: /^Sign:/ }).getByRole("button", { name: "Sign and send" }).click();
  await expect.poll(() => f.state.posts.length).toBe(1);
  await f.p.reload();
  await f.p.getByRole("heading", { name: "Fixture vote", exact: true }).waitFor();
  await f.p.locator('label.choice').filter({ hasText: /^A$/ }).locator("input").check();
  await f.p.getByRole("button", { name: "Vote", exact: true }).click();
  await expect(f.p.getByText("This action was already submitted", { exact: true })).toBeVisible();
  expect(f.state.posts).toHaveLength(1);
  await f.p.goto(APP + "#/account");
  await expect(f.p.getByRole("heading", { name: "Pending actions", exact: true })).toBeVisible();
  f.state.pending = false;
  await f.p.getByRole("button", { name: "Check status", exact: true }).click();
  await expect(f.p.getByRole("heading", { name: "Pending actions", exact: true })).toHaveCount(0);
  expect(f.state.posts).toHaveLength(1);
  await f.context.close();
});
test("roll replacement requires confirmation before any signing review", async ({ browser }) => {
  const f = await fixture(browser);
  f.p.removeAllListeners("dialog");
  let message = "";
  f.p.on("dialog", async (dialog) => { message = dialog.message(); await dialog.dismiss(); });
  await f.p.goto(APP + "#/v/g/v");
  await f.p.getByRole("button", { name: /Add 1 new member.*roll/ }).click();
  await expect.poll(() => message).toContain("Replace the voter roll");
  expect(message).toContain("add and remove voters");
  await expect(f.p.getByRole("dialog", { name: /^Sign:/ })).toHaveCount(0);
  expect(f.state.posts).toHaveLength(0);
  await f.context.close();
});
test("irreversible close is reviewed even when the preference is off", async ({ browser }) => {
  const f = await fixture(browser, false);
  await f.p.goto(APP + "#/v/g/v");
  await f.p.getByRole("button", { name: "Close voting and record result", exact: true }).click();
  const dialog = f.p.getByRole("dialog", { name: "Sign: Closing the vote", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("pre")).toContainText('"close"');
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(f.state.posts).toHaveLength(0);
  await f.context.close();
});
test("failed receipt storage refuses the POST", async ({ browser }) => {
  const f = await fixture(browser);
  await f.context.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith("rhogov:pending-write:")) throw new Error("storage denied");
      return set.call(this, key, value);
    };
  });
  await vote(f.p);
  await f.p.getByRole("dialog", { name: /^Sign:/ }).getByRole("button", { name: "Sign and send" }).click();
  await expect(f.p.getByText(/could not save the pending action/)).toBeVisible();
  expect(f.state.posts).toHaveLength(0);
  await f.context.close();
});


test("automatic name publication waits for an explicit Account action when review is on", async ({ browser }) => {
  const f = await fixture(browser);
  f.state.namesPublished = false;
  await f.p.goto(APP + "#/account");
  await expect(f.p.getByText("Your name is waiting for review", { exact: true })).toBeVisible();
  expect(f.state.posts).toHaveLength(0);
  await expect(f.p.getByRole("dialog", { name: /^Sign:/ })).toHaveCount(0);
  await f.p.getByRole("button", { name: "Publish name", exact: true }).click();
  const dialog = f.p.getByRole("dialog", { name: "Sign: Putting your name on this community's list", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("pre")).toContainText('"~names"');
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(f.state.posts).toHaveLength(0);
  await f.context.close();
});
for (const otherNetwork of [false, true]) test(`a ${otherNetwork ? "network switch with the same issue URI" : "community switch"} cancels the old callback before signing`, async ({ browser }) => {
  const f = await fixture(browser);
  const other = { ...community, name: "Other community", group: "rho:id:othergroup",
    ...(otherNetwork ? { node: "https://other-fixture.example" } : { issue: "rho:id:otherissue", inbox: "rho:id:otherinbox" }) };
  await f.context.addInitScript(({ community, other }) => {
    localStorage.setItem("rhogov:communities", JSON.stringify([community, other]));
  }, { community, other });
  await vote(f.p);
  await f.p.evaluate(() => { location.hash = "#/community"; });
  await f.p.getByRole("button", { name: "Switch", exact: true }).dispatchEvent("click");
  const dialog = f.p.getByRole("dialog", { name: "Sign: Casting your vote", exact: true });
  await dialog.getByRole("button", { name: "Sign and send", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(f.p.getByText("Cancelled before signing.", { exact: true })).toBeVisible();
  expect(f.state.posts).toHaveLength(0);
  await f.context.close();
});

for (const lostResponse of [false, true]) test(`a durable install receipt resumes after ${lostResponse ? "a lost POST response" : "reload"} without a second submission`, async ({ browser }) => {
  const f = await fixture(browser);
  f.state.failPost = lostResponse;
  await f.p.goto(APP + "#/welcome");
  await f.p.getByRole("button", { name: "Start a new community", exact: true }).click();
  await f.p.getByPlaceholder("e.g. RChain Cooperative").fill("Resumed fixture");
  await f.p.getByRole("button", { name: "Start community", exact: true }).click();
  await f.p.getByRole("dialog", { name: "Sign: Starting your community", exact: true })
    .getByRole("button", { name: "Sign and send", exact: true }).click();
  await expect.poll(() => f.state.posts.length).toBe(1);
  expect(f.state.receiptBeforePost).toBe(true);
  if (lostResponse) await expect(f.p.getByText(/Its signature is saved on Account/)).toBeVisible();
  await f.p.reload();
  await f.p.getByRole("button", { name: "Start a new community", exact: true }).click();
  await expect(f.p.getByText("You started", { exact: false })).toContainText("Resumed fixture");
  f.state.result = ["Inbox", "Group", "Issue"].map((name) => ["installed", name, "rho:id:resumed-" + name.toLowerCase(), ME]);
  f.state.pending = false;
  await f.p.getByRole("button", { name: "Look for “Resumed fixture”", exact: true }).click();
  await expect(f.p.getByText("Three contracts installed: Inbox, Group, Issue.", { exact: true })).toBeVisible();
  await expect(f.p.getByRole("dialog", { name: /^Sign:/ })).toHaveCount(0);
  expect(f.state.posts).toHaveLength(1);
  expect(await f.p.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("rhogov:pending-write:")))).toHaveLength(0);
  await f.context.close();
});
