// Names belong to keys. Switching to an existing key brings its own name back;
// a label merely typed when joining a group (by an old key, say) never blocks
// or passes for the person who claimed the name. Names are shown, never addresses.
import { expect, test } from "@playwright/test";
import { Gov } from "../../src/chain/gov";
import { generateKey, revAddressOf } from "../../src/chain/keys";
import { RNode } from "../../src/chain/node";
import { parseInvite } from "../../src/state";
import { APP, KEYS, NODE, onboard, open, person, settle, startCommunity } from "./helpers";

test("switching to an existing key brings its name; a stray label doesn't block it", async ({ browser }) => {
  const alice = await person(browser, "Alice");
  await onboard(alice, "Alice");
  const invite = await startCommunity(alice, `Names ${Date.now()}`);
  const c = parseInvite(invite)!;
  const name = `jim${Date.now() % 100000}`; // lower case, as first created
  // A fresh key for "Jim", so no name from an earlier run comes with it.
  const jim = generateKey(), node = new RNode(NODE);
  await node.faucet(revAddressOf(jim));
  await expect.poll(async () => (await node.balance(revAddressOf(jim))) ?? 0, { timeout: 120_000 }).toBeGreaterThan(0);

  // Dave's old key joins an open group as `name`: a label only, never a claim.
  const dave = new Gov(c, () => KEYS.Dave);
  await dave.createGroup("club", "Club", "open");
  await dave.leave("club");
  await dave.join("club", name);

  // On his computer Jim claims `name` with his key. Nothing says it's taken.
  const computer = await person(browser, "Jim's computer");
  await onboard(computer, name, invite, jim);
  await settle(computer);
  await open(computer, "#/g/club/members");
  await computer.getByRole("button", { name: "Join group" }).click();
  await settle(computer);
  await expect(computer.getByText(/is taken|has claimed/)).toHaveCount(0);

  // On his phone he started with a NEW key, typed with a capital as phones do…
  const phone = await person(browser, "Jim's phone");
  await phone.goto(APP + invite.slice(invite.indexOf("#")));
  await phone.getByRole("button", { name: "Get started" }).click();
  await phone.getByPlaceholder("e.g. Ada").fill(name[0].toUpperCase() + name.slice(1));
  await phone.getByRole("button", { name: "Continue" }).click();
  // …then switches to his original key.
  await open(phone, "#/account");
  phone.once("dialog", (d) => d.accept());
  await phone.getByRole("button", { name: "Remove from this browser" }).click();
  // Inside a community, switching keys asks only for the key (#10): no network step.
  await phone.getByRole("button", { name: "I have a key" }).click();
  await phone.getByPlaceholder("0b60b3ff…").fill(jim);
  // The key's own name comes with it, not what the phone had typed.
  await expect(phone.getByText(`This key is ${name}.`)).toBeVisible();
  await phone.getByRole("button", { name: "Continue" }).click();
  await settle(phone);
  await open(phone, "#/account");
  await expect(phone.locator(".card label.field input").first()).toHaveValue(name);
  await phone.waitForTimeout(3000);
  await expect(phone.getByText(/is taken|has claimed/)).toHaveCount(0);

  // Everyone sees Jim as `name`; Dave's stray label is marked, never an address.
  await open(alice, "#/g/club/members");
  await expect(alice.locator(".list .item .nm", { hasText: new RegExp(`^${name}$`) })).toBeVisible({ timeout: 120_000 });
  await expect(alice.locator(".list .item .nm", { hasText: `${name} (unclaimed)` })).toBeVisible();
  await expect(alice.locator(".list .item .nm", { hasText: /^1111/ })).toHaveCount(0);
});

