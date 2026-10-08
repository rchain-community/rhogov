import { RNode } from "../chain/node";
import { publishName, resolveNames } from "../chain/profile";
import { active, displayName, myAddr, notePublished, secretKey } from "../state";
import { act } from "./kit";

/**
 * Make sure the chain knows your display name — one small deploy the first time
 * on a network, and again only if you change it. Others see it instead of an address.
 */
export async function syncMyName(force = false) {
  const c = active.value, key = secretKey.value, me = myAddr.value, name = displayName.value.trim();
  if (!c || !key || !me || !name) return;
  const node = new RNode(c.node);
  const have = (await resolveNames(node, [me]).catch(() => null));
  if (have === null) return; // no name directory on this chain
  if (have[me] === name && !force) { notePublished(me, name); return; }
  const ok = await act("Publishing your name", (t) => publishName(node, key, me, name, t), { done: `Others now see you as “${name}”.` });
  if (ok !== undefined) notePublished(me, name);
}

