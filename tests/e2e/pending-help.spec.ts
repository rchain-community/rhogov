import { expect, test } from "@playwright/test";
import { APP, KEYS } from "./helpers";
import { revAddressOf } from "../../src/chain/keys";

const node = "https://help-node.invalid";
const addr = revAddressOf(KEYS.Alice);

for (const scenario of [
  "missing",
  "matching",
  "other network",
  "other key",
  "damaged",
] as const) {
  test(`pending-install Help: ${scenario}`, async ({ page }) => {
    await page.route("https://**/*", route => route.abort());

    await page.addInitScript(
      ({ key, node, addr, scenario }) => {
        localStorage.setItem("rhogov:key", JSON.stringify(key));
        localStorage.setItem("rhogov:name", JSON.stringify("Alice"));
        localStorage.setItem("rhogov:setupNode", node);

        const scopedNode =
          scenario === "other network" ? "https://other.invalid" : node;
        const scopedAddr =
          scenario === "other key" ? "another-address" : addr;

        // A malformed reminder is deliberately treated as absent, matching the
        // guarded JSON parse in CommunityForm rather than inventing recovery state.
        if (scenario !== "missing") {
          localStorage.setItem(
            `rhogov:pending-install:${scopedNode}:${scopedAddr}`,
            scenario === "damaged"
              ? "{"
              : JSON.stringify({
                  name: "Our community",
                  sig: "pending-signature",
                }),
          );
        }
      },
      { key: KEYS.Alice, node, addr, scenario },
    );

    await page.goto(APP + "#/welcome");
    await page.getByRole("link", { name: "Help for you" }).click();

    const modal = page.getByRole("dialog");

    await expect(modal).toContainText("Join a community with an invite link");

    const reminder = modal
      .locator(".tips")
      .getByText("You started “Our community”");

    if (scenario === "matching") {
      await expect(reminder).toBeVisible();
    } else {
      await expect(reminder).toHaveCount(0);
    }

    // General Help deliberately stays generic; pending-install guidance belongs
    // to the state-aware tip above, as required by the review.
    await expect(modal.locator(".stack > div").first()).not.toContainText(
      "hasn't confirmed",
    );
  });
}
