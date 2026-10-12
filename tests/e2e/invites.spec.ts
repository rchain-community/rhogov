// Invites (#10, #30): the invite answers the network and the community, and a
// network you never chose is called out before you go on.
import { expect, test } from "@playwright/test";
import { APP, KEYS, onboard, person, settle, startCommunity } from "./helpers";

const forge = (invite: string, node: string) => {
  const b64 = invite.slice(invite.indexOf("c=") + 2);
  const c = JSON.parse(Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  const out = Buffer.from(JSON.stringify({ ...c, node }), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `#/join?c=${out}`;
};

test("an invite asks only for a name and key, then opens the community", async ({ browser }) => {
  const host = await person(browser, "Alice");
  await onboard(host, "Alice");
  const name = `Invited ${Date.now()}`;
  const invite = await startCommunity(host, name);

  const bob = await person(browser, "Bob");
  await bob.goto(APP + invite.slice(invite.indexOf("#")));
  await bob.getByRole("button", { name: "Get started" }).click();
  // Step 1 is answered by the invite, shown as such, and can't be changed into a mismatch.
  await expect(bob.getByText(`from your invite to ${name}`)).toBeVisible();
  await expect(bob.locator(".steps > .step.current").getByRole("heading", { name: "Your identity" })).toBeVisible();
  await bob.getByPlaceholder("e.g. Ada").fill("Bob");
  await bob.getByRole("button", { name: "I have a key" }).click();
  await bob.getByPlaceholder("0b60b3ff…").fill(KEYS.Bob);
  await bob.getByRole("button", { name: "Continue" }).click();
  // Straight into the community: no second "Start a new community" to click by mistake.
  await expect(bob.getByRole("heading", { name: /^Hello/ })).toBeVisible();
  await expect(bob.getByText(name).first()).toBeVisible();
  await expect(bob.getByRole("button", { name: "Start a new community" })).toHaveCount(0);
  await settle(bob);
});

test("an invite to a network you didn't choose is called out, and needs your say-so", async ({ browser }) => {
  const host = await person(browser, "Alice");
  await onboard(host, "Alice");
  const invite = await startCommunity(host, `Foreign ${Date.now()}`);

  const p = await person(browser, "Stranger");
  await p.goto(APP + forge(invite, "https://rnode.example.net"));
  await expect(p.getByText("This invite points to a network you didn't choose")).toBeVisible();
  const go = p.getByRole("button", { name: "Get started" });
  await expect(go).toBeDisabled();
  await p.getByLabel("I recognise this network and trust whoever sent the invite").check();
  await expect(go).toBeEnabled();

  // A familiar network (one of rhogov's, or one you've used) gets no warning.
  const q = await person(browser, "Friend");
  await q.goto(APP + invite.slice(invite.indexOf("#")));
  await expect(q.getByText("network you didn't choose")).toHaveCount(0);
  await expect(q.getByRole("button", { name: "Get started" })).toBeEnabled();
});
