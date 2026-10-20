// membership.tsx — the last-known membership strip.
//
// Shown only while a screen's live read hasn't completed, so a reload or an
// unreachable node can still say what the chain said last time. It is
// display-only: no Join, Leave or Invite control is offered from here.
import { membershipAt, myAsks, myGroups, myInvitations } from "../state";

const when = (at: number) => (at ? new Date(at).toLocaleString() : "");

export function LastKnownMemberships() {
  const groups = myGroups.value;
  const invites = myInvitations.value;
  const asks = myAsks.value;
  if (!groups.length && !invites.length && !asks.length) return null;
  return (
    <div class="callout stack" style={{ marginBottom: ".8rem" }}>
      <span class="small muted">
        <b>Last known</b>{membershipAt.value ? ` as of ${when(membershipAt.value)}` : ""} — the chain hasn't answered yet.
      </span>
      {invites.map((m) => (
        <div class="row between small">
          <span>You were invited to join <b>{m.name}</b>.</span>
          <a href={`#/g/${encodeURIComponent(m.gid)}`}>Open group →</a>
        </div>
      ))}
      {asks.map((m) => (
        <div class="row between small">
          <span>You asked to join <b>{m.name}</b>; waiting for an admin.</span>
          <a href={`#/g/${encodeURIComponent(m.gid)}`}>Open group →</a>
        </div>
      ))}
      {groups.map((m) => (
        <div class="row between small">
          <span>{m.status === "admin" ? "Admin of" : "Member of"} <b>{m.name}</b>.</span>
          <a href={`#/g/${encodeURIComponent(m.gid)}`}>Open group →</a>
        </div>
      ))}
    </div>
  );
}
