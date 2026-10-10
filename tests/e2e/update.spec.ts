// A page left open notices a newer deploy (version.json beside it) and offers to reload.
// Served over http here, since a page opened from disk has nothing to compare with.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

test("an open page offers the new version", async ({ page }) => {
  let build = JSON.parse(readFileSync("dist/version.json", "utf8")).build as string;
  const html = readFileSync("dist/index.html");
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/version.json")) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ build })); }
    else { res.setHeader("content-type", "text/html"); res.end(html); }
  }).listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.getByText(`version ${build}`)).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByText("A new version of rhogov is available.")).toHaveCount(0); // same build
    build = "abcdef1"; // a deploy happens
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); // the tab comes back into view
    await expect(page.getByText("A new version of rhogov is available.")).toBeVisible();
    await page.getByRole("button", { name: "Later" }).click();
    await expect(page.getByText("A new version of rhogov is available.")).toHaveCount(0);
  } finally {
    server.close();
  }
});
