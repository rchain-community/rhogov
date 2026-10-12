import { revAddressOf } from "../chain/keys";
import { RNode } from "../chain/node";
import { publishName, resolveNames } from "../chain/profile";
import { signal } from "@preact/signals";
import { nameError } from "../chain/people";
import { active, displayName, gov, setDisplayName, rawNames, learnListed, listedName, myAddr, notePublished, publishedName, secretKey } from "../state";
import { sameName } from "../chain/gov";
import { act, notify } from "./kit";

// Enough for the one name deploy (batch phlo limit), so an unfunded newcomer
// isn't greeted by a failure: the name waits until they have REV.
export const NAME_NEEDS = 3_000_000;

/** Why your name isn't showing, if it's because someone else holds it (shown on Account). */
export const nameProblem = signal<{ name: string; holder: string } | null>(null);

let running = false;
let failedFor = "";
let lastKey: string | null = null;

/**
 * Make sure others see your display name: in the chain's name
 * directory where it has one, otherwise on the community's own name list. One
 * small deploy the first time, and again only if you change it. Cheap to call
 * often: it reads first and writes only when the name is missing or stale.
 */
export async function syncMyName(force = false) {
  const c = active.value, key = secretKey.value, me = myAddr.value, name = displayName.value.trim(), G = gov.value;
  if (!c || !key || !me || !G || running) return;
  // A different key is a different person: forget what was decided for the last one.
  if (me !== lastKey) { lastKey = me; failedFor = ""; nameProblem.value = null; }
  running = true;
  try {
    const node = new RNode(c.node);
    learnListed(await G.names().catch(() => ({})));
    const have = await resolveNames(node, [me]).catch(() => null);
    // A key that already has a name keeps it: signing in with an existing key
    // brings its name back (here, or on another device), whatever was typed.
    // Only an explicit Save on Account (force) renames.
    // Being findable in THIS community needs the name on its list, even where
    // the chain also has a directory (the directory says what your name is, the
    // list says you are part of this community). One small deploy, once funded.
    const ensureListed = async (n: string) => {
      if (listedName(me) === n || failedFor === `${c.group}|${me}|${n}|list`) return;
      if (Object.entries(await G.names().catch(() => ({} as Record<string, string>))).some(([a, x]) => a !== me && sameName(x, n))) return;
      const b = await node.balance(revAddressOf(key));
      if (b !== null && b < NAME_NEEDS) return;
      const ok = await act("Putting your name on this community's list", (t) => G.setName(n, t), { done: `People in ${c.name} can now find you as “${n}”.` });
      if (ok === undefined) failedFor = `${c.group}|${me}|${n}|list`;
      else learnListed({ [me]: n }, true);
    };
    const mine = have !== null ? have[me] : listedName(me);
    if (mine && (!force || mine === name)) {
      if (have !== null) notePublished(me, mine);
      if (mine !== displayName.value) setDisplayName(mine);
      nameProblem.value = null;
      if (have !== null) await ensureListed(mine);
      return;
    }
    if (nameError(name)) return; // e.g. starts with a digit: Account says why
    // Don't retry a name that just failed every 15 s; a change of name or community retries.
    const attempt = `${c.group}|${me}|${name}`;
    if (failedFor === attempt && !force) return;
    // Unique within the community, among names people have CLAIMED: the
    // community's name list, or the directory where there is one. A label
    // someone typed when joining a group is not a claim and doesn't block.
    const listed = await G.names().catch(() => ({} as Record<string, string>));
    const holder = Object.entries(listed).find(([a, n]) => a !== me && sameName(n, name))
      ?? (have !== null ? Object.entries(rawNames()).find(([a, n]) => a !== me && publishedName(a) && sameName(n, name)) : undefined);
    if (holder) {
      failedFor = attempt;
      nameProblem.value = { name, holder: holder[0] };
      // Say it once per name and holder, not on every load; Account keeps showing it.
      const said = `rhogov:name-taken:${c.group}:${me}:${name.toLowerCase()}:${holder[0]}`;
      let told = false;
      try { told = !!localStorage.getItem(said); localStorage.setItem(said, "1"); } catch { /* storage refused */ }
      if (!told || force) notify(`“${name}” is taken`, `In this community someone else has claimed it, so others see you as “${name} (unclaimed)” until you choose another name on Account. If that address is an old key of yours and you still have it, sign in with it, rename it, then sign back in with this key. Account explains how.`, "error");
      return;
    }
    nameProblem.value = null;
    const bal = await node.balance(revAddressOf(key));
    if (bal !== null && bal < NAME_NEEDS) return;
    const ok = have !== null
      ? await act("Publishing your name", (t) => publishName(node, key, me, name, t), { done: `Others now see you as “${name}”.` })
      : await act("Putting your name on this community's list", (t) => G.setName(name, t), { done: `Others now see you as “${name}”.` });
    if (ok === undefined) { failedFor = attempt; return; }
    failedFor = "";
    if (have !== null) { notePublished(me, name); await ensureListed(name); }
    else learnListed({ [me]: name }, true);
  } finally {
    running = false;
  }
}

/** Everyone's names from the community's list, for screens that show people. */
export async function loadListedNames() {
  const G = gov.value;
  if (G) learnListed(await G.names().catch(() => ({})));
}
