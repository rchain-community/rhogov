// people.ts — names, and turning what someone typed into a person.
import { looksLikeRevAddress } from "./keys";

export type Resolved =
  | { ok: true; addr: string; name?: string }
  | { ok: false; why: "empty" | "unknown" | "bad-address"; matches?: string[] };

/** Why a name can't be used, or "" if it can. Names never start with a digit: that is how an address starts. */
export function nameError(name: string): string {
  const n = name.trim();
  if (!n) return "Choose a name.";
  if (/^[0-9]/.test(n)) return "A name can't start with a number (that's how an address starts).";
  if (n.length > 40) return "Keep it to 40 characters.";
  return "";
}

/** Does this look like the start of an address rather than a name? */
export const isAddressish = (text: string) => /^[0-9]/.test(text.trim());

/**
 * `people` is address → name as shown in this community. Typed text starting
 * with a digit is an address, taken as typed (anyone can be invited, known or
 * not). Anything else must be exactly one person's name; capitals count.
 */
export function resolvePerson(text: string, people: Record<string, string>): Resolved {
  const t = text.trim();
  if (!t) return { ok: false, why: "empty" };
  if (isAddressish(t)) return looksLikeRevAddress(t) ? { ok: true, addr: t, name: people[t] } : { ok: false, why: "bad-address" };
  const matches = Object.entries(people).filter(([, n]) => n.trim() === t).map(([a]) => a);
  return matches.length === 1 ? { ok: true, addr: matches[0], name: people[matches[0]] } : { ok: false, why: "unknown", matches };
}

/** Names that start with what has been typed so far (none once it looks like an address). */
export function suggestNames(text: string, names: string[], max = 8): string[] {
  const t = text.trim();
  if (!t || isAddressish(t)) return [];
  const lower = t.toLowerCase();
  const starts = names.filter((n) => n.startsWith(t));
  const loose = names.filter((n) => !n.startsWith(t) && n.toLowerCase().startsWith(lower));
  // Exact-case matches first, then the same letters in other capitals.
  const by = (a: string, b: string) => a.localeCompare(b);
  return [...new Set([...starts.sort(by), ...loose.sort(by)])].filter((n) => n !== t).slice(0, max);
}

/**
 * People whose name starts with what's typed (exact capitals first, then any
 * capitals), or, once the text starts with a digit, whose address does.
 * Empty text keeps everyone, in the order given.
 */
export function filterPeople(text: string, addrs: string[], nameOf: (a: string) => string): string[] {
  const t = text.trim();
  if (!t) return addrs;
  if (isAddressish(t)) return addrs.filter((a) => a.startsWith(t));
  const exact = addrs.filter((a) => nameOf(a).startsWith(t));
  const lower = t.toLowerCase();
  return [...exact, ...addrs.filter((a) => !exact.includes(a) && nameOf(a).toLowerCase().startsWith(lower))];
}
