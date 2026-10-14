// #3: background inbox alerts are opt-in, slower while hidden, and never re-prompt after decline.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { APP, KEYS } from "./helpers";

const c = {
  name: "Background alerts",
  node: "https://background-alerts.invalid",
  inbox: "rho:id:backgroundinbox",
  group: "rho:id:backgroundgroup",
  issue: "rho:id:backgroundissue",
};

async function fixture(browser: Browser, permissionAnswer: "granted" | "denied"): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await context.addInitScript(({ key, community, answer }) => {
    if (location.protocol !== "file:") return;
    const w = window as any;
    localStorage.setItem("rhogov:key", JSON.stringify(key));
    localStorage.setItem("rhogov:name", JSON.stringify("Alice"));
    localStorage.setItem("rhogov:communities", JSON.stringify([community]));
    localStorage.setItem("rhogov:active", JSON.stringify(community.group));
    w.__inboxCount = 0;
    w.__hidden = false;
    w.__notifications = [];
    w.__permissionAnswer = answer;
    w.__deployRequests = 0;
    w.__refreshIntervals = [];

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => w.__hidden ? "hidden" : "visible" });

    let permission: NotificationPermission = "default";
    class FakeNotification {
      static get permission() { return permission; }
      static async requestPermission(): Promise<NotificationPermission> {
        const n = Number(localStorage.getItem("__notificationRequests") ?? 0) + 1;
        localStorage.setItem("__notificationRequests", String(n));
        permission = w.__permissionAnswer;
        return permission;
      }
      onclick: ((event: Event) => void) | null = null;
      constructor(public title: string, public options?: NotificationOptions) {
        w.__notifications.push({ title, body: options?.body, tag: options?.tag });
      }
      close() {}
    }
    Object.defineProperty(window, "Notification", { configurable: true, value: FakeNotification });

    const realSetInterval = window.setInterval.bind(window);
    window.setInterval = ((fn: TimerHandler, ms?: number, ...args: any[]) => {
      if (args[0] === "rhogov-inbox-watch") {
        w.__backgroundIntervalMs = ms;
        w.__runBackgroundCheck = () => typeof fn === "function" && fn(...args);
        return 300001 as unknown as number;
      }
      if (ms === 15_000) {
        w.__refreshIntervals.push(() => typeof fn === "function" && fn(...args));
        return 15001 as unknown as number;
      }
      return realSetInterval(fn, ms, ...args);
    }) as typeof window.setInterval;

    const realFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith(community.node)) return realFetch(input, init);
      if (url.endsWith("/api/deploy")) { w.__deployRequests++; return new Response("unexpected deploy", { status: 500 }); }
      if (url.endsWith("/api/status")) return new Response(JSON.stringify({ devMode: true, latestBlockNumber: 1, shardId: "root", minPhloPrice: 1 }));
      if (url.endsWith("/api/blocks/1")) return new Response(JSON.stringify([{ blockHash: "background-test" }]));
      if (url.includes("/api/explore-deploy")) {
        const body = typeof init?.body === "string" ? init.body : "";
        let expr: unknown[] = [{ ExprList: { data: [] } }];
        if (body.includes("typesIn")) {
          expr = [{ ExprList: { data: w.__inboxCount > 0 ? [{ ExprString: { data: "note" } }] : [] } }];
        } else if (body.includes("countIn")) {
          expr = [{ ExprInt: { data: w.__inboxCount } }];
        }
        return new Response(JSON.stringify({ expr }), { headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    };
  }, { key: KEYS.Alice, community: c, answer: permissionAnswer });
  const page = await context.newPage();
  await page.goto(APP + "#/inbox");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.getByText("No new messages on chain.")).toBeVisible();
  return { context, page };
}

