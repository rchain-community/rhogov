// people.ts — turn what someone typed into a person: a name or a REV address.
import { looksLikeRevAddress } from "./keys";

export type Resolved =
  | { ok: true; addr: string; name?: string }
  | { ok: false; why: "empty" | "unknown" | "ambiguous" | "bad-address"; matches?: string[] };

const norm = (s: string) => s.trim().toLowerCase();

/**
 * `people` is address → name for this community. A REV address is taken as
 * typed (anyone can be invited, known or not); anything else must be exactly one
 * person's name, ignoring case and surrounding space. A duplicate's display form
 * "Aria (…ab12)" picks the one whose address ends that way.
 */
export function resolvePerson(text: string, people: Record<string, string>): Resolved {
  const t = text.trim();
  if (!t) return { ok: false, why: "empty" };
  if (looksLikeRevAddress(t)) return { ok: true, addr: t, name: people[t] };
  if (/^1111\w{20,}$/.test(t)) return { ok: false, why: "bad-address" };
  const tail = /^(.*) \(…(\w{4})\)$/.exec(t);
  const [want, end] = tail ? [tail[1], tail[2]] : [t, ""];
  const matches = Object.entries(people).filter(([a, n]) => norm(n) === norm(want) && (!end || a.endsWith(end))).map(([a]) => a);
  if (matches.length === 1) return { ok: true, addr: matches[0], name: people[matches[0]] };
  return matches.length ? { ok: false, why: "ambiguous", matches } : { ok: false, why: "unknown" };
}
