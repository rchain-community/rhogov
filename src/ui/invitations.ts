// invitations.ts — the Inbox's invitation rows: chain state first, the local
// note archive second. Pure (no signals, no reads), so it can be unit-tested.
//
// The authoritative invitation is the group's on-chain `invited` set; a pending
// request to join is its `asked` set. A note an admin sent is only a message:
// `receive` consumes it on chain, so this browser may be the only place it
// exists. A row is therefore shown even when there is no note, and an old
// note's status is read from the live group when possible.
import { type Group, type GroupsRead, type InboxMessage, membershipStatus } from "../chain/gov";
import type { MembershipEntry } from "../state";

export type InviteState = "pending" | "asked" | "member" | "open" | "closed" | "missing" | "unknown";

export interface InviteRow {
  gid: string;
  name: string;
  state: InviteState;
  /** The live group when this row came from a live read — the only safe Join gate. */
  group?: Group;
  /** The newest archived note for this group, if this browser has one. */
  note?: InboxMessage;
  /** Every archived note for this group; deleting the note removes them all. */
  notes: InboxMessage[];
  /** When the last-known cache supplied this row (undefined = live). */
  lastKnown?: number;
}

const ORDER: Record<InviteState, number> = {
  pending: 0, asked: 1, member: 2, open: 3, closed: 4, missing: 5, unknown: 6,
};

export function inviteRows(input: {
  read?: GroupsRead;
  cached: Record<string, MembershipEntry>;
  archive: InboxMessage[];
  me: string;
}): InviteRow[] {
  const { read, cached, archive, me } = input;
  const rows = new Map<string, InviteRow>();
  const live = new Map((read?.groups ?? []).map((g) => [g.id, g]));
  const unreadable = new Set(read?.unreadable ?? []);

  const upsert = (gid: string, name: string, state: InviteState, extra: Partial<InviteRow> = {}) => {
    const prev = rows.get(gid);
    rows.set(gid, {
      gid,
      name,
      state,
      group: extra.group ?? prev?.group,
      note: extra.note ?? prev?.note,
      notes: extra.notes ?? prev?.notes ?? [],
      lastKnown: extra.lastKnown ?? prev?.lastKnown,
    });
  };

  // A pending invitation (or our own request to join) is chain state: show it
  // even when no note was collected.
  for (const g of read?.groups ?? []) {
    const status = membershipStatus(g, me);
    if (status === "invited") upsert(g.id, g.name, "pending", { group: g });
    else if (status === "asked") upsert(g.id, g.name, "asked", { group: g });
  }

  // The last-known cache may fill in a group the live read could not answer for.
  for (const [gid, e] of Object.entries(cached)) {
    const covered = !!read && (live.has(gid) || (!unreadable.has(gid) && !read.ids.includes(gid)));
    if (covered) continue;
    if (e.status === "invited") upsert(gid, e.name, "pending", { lastKnown: e.at });
    else if (e.status === "asked") upsert(gid, e.name, "asked", { lastKnown: e.at });
  }

  // Notes become rows too, with a status read live when possible.
  const byGid = new Map<string, InboxMessage[]>();
  for (const m of archive) {
    if (m.type !== "invite" || !m.fields.gid) continue;
    byGid.set(m.fields.gid, [...(byGid.get(m.fields.gid) ?? []), m]);
  }
  for (const [gid, notes] of byGid) {
    const sorted = [...notes].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    const note = sorted[0];
    const g = live.get(gid);
    const cachedEntry = cached[gid];
    let name = note.fields.group || cachedEntry?.name || gid;
    let state: InviteState;
    let lastKnown: number | undefined;
    if (g) {
      name = g.name;
      const s = membershipStatus(g, me);
      state = s === "admin" || s === "member" ? "member"
        : s === "invited" ? "pending"
        : s === "asked" ? "asked"
        : g.policy === "open" ? "open" : "closed";
    } else if (unreadable.has(gid) || (read && !live.has(gid) && read.ids.includes(gid))) {
      // The group exists but could not be read: prefer the last-known status.
      if (cachedEntry) {
        name = cachedEntry.name;
        state = cachedEntry.status === "invited" ? "pending" : cachedEntry.status === "asked" ? "asked" : "member";
        lastKnown = cachedEntry.at;
      } else state = "unknown";
    } else if (read && !read.ids.includes(gid)) {
      state = "missing";
    } else if (cachedEntry) {
      name = cachedEntry.name;
      state = cachedEntry.status === "invited" ? "pending" : cachedEntry.status === "asked" ? "asked" : "member";
      lastKnown = cachedEntry.at;
    } else {
      state = "unknown";
    }
    upsert(gid, name, state, { group: g, note, notes: sorted, lastKnown });
  }

  // A cached membership with no note is not an invitation to show here.
  return [...rows.values()]
    .filter((r) => r.state !== "member" || !!r.note)
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name));
}