test("permission starts only from opt-in and a hidden tab checks every five minutes", async ({ browser }) => {
  const { context, page } = await fixture(browser, "granted");
  try {
    expect(await page.evaluate(() => Number(localStorage.getItem("__notificationRequests") ?? 0))).toBe(0);
    expect(await page.evaluate(() => (window as any).__backgroundIntervalMs)).toBe(5 * 60_000);
    await expect(page.getByRole("button", { name: "Enable notifications" })).toBeVisible();

    await page.getByRole("button", { name: "Enable notifications" }).click();
    await expect(page.getByRole("status")).toHaveText("Background notifications are on.");
    expect(await page.evaluate(() => Number(localStorage.getItem("__notificationRequests") ?? 0))).toBe(1);

    await page.evaluate(() => {
      const w = window as any;
      w.__hidden = true;
      w.__inboxCount = 1;
      w.__runBackgroundCheck();
    });
    await expect.poll(() => page.evaluate(() => (window as any).__notifications.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).__notifications[0].title)).toBe("A new message is waiting");
    expect(await page.evaluate(() => (window as any).__deployRequests)).toBe(0);
  } finally { await context.close(); }
});

test("a denied permission is remembered and is not requested again", async ({ browser }) => {
  const { context, page } = await fixture(browser, "denied");
  try {
    expect(await page.evaluate(() => Number(localStorage.getItem("__notificationRequests") ?? 0))).toBe(0);
    await page.getByRole("button", { name: "Enable notifications" }).click();
    await expect(page.getByRole("status")).toContainText("did not grant permission");
    expect(await page.evaluate(() => localStorage.getItem("rhogov:inbox-notifications"))).toBe("declined");
    expect(await page.evaluate(() => Number(localStorage.getItem("__notificationRequests") ?? 0))).toBe(1);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enable notifications" })).toHaveCount(0);
    expect(await page.evaluate(() => Number(localStorage.getItem("__notificationRequests") ?? 0))).toBe(1);

    await page.locator('a[href="#/account"]').click();
    await expect(page.getByRole("button", { name: "Reconsider in Inbox" })).toBeVisible();
    await page.getByRole("button", { name: "Reconsider in Inbox" }).click();
    await expect(page.getByRole("button", { name: "Enable notifications" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("rhogov:inbox-notifications"))).toBe("unset");
    expect(await page.evaluate(() => Number(localStorage.getItem("__notificationRequests") ?? 0))).toBe(1);
    expect(await page.evaluate(() => (window as any).__deployRequests)).toBe(0);
  } finally { await context.close(); }
});

test("a visible tab still raises the in-app toast", async ({ browser }) => {
  const { context, page } = await fixture(browser, "granted");
  try {
    await page.locator('a[href="#/"]').click();

    await page.evaluate(() => {
      const w = window as any;
      const now = Date.now();
      Date.now = () => now + 61_000;
      w.__inboxCount = 1;
      for (const run of w.__refreshIntervals) run();
    });

    await expect(page.getByText("A new message is waiting")).toBeVisible();
    expect(await page.evaluate(() => (window as any).__notifications)).toEqual([]);
    expect(await page.evaluate(() => (window as any).__deployRequests)).toBe(0);
  } finally { await context.close(); }
});

test("No thanks is remembered without opening the permission prompt", async ({ browser }) => {
  const { context, page } = await fixture(browser, "granted");
  try {
    await page.getByRole("button", { name: "No thanks" }).click();
    expect(await page.evaluate(() => localStorage.getItem("rhogov:inbox-notifications"))).toBe("declined");
    expect(await page.evaluate(() => Number(localStorage.getItem("__notificationRequests") ?? 0))).toBe(0);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enable notifications" })).toHaveCount(0);
    expect(await page.evaluate(() => Number(localStorage.getItem("__notificationRequests") ?? 0))).toBe(0);

    await page.evaluate(() => {
      const w = window as any;
      w.__hidden = true;
      w.__inboxCount = 1;
      w.__runBackgroundCheck();
    });
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => (window as any).__notifications)).toEqual([]);
    expect(await page.evaluate(() => (window as any).__deployRequests)).toBe(0);
  } finally { await context.close(); }
});
