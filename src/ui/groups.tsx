// groups.tsx — the groups directory and a group's page (members, trust, delegation, votes).
import { useState } from "preact/hooks";
import { type Group, type Issue, type Standing, makeId } from "../chain/gov";
import { displayName, gov, learnNames, myAddr } from "../state";
import { Addr, Info, Loading, Modal, PersonField, Trust, act, go, href, nameOf, useAsync } from "./kit";
import { IssueCard, NewIssueModal } from "./votes";
import { COUNCIL_PREFIX } from "../chain/council";

/** The contract labels a group's creator with the group's own name; that is not a person's name. */
export const memberLabel = (g: Group, addr: string) => {
  const m = g.members.find((x) => x.addr === addr);
  return m && m.label && m.label !== g.name ? m.label : "";
};
export const learnFrom = (gs: Group[]) =>
  learnNames(gs.flatMap((g) => g.members.map((m) => ({ addr: m.addr, label: memberLabel(g, m.addr) }))));

const isMember = (g: Group, a: string | null) => !!a && g.members.some((m) => m.addr === a);

// --- directory ---------------------------------------------------------------

export function GroupsScreen() {
  const G = gov.value!;
  // Councils and their chambers live under Councils; plain groups here.
  const a = useAsync(async () => { const gs = await G.groups(); learnFrom(gs); return gs.filter((g) => !g.id.startsWith(COUNCIL_PREFIX)); }, [G.c.group]);
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <div class="row between">
        <h1>Groups</h1>
        <button class="primary" onClick={() => setCreating(true)}>＋ New group</button>
      </div>
      <p class="muted">A group is a set of members who vote together, delegate to each other and vouch for each other.</p>
      <Loading a={a}>{() => {
        const mine = a.data!.filter((g) => isMember(g, myAddr.value));
        const others = a.data!.filter((g) => !isMember(g, myAddr.value));
        return (
          <>
            <div class="section">
              <h2>Your groups</h2>
              {mine.length ? <div class="grid">{mine.map((g) => <GroupCard g={g} />)}</div>
                : <div class="card soft empty">You're not in any group yet. Join one below, or start one.</div>}
            </div>
            {others.length > 0 && (
              <div class="section">
                <h2>Other groups in this community</h2>
                <div class="grid">{others.map((g) => <GroupCard g={g} />)}</div>
              </div>
            )}
          </>
        );
      }}</Loading>
      {creating && <NewGroupModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function GroupCard({ g }: { g: Group }) {
  const me = myAddr.value;
  const invited = !!me && g.invited.includes(me);
  return (
    <div class="card click" onClick={() => go(`/g/${encodeURIComponent(g.id)}`)}>
      <div class="row between"><h3>{g.name}</h3>{g.policy === "invite" ? <span class="badge">Invite only</span> : <span class="badge accent">Open</span>}</div>
      <div class="muted small">{g.members.length} member{g.members.length === 1 ? "" : "s"}{g.admins.includes(me ?? "") ? " · you're an admin" : ""}</div>
      {invited && <div style={{ marginTop: ".5rem" }}><span class="badge warn">You're invited</span></div>}
    </div>
  );
}

function NewGroupModal({ onClose }: { onClose: () => void }) {
  const G = gov.value!;
  const [name, setName] = useState("");
  const [policy, setPolicy] = useState<"open" | "invite">("open");
  const create = async () => {
    const gid = makeId(name);
    onClose();
    const r = await act(`Creating “${name}”`, (t) => G.createGroup(gid, name.trim(), policy, t),
      { done: "Group created. You're its first admin.", preview: G.preview("group", "create", [JSON.stringify(gid), JSON.stringify(name), JSON.stringify(policy)]) });
    if (r) go(`/g/${encodeURIComponent(gid)}`);
  };
  return (
    <Modal title="New group" onClose={onClose}
      actions={<><button onClick={onClose}>Cancel</button><button class="primary" disabled={!name.trim()} onClick={create}>Create group</button></>}>
      <div class="stack">
        <label class="field">Name<input autoFocus value={name} placeholder="e.g. Budget committee" onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
        <div class="stack">
          <label class={`choice ${policy === "open" ? "on" : ""}`}><input type="radio" checked={policy === "open"} onChange={() => setPolicy("open")} />
            <div><b>Open</b><div class="muted small">Anyone in the community can join.</div></div></label>
          <label class={`choice ${policy === "invite" ? "on" : ""}`}><input type="radio" checked={policy === "invite"} onChange={() => setPolicy("invite")} />
            <div><b>Invite only</b><div class="muted small">Admins invite people by address; invitees join when they're ready.</div></div></label>
        </div>
        <p class="muted small">You become the group's first admin. Admins start with the highest trust level, which is where all trust in the group flows from.</p>
      </div>
    </Modal>
  );
}

// --- a group's page --------------------------------------------------------------

export function GroupScreen({ gid, tab = "votes" }: { gid: string; tab?: string }) {
  const G = gov.value!;
  const a = useAsync(async () => {
    const [g, st, issues] = await Promise.all([G.group(gid), G.standing(gid), G.issues(gid)]);
    if (g) learnFrom([g]);
    return { g, st, issues };
  }, [G.c.group, gid]);
  const me = myAddr.value;
  return (
    <Loading a={a}>{() => {
      const { g, st, issues } = a.data!;
      if (!g) return <div class="empty">This group doesn't exist in this community. <a href="#/groups">See all groups</a></div>;
      const member = isMember(g, me);
      const setTab = (t: string) => go(`/g/${encodeURIComponent(gid)}/${t}`);
      return (
        <div>
          <div class="topline"><span class="crumbs"><a href="#/groups">Groups</a> ›</span></div>
          <div class="row between">
            <div>
              <h1>{g.name}</h1>
              <div class="row small muted">
                {g.policy === "invite" ? <span class="badge">Invite only</span> : <span class="badge accent">Open</span>}
                <span>{g.members.length} member{g.members.length === 1 ? "" : "s"}</span>
                {me && g.admins.includes(me) && <span class="badge accent">You're an admin</span>}
                {me && st.discredited.includes(me) && <span class="badge danger">You've been censured</span>}
              </div>
            </div>
            {!member && <JoinButton g={g} />}
          </div>
          <div class="tabs" role="tablist">
            {[["votes", `Votes (${issues.length})`], ["members", "Members"], ["about", "About"]].map(([k, l]) => (
              <button role="tab" class={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === "members" ? <Members g={g} st={st} /> : tab === "about" ? <About g={g} /> : <Votes g={g} issues={issues} member={member} />}
        </div>
      );
    }}</Loading>
  );
}

export function JoinButton({ g }: { g: Group }) {
  const G = gov.value!;
  const me = myAddr.value;
  const can = g.policy === "open" || (!!me && g.invited.includes(me));
  if (!can) return <span class="badge">Invite only — ask an admin to invite you</span>;
  const join = () => act(`Joining ${g.name}`, (t) => G.join(g.id, displayName.value || "member", t),
    { done: `You're a member of ${g.name}.`, preview: G.preview("group", "join", [JSON.stringify(g.id), JSON.stringify(displayName.value)]) });
  return <button class="primary" onClick={join}>Join group</button>;
}

function Votes({ g, issues, member }: { g: Group; issues: Issue[]; member: boolean }) {
  const [creating, setCreating] = useState(false);
  const open = issues.filter((i) => i.status !== "closed").reverse();
  const closed = issues.filter((i) => i.status === "closed").reverse();
  return (
    <div class="stack">
      <div class="row between">
        <span class="muted">Members propose questions; everyone on the roll votes; the node counts.</span>
        {member && <button class="primary" onClick={() => setCreating(true)}>＋ New vote</button>}
      </div>
      {!issues.length && <div class="card soft empty">No votes yet.{member ? " Start one with “New vote”." : ""}</div>}
      {open.map((i) => <IssueCard i={i} g={g} />)}
      {closed.length > 0 && <><h3 class="section">Closed</h3>{closed.map((i) => <IssueCard i={i} g={g} />)}</>}
      {creating && <NewIssueModal g={g} onClose={() => setCreating(false)} />}
    </div>
  );
}

// --- members, trust, delegation, censure --------------------------------------------

const LEVELS = ["No trust", "A little", "Some", "Solid", "Strong", "Full (admin)"];

function Members({ g, st }: { g: Group; st: Standing }) {
  const G = gov.value!;
  const me = myAddr.value;
  const member = isMember(g, me);
  const admin = !!me && g.admins.includes(me);
  const myLevel = me ? st.levels[me] ?? 0 : 0;
  const myDelegate = me ? g.deleg[me] : undefined;
  const [rating, setRating] = useState<string | null>(null);
  const [delegating, setDelegating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const censuredByMe = (addr: string) => !!me && (g.censures[me] ?? []).includes(addr);
  const censureCount = (addr: string) => Object.values(g.censures).filter((ts) => ts.includes(addr)).length;
  const sorted = [...g.members].sort((x, y) => (st.levels[y.addr] ?? 0) - (st.levels[x.addr] ?? 0) || x.addr.localeCompare(y.addr));
  return (
    <div class="stack">
      {member && (
        <div class="card soft">
          <div class="row between">
            <div>
              <b>Your vote</b>
              <div class="small">
                {myDelegate ? <>When you don't vote yourself, your vote goes to <Addr addr={myDelegate} avatar={false} />.</> : "You vote for yourself. You can hand your vote to someone you trust when you don't vote."}
              </div>
            </div>
            <div class="row">
              <button onClick={() => setDelegating(true)}>{myDelegate ? "Change" : "Delegate my vote"}</button>
              {myDelegate && <button class="ghost" onClick={() => act("Taking your vote back", (t) => G.undelegate(g.id, null, t), { done: "You vote for yourself again." })}>Take it back</button>}
            </div>
          </div>
          <div class="small muted" style={{ marginTop: ".5rem" }}>
            Your trust level: <Trust level={myLevel} /> {myLevel}/5{!st.trustActive && " · trust weighting starts once anyone rates a member"}
          </div>
        </div>
      )}
      <div class="row between">
        <h2 style={{ margin: 0 }}>{g.members.length} member{g.members.length === 1 ? "" : "s"}</h2>
        {admin && <button onClick={() => setInviting(true)}>Invite someone</button>}
      </div>
      <div class="card" style={{ padding: ".3rem 1rem" }}>
        <div class="list">
          {sorted.map((m) => {
            const lvl = st.levels[m.addr] ?? 0;
            const disc = st.discredited.includes(m.addr);
            const self = m.addr === me;
            const delegators = Object.entries(g.deleg).filter(([, to]) => to === m.addr).length;
            return (
              <div class="item">
                <div class="grow stack" style={{ gap: ".2rem" }}>
                  <div class="row"><Addr addr={m.addr} />
                    {m.role === "admin" && <span class="badge accent">admin</span>}
                    {disc && <span class="badge danger">censured</span>}
                    {!disc && censureCount(m.addr) > 0 && <span class="badge warn">{censureCount(m.addr)} censure{censureCount(m.addr) > 1 ? "s" : ""}</span>}
                  </div>
                  <div class="row small muted">
                    <Trust level={lvl} /> <span>{LEVELS[lvl]}</span>
                    {g.deleg[m.addr] && <span>· votes via {nameOf(g.deleg[m.addr])}</span>}
                    {delegators > 0 && <span>· carries {delegators} delegated vote{delegators > 1 ? "s" : ""}</span>}
                  </div>
                </div>
                {member && !self && (
                  <div class="row">
                    <button class="small" onClick={() => setRating(m.addr)}>Rate{g.ratings[me!]?.[m.addr] !== undefined ? ` (${g.ratings[me!][m.addr]})` : ""}</button>
                    <button class={`small ${censuredByMe(m.addr) ? "" : "danger"}`}
                      title={myLevel < lvl ? "Censures count only from members at or above this member's trust level" : ""}
                      onClick={() => {
                        const on = !censuredByMe(m.addr);
                        if (on && !confirm(`Censure ${nameOf(m.addr)}? A censure says their trust is undeserved. If two-thirds of members at or above their level agree, their trust drops to 0 and those who vouched for them lose the trust they staked.`)) return;
                        act(on ? `Censuring ${nameOf(m.addr)}` : "Withdrawing censure", (t) => G.censure(g.id, m.addr, on, t));
                      }}>{censuredByMe(m.addr) ? "Withdraw censure" : "Censure"}</button>
                    {admin && (
                      <button class="small ghost" onClick={() => act(m.role === "admin" ? "Removing admin" : "Making admin",
                        (t) => G.setRole(g.id, m.addr, m.role === "admin" ? "member" : "admin", t))}>{m.role === "admin" ? "Remove admin" : "Make admin"}</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {g.invited.length > 0 && <div class="small muted">Invited, not joined yet: {g.invited.map((a) => <span style={{ marginRight: ".6rem" }}><Addr addr={a} avatar={false} /></span>)}</div>}
      <Info>
        <p><b>Trust</b> starts with the admins (level 5) and flows down: a rating you give can be at most one below your own level, so two members nobody trusts can't vouch each other up. The node computes everyone's level with its <span class="mono">rho:gov:trustLevels</span> function; each member's vote weighs <b>1 + their level</b>. Until anyone rates anyone, every vote weighs 1.</p>
        <p><b>Delegation</b> is liquid: if you don't vote, your weight passes to your delegate — and on to theirs if they don't vote either. Voting yourself always overrides it. Loops abstain.</p>
        <p><b>Censure</b> is accountability: when at least two-thirds (and at least two) of the members at or above someone's level censure them, their trust drops to 0 and everyone who vouched for them loses what they staked.</p>
      </Info>
      {rating && <RateModal g={g} addr={rating} myLevel={myLevel} onClose={() => setRating(null)} />}
      {delegating && <DelegateModal g={g} issueId={null} onClose={() => setDelegating(false)} />}
      {inviting && <InviteModal g={g} onClose={() => setInviting(false)} />}
    </div>
  );
}

function RateModal({ g, addr, myLevel, onClose }: { g: Group; addr: string; myLevel: number; onClose: () => void }) {
  const G = gov.value!;
  const me = myAddr.value!;
  const current = g.ratings[me]?.[addr];
  const [v, setV] = useState<number>(current ?? Math.max(0, Math.min(3, myLevel - 1)));
  const cap = Math.max(0, myLevel - 1);
  return (
    <Modal title={`How much do you trust ${nameOf(addr)}?`} onClose={onClose}
      actions={<><button onClick={onClose}>Cancel</button><button class="primary" onClick={() => { onClose(); act(`Rating ${nameOf(addr)} ${v}/5`, (t) => G.rate(g.id, addr, v, t)); }}>Save rating</button></>}>
      <div class="stack">
        {LEVELS.map((l, i) => (
          <label class={`choice ${v === i ? "on" : ""}`}>
            <input type="radio" checked={v === i} onChange={() => setV(i)} />
            <div class="row grow between"><span><b>{i}</b> — {l}</span><Trust level={i} /></div>
          </label>
        ))}
        <p class="muted small">
          {cap === 0 ? "Your rating is recorded, but it can't raise anyone yet: you can confer at most one level below your own, and your level is " + myLevel + "."
            : `You can confer up to level ${cap} (one below your own ${myLevel}). A higher rating is recorded but capped by the node.`}
        </p>
      </div>
    </Modal>
  );
}

export function DelegateModal({ g, issueId, issueTitle, onClose }: { g: Group; issueId: string | null; issueTitle?: string; onClose: () => void }) {
  const G = gov.value!;
  const me = myAddr.value!;
  const current = issueId ? g.topic[issueId]?.[me] : g.deleg[me];
  const [to, setTo] = useState<string>(current ?? "");
  const loops = (target: string) => {
    let cur = target; const seen = new Set([me]);
    while (cur) { if (seen.has(cur)) return true; seen.add(cur); cur = (issueId ? g.topic[issueId]?.[cur] : undefined) ?? g.deleg[cur]; }
    return false;
  };
  return (
    <Modal title={issueId ? `Delegate your vote on “${issueTitle}”` : "Delegate your vote"} onClose={onClose}
      actions={<><button onClick={onClose}>Cancel</button><button class="primary" disabled={!to} onClick={() => { onClose(); act(`Delegating to ${nameOf(to)}`, (t) => G.delegate(g.id, to, issueId, t), { done: `${nameOf(to)} now carries your vote${issueId ? " on this issue" : ""}.` }); }}>Delegate</button></>}>
      <p class="muted small">{issueId ? "Only for this vote — it overrides your standing delegate here." : "For every vote in this group where you don't vote yourself."} You can always vote directly instead, and you can take it back any time.</p>
      <div class="stack">
        {g.members.filter((m) => m.addr !== me).map((m) => (
          <label class={`choice ${to === m.addr ? "on" : ""}`}>
            <input type="radio" checked={to === m.addr} onChange={() => setTo(m.addr)} />
            <div class="row grow between"><Addr addr={m.addr} />{loops(m.addr) && <span class="badge warn">would form a loop</span>}</div>
          </label>
        ))}
        {g.members.length < 2 && <div class="empty">Nobody else is in this group yet.</div>}
      </div>
    </Modal>
  );
}

function InviteModal({ g, onClose }: { g: Group; onClose: () => void }) {
  const G = gov.value!;
  const [addr, setAddr] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const already = !!addr && g.members.some((m) => m.addr === addr);
  const send = async () => {
    const a = addr!;
    onClose();
    if (g.policy === "invite") await act(`Inviting ${nameOf(a)}`, (t) => G.invite(g.id, a, t), { done: "Invitation recorded on chain." });
    if (notify) await act(`Sending ${nameOf(a)} the invitation`, (t) => G.send(a, "invite", { gid: g.id, group: g.name, body: `You're invited to join ${g.name}.` }, t), { done: "Delivered to their inbox." });
  };
  return (
    <Modal title={`Invite someone to ${g.name}`} onClose={onClose}
      actions={<><button onClick={onClose}>Cancel</button><button class="primary" disabled={!addr || already} onClick={send}>Invite</button></>}>
      <div class="stack">
        <PersonField label="Who" onChange={setAddr} />
        {already && <span class="badge warn">{nameOf(addr!)} is already a member.</span>}
        <label class="row"><input type="checkbox" style={{ width: "auto" }} checked={notify} onChange={(e) => setNotify((e.target as HTMLInputElement).checked)} /> Also send them a message with a link to join</label>
        {g.policy === "open" && <p class="muted small">This group is open, so anyone can already join; the message just lets them know.</p>}
      </div>
    </Modal>
  );
}

function About({ g }: { g: Group }) {
  const G = gov.value!;
  const me = myAddr.value;
  return (
    <div class="stack">
      <div class="card">
        <div class="stack small">
          <div><b>Membership:</b> {g.policy === "invite" ? "invite only — admins invite, invitees accept" : "open — anyone in the community can join"}</div>
          <div><b>Admins:</b> {g.admins.map((a) => <span style={{ marginRight: ".6rem" }}><Addr addr={a} avatar={false} /></span>)}</div>
          <div><b>Group id:</b> <span class="mono">{g.id}</span></div>
          <div><b>Stored in:</b> <span class="mono">{G.c.group}</span></div>
        </div>
      </div>
      {isMember(g, me) && <div><button class="danger" onClick={() => confirm(`Leave ${g.name}? Your standing delegation in this group is dropped too.`) && act(`Leaving ${g.name}`, (t) => G.leave(g.id, t)).then(() => go("/groups"))}>Leave group</button></div>}
      <p class="small"><a href={href("g", g.id, "members")}>Members and trust →</a></p>
    </div>
  );
}
