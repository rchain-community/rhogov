// home.tsx — what needs you now.
import { type Group, type Issue } from "../chain/gov";
import { active, displayName, gov, myAddr } from "../state";
import { JoinButton, learnFrom } from "./groups";
import { Loading, go, useAsync } from "./kit";
import { IssueCard } from "./votes";
import { isAuxIssue, isChamberOf, isCouncilId } from "../chain/council";

export function HomeScreen() {
  const G = gov.value!;
  const me = myAddr.value!;
  const a = useAsync(async () => {
    const groups = await G.groups();
    learnFrom(groups);
    // Chambers carry no decisions of their own; a council's are listed under the council.
    const mine = groups.filter((g) => g.members.some((m) => m.addr === me) && !groups.some((c) => isCouncilId(c.id) && isChamberOf(c.id, g.id)));
    const issues = (await Promise.all(mine.map((g) => G.issues(g.id).then((is) => is.filter((i) => !isAuxIssue(i.id)).map((i) => [i, g] as [Issue, Group]))))).flat();
    const inbox = await G.inboxCounts(me).catch(() => ({} as Record<string, number>));
    return { groups, mine, issues, inbox };
  }, [G.c.group, me]);
  return (
    <div>
      <h1>Hello{displayName.value ? `, ${displayName.value}` : ""}</h1>
      <p class="muted">{active.value!.name}</p>
      <Loading a={a}>{() => {
        const { groups, mine, issues, inbox } = a.data!;
        const needs = issues.filter(([i]) => i.status === "open" && (i.voters.includes(me) || i.guests.includes(me)) && !i.ballots[me]);
        const openOthers = issues.filter(([i]) => i.status === "open" && !needs.some(([x]) => x.id === i.id));
        const invites = groups.filter((g) => g.invited.includes(me) && !g.members.some((m) => m.addr === me));
        const unread = Object.values(inbox).reduce((x, y) => x + y, 0);
        return (
          <div class="stack">
            {unread > 0 && <div class="callout row between"><span>You have <b>{unread} new message{unread > 1 ? "s" : ""}</b>.</span><button class="primary" onClick={() => go("/inbox")}>Open inbox</button></div>}
            {invites.map((g) => <div class="callout warn row between"><span>You're invited to join <b>{g.name}</b>.</span><JoinButton g={g} /></div>)}

            <div class="section">
              <h2>Needs your vote</h2>
              {needs.length ? <div class="stack">{needs.map(([i, g]) => <IssueCard i={i} g={g} />)}</div>
                : <div class="card soft empty">You're all caught up.</div>}
            </div>
            {openOthers.length > 0 && (
              <div class="section">
                <h2>{needs.length ? "Other open votes" : "Open votes"}</h2>
                <div class="stack">{openOthers.map(([i, g]) => <IssueCard i={i} g={g} />)}</div>
              </div>
            )}
            <div class="section">
              <div class="row between"><h2 style={{ margin: 0 }}>Your groups</h2><a href="#/groups">All groups →</a></div>
              {mine.length ? (
                <div class="grid" style={{ marginTop: ".7rem" }}>
                  {mine.map((g) => (
                    <div class="card click" onClick={() => go(`/g/${encodeURIComponent(g.id)}`)}>
                      <h3>{g.name}</h3>
                      <div class="muted small">{g.members.length} member{g.members.length === 1 ? "" : "s"} · {issues.filter(([i, gg]) => gg.id === g.id && i.status === "open").length} open votes</div>
                    </div>
                  ))}
                </div>
              ) : <div class="card soft empty" style={{ marginTop: ".7rem" }}>{groups.length ? <>You're not in a group yet. <a href="#/groups">Browse groups</a></> : <>No groups in this community yet. <a href="#/groups">Start the first one</a></>}</div>}
            </div>
          </div>
        );
      }}</Loading>
    </div>
  );
}
