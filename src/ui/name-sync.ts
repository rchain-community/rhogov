import { revAddressOf } from "../chain/keys";
import { RNode } from "../chain/node";
import { publishName, resolveNames } from "../chain/profile";
import { active, displayName, gov, rawNames, learnListed, listedName, myAddr, notePublished, secretKey } from "../state";
import { sameName } from "../chain/gov";
import { act, notify } from "./kit";

// Enough for the one name deploy (batch phlo limit), so an unfunded newcomer
// isn't greeted by a failure: the name waits until they have REV.
const NAME_NEEDS = 3_000_000;

let running = false;
let failedFor = "";

/**
 * Make sure others see your display name, not your address: in the chain's name
 * directory where it has one, otherwise on the community's own name list. One
 * small deploy the first time, and again only if you change it. Cheap to call
 * often: it reads first and writes only when the name is missing or stale.
 */
export async function syncMyName(force = false) {
  const c = active.value, key = secretKey.value, me = myAddr.value, name = displayName.value.trim(), G = gov.value;
  if (!c || !key || !me || !name || !G || running) return;
  running = true;
  try {
    const node = new RNode(c.node);
    learnListed(await G.names().catch(() => ({})));
    const have = await resolveNames(node, [me]).catch(() => null);
    if (have !== null) {
      if (have[me] === name && !force) { notePublished(me, name); return; }
    } else if (listedName(me) === name && !force) return;
    // Don't retry a name that just failed every 15 s; a change of name or community retries.
    const attempt = `${c.group}|${me}|${name}`;
    if (failedFor === attempt && !force) return;
    // Unique within the community: refuse a name another known member already has.
    const people = new Set([...(await G.groups().catch(() => [])).flatMap((g) => g.members.map((m) => m.addr)), ...Object.keys(await G.names().catch(() => ({})))]);
    const clash = [...people].map((a) => [a, rawNames()[a] ?? ""] as const).find(([a, n]) => a !== me && n && sameName(n, name));
    if (clash) {
      failedFor = attempt;
      notify(`“${name}” is taken`, `Someone else in this community already goes by “${clash[1]}”. Names are unique here, so others still see your address: choose another name on Account.`, "error");
      return;
    }
    const bal = await node.balance(revAddressOf(key));
    if (bal !== null && bal < NAME_NEEDS) return;
    const ok = have !== null
      ? await act("Publishing your name", (t) => publishName(node, key, me, name, t), { done: `Others now see you as “${name}”.` })
      : await act("Putting your name on this community's list", (t) => G.setName(name, t), { done: `Others now see you as “${name}”.` });
    if (ok === undefined) { failedFor = attempt; return; }
    failedFor = "";
    if (have !== null) notePublished(me, name);
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
