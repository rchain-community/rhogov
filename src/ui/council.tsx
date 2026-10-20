// council.tsx — multi-stakeholder governance: councils, stakeholder chambers,
// chamber voting power (median of estimates), and the phased decision process.
import { useState } from "preact/hooks";
import {
  type ChamberResult, type Council, type PhaseId, PHASES, STAKEHOLDERS, approvalShare, argsIssueId, chamberBallots,
  chamberId, chamberPower, combine, councilsOf, decodeArg, encodeArg, estimateBallot, isAuxIssue, parseEstimate, weightsIssueId,
  approvals,
} from "../chain/council";
import { Gov, type Group, type Issue, asksId, isPending, makeId, pendingOf, q, qList, qSet } from "../chain/gov";
import { displayName, gov, myAddr } from "../state";
import { ApproveModal, DelegateModal, learnFrom } from "./groups";
import { Addr, Info, Loading, Modal, PersonField, act, go, nameOf, useAsync } from "./kit";
import { Ballot } from "./votes";

const cHref = (cid: string, ...rest: string[]) => `/c/${[cid, ...rest].map(encodeURIComponent).join("/")}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const isIn = (g: Group, a: string | null) => !!a && g.members.some((m) => m.addr === a);

// --- loading a council -------------------------------------------------------------

interface CouncilData extends Council {
  weights: Issue | null;
  decisions: Issue[];
  participants: string[];
}

async function loadCouncil(cid: string): Promise<CouncilData | null> {
  const G = gov.value!;
  const groups = await G.groups();
  learnFrom(groups);
  const c = councilsOf(groups).find((x) => x.group.id === cid);
  if (!c) return null;
  const issues = await G.issues(cid);
  const participants = [...new Set([...c.group.members, ...c.chambers.flatMap((ch) => ch.members)].map((m) => m.addr))];
  return {
    ...c,
    weights: issues.find((i) => i.id === weightsIssueId(cid)) ?? null,
    decisions: issues.filter((i) => !isAuxIssue(i.id)).reverse(),
    participants,
  };
}

/** The facilitator's record on a decision: phase, and at the end the decision of record. */
function recordOf(i: Issue): { phase: PhaseId; rationale?: string; actions?: string[]; winner?: string | null; scores?: Record<string, number> } {
  const r = i.results[i.by];
  const m = r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, any>) : {};
  const phase = (PHASES.some((p) => p.id === m.phase) ? m.phase : i.status === "closed" ? "decided" : "deliberate") as PhaseId;
  return { phase, rationale: m.rationale, actions: Array.isArray(m.actions) ? m.actions.map(String) : undefined, winner: m.winner ?? null, scores: m.scores };
}

// --- list ------------------------------------------------------------------------------

export function CouncilsScreen() {
  const G = gov.value!;
  const a = useAsync(async () => {
    const groups = await G.groups();
    learnFrom(groups);
    const cs = councilsOf(groups);
    const extra = await Promise.all(cs.map(async (c) => {
      const issues = await G.issues(c.group.id).catch(() => [] as Issue[]);
      return { c, purpose: issues.find((i) => i.id === weightsIssueId(c.group.id))?.title ?? "", open: issues.filter((i) => !isAuxIssue(i.id) && i.status !== "closed").length };
    }));
    return extra;
  }, [G.c.group]);
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <div class="row between">
        <h1>Councils</h1>
        <button class="primary" onClick={() => setCreating(true)}>＋ New council</button>
      </div>
      <p class="muted">A council makes decisions across several stakeholder groups — users, developers, validators, token holders and more. Each group keeps its own trust and delegation, and has voting power the participants estimate together.</p>
      <Loading a={a}>{() => a.data!.length ? (
        <div class="grid section">
          {a.data!.map(({ c, purpose, open }) => (
            <div class="card click" onClick={() => go(cHref(c.group.id))}>
              <div class="row between"><h3>{c.group.name}</h3>{isIn(c.group, myAddr.value) && <span class="badge accent">You take part</span>}</div>
              {purpose && <p class="small" style={{ margin: ".2rem 0 .4rem" }}>{purpose}</p>}
              <div class="muted small">{c.chambers.length} stakeholder groups · {open} open decision{open === 1 ? "" : "s"}</div>
            </div>
          ))}
        </div>
      ) : <div class="card soft empty section">No councils yet. Start one to bring several stakeholder groups to the same table.</div>}</Loading>
      {creating && <NewCouncilModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewCouncilModal({ onClose }: { onClose: () => void }) {
  const G = gov.value!;
  const me = myAddr.value!;
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [picked, setPicked] = useState<string[]>(["users", "developers", "validators", "holders"]);
  const [custom, setCustom] = useState<{ slug: string; name: string }[]>([]);
  const [cname, setCname] = useState("");
  const chambers = [
    ...STAKEHOLDERS.filter((s) => picked.includes(s.slug)),
    ...custom.map((c) => ({ ...c, blurb: "", policy: "open" as const })),
  ];
  const ok = name.trim() && purpose.trim() && chambers.length >= 2;
  const create = async () => {
    const cid = "council-" + makeId(name);
    onClose();
    const calls: [string, string[]][] = [
      ["create", [q(cid), q(name.trim()), q("open")]],
      ...chambers.map((ch) => ["create", [q(chamberId(cid, ch.slug)), q(ch.name), q(ch.policy)]] as [string, string[]]),
    ];
    const made = await act(`Creating ${name.trim()} and ${chambers.length} stakeholder groups`, (t) => G.batch("group", calls, t), { risk: "consequential", key: `createCouncil:${cid}`, done: "Council and stakeholder groups created." });
    if (!made) return;
    // The charter: the council's purpose, as the title of its voting-power estimate.
    const opened = await act("Opening the voting-power estimate", (t) => G.openIssue(weightsIssueId(cid), cid, purpose.trim(), "estimate", chambers.map((c) => chamberId(cid, c.slug)), [me], t), { risk: "consequential", key: `openWeights:${cid}` });
    if (opened) go(cHref(cid));
  };
  return (
    <Modal title="New council" onClose={onClose}
      actions={<><button onClick={onClose}>Cancel</button><button class="primary" disabled={!ok} onClick={create}>Create council</button></>}>
      <div class="stack">
        <label class="field">Name<input autoFocus value={name} placeholder="e.g. Protocol upgrade council" onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
        <label class="field">Purpose and scope
          <span class="hint">What this council decides, and what it doesn't. Shown to everyone who joins.</span>
          <textarea rows={2} value={purpose} onInput={(e) => setPurpose((e.target as HTMLTextAreaElement).value)} placeholder="e.g. Decide which protocol upgrades to schedule and when." />
        </label>
        <div class="field"><b>Stakeholder groups</b>
          <span class="hint">Each becomes its own group with its own members, trust and delegation. Invite-only groups are for stakeholders whose standing should be checked (e.g. validators).</span>
          {STAKEHOLDERS.map((s) => {
            const on = picked.includes(s.slug);
            return (
              <label class={`choice ${on ? "on" : ""}`}>
                <input type="checkbox" checked={on} onChange={() => setPicked(on ? picked.filter((x) => x !== s.slug) : [...picked, s.slug])} />
                <div><b>{s.name}</b> {s.policy === "invite" && <span class="badge">invite only</span>}<div class="muted small">{s.blurb}</div></div>
              </label>
            );
          })}
          {custom.map((c) => <div class="choice on"><b>{c.name}</b><button class="ghost small" onClick={() => setCustom(custom.filter((x) => x !== c))}>✕</button></div>)}
          <div class="row">
            <input class="grow" placeholder="Another stakeholder group" value={cname} onInput={(e) => setCname((e.target as HTMLInputElement).value)} />
            <button disabled={!cname.trim()} onClick={() => { setCustom([...custom, { slug: makeId(cname).replace(/[^a-z0-9-]/g, ""), name: cname.trim() }]); setCname(""); }}>Add</button>
          </div>
        </div>
        <p class="muted small">You'll facilitate: you are the first admin of every group (which gives you the top trust level in each) and you move decisions through their phases. Two deploys: one creates the groups, one opens the voting-power estimate.</p>
      </div>
    </Modal>
  );
}

// --- a council ----------------------------------------------------------------------

export function CouncilScreen({ cid, tab = "decisions", sub }: { cid: string; tab?: string; sub?: string }) {
  const G = gov.value!;
  const a = useAsync(() => loadCouncil(cid), [G.c.group, cid]);
  return (
    <Loading a={a}>{() => {
      const d = a.data;
      if (!d) return <div class="empty">This council doesn't exist. <a href="#/councils">All councils</a></div>;
      if (tab === "d" && sub) return <DecisionScreen d={d} iid={sub} />;
      const me = myAddr.value;
      const facilitator = d.weights?.by ?? d.group.admins[0];
      const newcomers = d.participants.filter((p) => !(d.weights?.voters ?? []).includes(p));
      const asking = me ? askingIn(d, me) : [];
      const approved = me ? d.chambers.filter((ch) => ch.invited.includes(me) && !isIn(ch, me)) : [];
      const waitingOn = me ? d.chambers.filter((ch) => isPending(ch, me)) : [];
      const setTab = (t: string) => go(cHref(cid, t));
      return (
        <div>
          <div class="topline"><span class="crumbs"><a href="#/councils">Councils</a> ›</span></div>
          <h1>{d.group.name}</h1>
          {d.weights?.title && <p>{d.weights.title}</p>}
          <div class="row small muted">
            <span>Facilitated by {nameOf(facilitator)}</span>
            <span>· {d.participants.length} participants in {d.chambers.length} stakeholder groups</span>
          </div>
          {me === facilitator && (newcomers.length > 0 || asking.length > 0) && <WaitingPanel d={d} issues={d.weights ? [d.weights] : []} what="the voting-power estimates" />}
          {me !== facilitator && asking.length > 0 && <WaitingPanel d={d} issues={[]} what="" />}
          {approved.length > 0 && <JoinApproved d={d} chambers={approved} />}
          {waitingOn.length > 0 && !approved.length && (
            <div class="callout small" style={{ marginTop: ".8rem" }}>You asked to join {waitingOn.map((c) => c.name).join(" and ")}. Waiting for {nameOf(facilitator)} or another admin to approve.</div>
          )}
          {me && !d.chambers.some((ch) => isIn(ch, me)) && !waitingOn.length && !approved.length && (
            <div class="callout row between" style={{ marginTop: ".8rem" }}>
              <span>You're not in any stakeholder group yet. Pick the ones you belong to.</span>
              <button class="primary" onClick={() => setTab("stakeholders")}>Choose</button>
            </div>
          )}
          <div class="tabs" role="tablist">
            {[["decisions", `Decisions (${d.decisions.length})`], ["stakeholders", "Stakeholder groups"], ["power", "Voting power"]].map(([k, l]) => (
              <button role="tab" class={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === "stakeholders" ? <><Stakeholders d={d} /><AddStakeholderGroup d={d} /></> : tab === "power" ? <PowerPanel d={d} /> : <Decisions d={d} />}
        </div>
      );
    }}</Loading>
  );
}

/** Requests to join the council's invite-only stakeholder groups that `me` can approve (an admin of the group). */
const askingIn = (d: CouncilData, me: string) =>
  [...new Set(d.chambers.filter((ch) => ch.admins.includes(me)).flatMap(pendingOf))];

/**
 * People waiting to take part (#83), and people asking to join: in the council
 * (or one of its stakeholder groups) but not yet on the list for `issues`, or
 * asking to join an invite-only stakeholder group. The facilitator approves
 * each person on their own, in one step (ApproveModal): invite them into the
 * groups they asked for, say how much they trust them, and add them to the
 * open votes. "Add all" is separate and only adds to the votes.
 */
function WaitingPanel({ d, issues, what }: { d: CouncilData; issues: Issue[]; what: string }) {
  const G = gov.value!;
  const me = myAddr.value;
  const open = issues.filter((i) => i.status !== "closed");
  const [approving, setApproving] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const asking = me ? askingIn(d, me) : [];
  if (!open.length && !asking.length) return null;
  const onAll = (p: string) => open.every((i) => i.voters.includes(p));
  const late = d.participants.filter((p) => open.length && !onAll(p));
  const waiting = [...new Set([...asking, ...late])];
  const chambersOf = (p: string) => d.chambers.filter((ch) => isIn(ch, p));
  const askedOf = (p: string) => d.chambers.filter((ch) => isPending(ch, p));
  const admins = d.chambers.filter((ch) => !!me && ch.admins.includes(me));
  const add = (people: string[]) => {
    const calls = open.map((i) => ["setRoll", [q(i.id), qSet([...new Set([...i.voters, ...people])])]] as [string, string[]]);
    const who = people.length === 1 ? nameOf(people[0]) : `${people.length} people`;
    const voted = open.some((i) => Object.keys(i.ballots).length > 0);
    return act(`Adding ${who} to ${what}`, (t) => G.batch("issue", calls, t), {
      risk: "consequential",
      key: `addToRolls:${open[0].id}:${people.join(",")}`,
      // The click is the approval; ask again only where it changes a vote already under way.
      confirm: voted ? `Add ${who} to ${what}? People have already taken part, so this changes who may vote while it's under way. Ballots already cast are not re-weighed.` : false,
      done: `${who} can now take part in ${what}.`,
    });
  };
  const inviteTo = async (ch: Group, p: string) => {
    if (ch.policy === "invite") await act(`Inviting ${nameOf(p)} to ${ch.name}`, (t) => G.invite(ch.id, p, t), {
      risk: "irreversible",
      key: `invite:${ch.id}:${p}`,
      confirm: `Invite ${nameOf(p)} to ${ch.name}? Their address is written into the group's public state, where anyone can read it, and an invitation can't be withdrawn.`,
      done: "Invitation recorded on chain.",
    });
    await act(`Telling ${nameOf(p)} about ${ch.name}`, (t) => G.send(p, "invite", { gid: ch.id, group: ch.name, body: `You're invited to join ${ch.name} in ${d.group.name}, so your voice counts in its decisions.` }, t),
      { risk: "routine", key: `send:${p}:invite:${ch.id}`, done: "Delivered to their inbox." });
  };
  const title = !open.length ? `Asking to join (${waiting.length})`
    : waiting.length ? `Waiting to take part in ${what} (${waiting.length})` : `Everyone in ${d.group.name} can take part in ${what}`;
  return (
    <div class="card stack" style={{ marginTop: ".8rem" }}>
      <div class="row between">
        <b>{title}</b>
        {admins.length > 0 && <button class="small ghost" onClick={() => setInviting(true)}>Invite someone to a stakeholder group</button>}
      </div>
      {waiting.length > 0 && <p class="small muted">Approve each person you recognise. Approving lets them into the stakeholder groups they asked for, records how much you trust them, {open.length ? `and adds them to ${what}, ` : ""}in one step. Their ballot counts in the stakeholder groups they're in.</p>}
      {waiting.map((p) => {
        const mine = chambersOf(p);
        const asked = askedOf(p);
        return (
          <div class="row between wrap" style={{ borderTop: "1px solid var(--line)", paddingTop: ".5rem" }}>
            <span><Addr addr={p} /> <span class="small muted">{[
              mine.length ? `in ${mine.map((c) => c.name).join(", ")}` : "",
              asked.length ? `asking to join ${asked.map((c) => c.name).join(", ")}` : "",
            ].filter(Boolean).join(" · ") || "in no stakeholder group yet"}</span>
              {asked.length > 0 && <> <span class="badge warn">Pending approval</span></>}</span>
            {(admins.length > 0 || open.length > 0) && <button class="small primary" onClick={() => setApproving(p)}>Approve…</button>}
          </div>
        );
      })}
      {late.length > 1 && <div><button class="small" onClick={() => { if (confirm(`Add all ${late.length} people to ${what}? Each can then take part.`)) add(late); }}>Add all {late.length} to {what}</button></div>}
      {approving && <ApproveModal addr={approving} groups={d.chambers} rolls={open.length ? { issues: open, what } : undefined} onClose={() => setApproving(null)} />}
      {inviting && <InviteToChamber d={d} admins={admins} onClose={() => setInviting(false)} onInvite={inviteTo} />}
    </div>
  );
}

/** You've been let into stakeholder groups you asked for: join them (and the council) in one deploy. */
function JoinApproved({ d, chambers }: { d: CouncilData; chambers: Group[] }) {
  const G = gov.value!;
  const me = myAddr.value!;
  const label = displayName.value || "member";
  const join = () => act(`Joining ${chambers.map((c) => c.name).join(" and ")}`, (t) => G.batch("group", [
    ...(isIn(d.group, me) ? [] : [["join", [q(d.group.id), q(label)]] as [string, string[]]]),
    ...chambers.flatMap((ch) => [
      ["join", [q(ch.id), q(label)]] as [string, string[]],
      ...(ch.asked.includes(me) ? [["leave", [q(asksId(ch.id))]] as [string, string[]]] : []),
    ]),
  ], t), { risk: "consequential", key: `joinApproved:${chambers.map((c) => c.id).join(",")}`, done: "You're in." });
  return (
    <div class="callout row between" style={{ marginTop: ".8rem" }}>
      <span>You're approved for <b>{chambers.map((c) => c.name).join(" and ")}</b>. Join to take part.</span>
      <button class="primary" onClick={join}>Join</button>
    </div>
  );
}

/** Bring someone new in: pick the person (by name or address) and the stakeholder group. */
function InviteToChamber({ d, admins, onClose, onInvite }: { d: CouncilData; admins: Group[]; onClose: () => void; onInvite: (ch: Group, p: string) => Promise<void> }) {
  const [who, setWho] = useState<string | null>(null);
  const [gid, setGid] = useState(admins[0]?.id ?? d.chambers[0]?.id ?? "");
  const ch = d.chambers.find((c) => c.id === gid);
  const allowed = !!ch && (ch.policy === "open" || admins.some((a) => a.id === ch.id));
  return (
    <Modal title={`Invite someone into ${d.group.name}`} onClose={onClose}
      actions={<><button onClick={onClose}>Cancel</button><button class="primary" disabled={!who || !allowed} onClick={() => { onClose(); onInvite(ch!, who!); }}>Invite</button></>}>
      <div class="stack">
        <PersonField label="Who" onChange={setWho} />
        <label class="field">Stakeholder group
          <select value={gid} onChange={(e) => setGid((e.target as HTMLSelectElement).value)}>{d.chambers.map((c) => <option value={c.id}>{c.name}{c.policy === "invite" ? " (invite only)" : ""}</option>)}</select>
        </label>
        {ch && !allowed && <span class="badge warn">{ch.name} is invite-only and you're not one of its admins.</span>}
        <p class="small muted">They get a message with a link to join. Once they've joined, they show here as waiting, for you to add to decisions.</p>
        {ch?.policy === "invite" && <p class="small muted">For an invite-only group, the invitation writes their address into the group's public state, where anyone can read it. It can't be withdrawn.</p>}
      </div>
    </Modal>
  );
}

function Stakeholders({ d }: { d: CouncilData }) {
  const G = gov.value!;
  const me = myAddr.value;
  const [sel, setSel] = useState<string[]>([]);
  const joinable = d.chambers.filter((ch) => !isIn(ch, me) && (ch.policy === "open" || (!!me && ch.invited.includes(me))));
  // Invite-only and no invitation: ask, and the group's admins approve (WaitingPanel).
  const askable = d.chambers.filter((ch) => !isIn(ch, me) && !joinable.includes(ch) && !isPending(ch, me));
  const label = displayName.value || "member";
  const toJoin = sel.filter((id) => joinable.some((c) => c.id === id));
  const toAsk = sel.filter((id) => askable.some((c) => c.id === id));
  const join = () => {
    const calls: [string, string[]][] = [
      ...(isIn(d.group, me) ? [] : [["join", [q(d.group.id), q(label)]] as [string, string[]]]),
      ...toJoin.flatMap((id) => [["join", [q(id), q(label)]] as [string, string[]], ...(me && d.chambers.find((c) => c.id === id)?.asked.includes(me) ? [["leave", [q(asksId(id))]] as [string, string[]]] : [])]),
      ...toAsk.flatMap((id) => Gov.askCalls(id, label)),
    ];
    setSel([]);
    const what = [toJoin.length ? `Joining ${toJoin.length} stakeholder group${toJoin.length > 1 ? "s" : ""}` : "", toAsk.length ? `asking to join ${toAsk.length}` : ""].filter(Boolean).join(", ");
    return act(what.charAt(0).toUpperCase() + what.slice(1), (t) => G.batch("group", calls, t), {
      risk: "consequential", key: `joinChambers:${sel.join(",")}`,
      done: toAsk.length ? "Done. The facilitator sees your request and approves it; you'll then be asked to join." : "You're in. The facilitator adds you to open votes.",
    });
  };
  const button = [toJoin.length ? `Join ${toJoin.length} group${toJoin.length > 1 ? "s" : ""}` : "", toAsk.length ? `Ask to join ${toAsk.length}` : ""].filter(Boolean).join(" and ");
  return (
    <div class="stack">
      <p class="muted">Belong to every group that describes you — a developer who also holds tokens joins both, and has a voice in each.</p>
      {me && me === (d.weights?.by ?? d.group.admins[0]) && d.chambers.filter((ch) => isIn(ch, me)).length > 1 && (
        <div class="callout warn small">As the council's creator you started out in every stakeholder group. <b>Leave the ones you don't belong to</b>, or your ballot counts in all of them. (Hand admin of invite-only groups to someone in them first.)</div>
      )}
      <div class="grid">
        {d.chambers.map((ch) => {
          const mine = isIn(ch, me);
          const can = joinable.includes(ch);
          const ask = askable.includes(ch);
          const on = sel.includes(ch.id);
          return (
            <div class={`card ${on ? "click" : ""}`} style={on ? { borderColor: "var(--accent)" } : {}}>
              <div class="row between"><h3>{ch.name}</h3>{ch.policy === "invite" ? <span class="badge">invite only</span> : <span class="badge accent">open</span>}</div>
              <div class="muted small">{ch.members.length} member{ch.members.length === 1 ? "" : "s"}</div>
              <div class="row" style={{ marginTop: ".6rem" }}>
                {mine ? <><span class="badge accent">You're a member</span>
                  <button class="ghost small" onClick={() => {
                    const soleAdmin = ch.admins.length === 1 && ch.admins[0] === me;
                    const msg = soleAdmin && ch.policy === "invite"
                      ? `You're the only admin of ${ch.name}, which is invite-only. If you leave, nobody can invite new members. Make someone else an admin first (Members & trust). Leave anyway?`
                      : `Leave ${ch.name}? Your ballots on council decisions will no longer count for this group.`;
                    act(`Leaving ${ch.name}`, (t) => G.leave(ch.id, t), { risk: "irreversible", key: `leaveChamber:${ch.id}`, confirm: msg, done: `You left ${ch.name}.` });
                  }}>Leave</button></>
                  : can || ask ? <label class="row small"><input type="checkbox" style={{ width: "auto" }} checked={on} onChange={() => setSel(on ? sel.filter((x) => x !== ch.id) : [...sel, ch.id])} /> {can ? "I belong here" : "I belong here (ask to join)"}</label>
                  : isPending(ch, me) ? <span class="badge">Asked · pending approval</span>
                  : <span class="muted small">Ask an admin of this group to invite you</span>}
                <a class="small" style={{ marginLeft: "auto" }} href={`#/g/${encodeURIComponent(ch.id)}/members`}>Members & trust →</a>
              </div>
            </div>
          );
        })}
      </div>
      {sel.length > 0 && <div><button class="primary" onClick={join}>{button}</button></div>}
      {toAsk.length > 0 && <p class="small muted">Asking puts your address on the group's request list, which anyone can read. The facilitator approves each request.</p>}
      <Info title="What a stakeholder group is">
        Each stakeholder group is an ordinary rhogov group: its admins invite, its members rate each other's trust, delegate and censure — and all of that applies <b>within</b> that group when a council decision is counted. For an invite-only group (e.g. validators) you ask to join, and its admins approve each request; they can also invite people by name or address.
      </Info>
    </div>
  );
}

function PowerPanel({ d }: { d: CouncilData }) {
  const G = gov.value!;
  const me = myAddr.value;
  const ids = d.chambers.map((c) => c.id);
  const power = chamberPower(ids, d.weights);
  const mine = me && d.weights?.ballots[me] ? parseEstimate(d.weights.ballots[me]) : null;
  const [est, setEst] = useState<Record<string, number>>(() => Object.fromEntries(ids.map((id) => [id, mine?.[id] ?? Math.round(100 / Math.max(1, ids.length))])));
  const tot = Object.values(est).reduce((s, x) => s + x, 0);
  const onRoll = !!me && !!d.weights && (d.weights.voters.includes(me) || d.weights.guests.includes(me));
  const submit = () => act("Submitting your estimate", (t) => G.cast(d.weights!.id, estimateBallot(est), t), { risk: "consequential", key: `castEstimate:${d.weights!.id}`, done: "Your estimate is on chain." });
  return (
    <div class="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
      <div class="card">
        <h2>Current voting power</h2>
        <p class="muted small">{power.estimators ? `The median of ${power.estimators} participant estimate${power.estimators > 1 ? "s" : ""}.` : "Nobody has estimated yet, so every group has equal power."}</p>
        {d.chambers.map((ch) => (
          <div class="result"><span class="opt">{ch.name}</span><div class="bar"><span style={{ width: pct(power.share[ch.id]) }} /></div><b class="small">{pct(power.share[ch.id])}</b></div>
        ))}
        {d.chambers.some((ch) => power.coveredBy[ch.id] < power.estimators) && (
          <p class="muted small">Added after estimates were made: {d.chambers.filter((ch) => power.coveredBy[ch.id] < power.estimators).map((ch) => `${ch.name} (in ${power.coveredBy[ch.id]} of ${power.estimators})`).join(", ")}. An estimate that leaves a group out doesn't count for it; update yours to include it.</p>
        )}
      </div>
      <div class="card stack">
        <h2>Your estimate</h2>
        <p class="muted small">How much impact should each group have on this council's decisions? Only the proportions matter — they're scaled to 100%.</p>
        {d.chambers.map((ch) => (
          <label class="row">
            <span class="grow">{ch.name}</span>
            <input type="range" min={0} max={100} value={est[ch.id]} style={{ width: "45%" }} aria-label={`${ch.name} estimate`}
              onInput={(e) => setEst({ ...est, [ch.id]: Number((e.target as HTMLInputElement).value) })} />
            <span class="small" style={{ width: "3.2rem", textAlign: "right" }}>{tot ? pct(est[ch.id] / tot) : "–"}</span>
          </label>
        ))}
        {onRoll ? <div><button class="primary" disabled={!tot} onClick={submit}>{mine ? "Update my estimate" : "Submit estimate"}</button></div>
          : <p class="callout warn small">{me && d.participants.includes(me) ? "The facilitator needs to add you to the roll first." : "Join a stakeholder group to take part."}</p>}
        <Info title="How the voting power is worked out">Voting power is the <b>median</b> of everyone's estimate for each group, so a few extreme estimates can't swing it. Estimates are public ballots on the council's estimate issue (<span class="mono">{d.weights?.id}</span>); anyone can recompute the median. Footnote [c] of the design doc argues validators should weigh more than other groups because they secure the network — this is where the participants decide how much more.</Info>
      </div>
    </div>
  );
}

function Decisions({ d }: { d: CouncilData }) {
  const me = myAddr.value;
  const [creating, setCreating] = useState(false);
  const facilitator = d.weights?.by ?? d.group.admins[0];
  return (
    <div class="stack">
      <div class="row between">
        <span class="muted">Each decision moves through: {PHASES.map((p) => p.name).join(" → ")}.</span>
        {me === facilitator && <button class="primary" onClick={() => setCreating(true)}>＋ New decision</button>}
      </div>
      {!d.decisions.length && <div class="card soft empty">No decisions yet.{me === facilitator ? " Start one with “New decision”." : ` ${nameOf(facilitator)} facilitates and starts decisions.`}</div>}
      {d.decisions.map((i) => {
        const r = recordOf(i);
        const ph = PHASES.find((p) => p.id === r.phase)!;
        return (
          <div class="card click" onClick={() => go(cHref(d.group.id, "d", i.id))}>
            <div class="row between"><h3 style={{ margin: 0 }}>{i.title}</h3><span class={`badge ${r.phase === "decided" ? "" : "accent"}`}>{ph.name}</span></div>
            <div class="row small muted" style={{ marginTop: ".3rem" }}>
              <span>{i.options.length} options</span><span>· {Object.keys(i.ballots).length} voted</span>
              {me === i.by && i.status !== "closed" && d.participants.some((p) => !i.voters.includes(p)) && <span class="badge warn">{d.participants.filter((p) => !i.voters.includes(p)).length} waiting to take part</span>}
              {r.phase === "decided" && r.winner && <span>· Decided: <b>{r.winner}</b></span>}
              {r.phase === "vote" && me && i.voters.includes(me) && !i.ballots[me] && <span class="badge warn">Your vote is needed</span>}
            </div>
          </div>
        );
      })}
      {creating && <NewDecisionModal d={d} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewDecisionModal({ d, onClose }: { d: CouncilData; onClose: () => void }) {
  const G = gov.value!;
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [opts, setOpts] = useState<string[]>(["", ""]);
  const clean = [...new Set(opts.map((o) => o.trim()).filter(Boolean))];
  const ok = title.trim() && clean.length >= 2;
  const create = async () => {
    const iid = makeId(title);
    onClose();
    const roll = d.participants;
    // One deploy, two issues: the decision itself and its deliberation board.
    const r = await act(`Preparing “${title.trim()}”`, (t) => G.batch("issue", [
      ["open", [q(iid), q(d.group.id), q(title.trim()), q("approval"), qList(clean), qSet(roll)]],
      ["open", [q(argsIssueId(iid)), q(d.group.id), q(context.trim() || title.trim()), q("args"), "[]", qSet(roll)]],
      ["propose", [q(iid), `{"phase": "deliberate"}`]],
    ], t), { risk: "consequential", key: `prepare:${iid}`, done: "Deliberation is open." });
    if (r) go(cHref(d.group.id, "d", iid));
  };
  return (
    <Modal title="New decision" onClose={onClose}
      actions={<><button onClick={onClose}>Cancel</button><button class="primary" disabled={!ok} onClick={create}>Open for deliberation</button></>}>
      <div class="stack">
        <div class="callout small"><b>Prepare.</b> State the problem and the goal clearly, and list real alternatives. People will add pros and cons before anyone votes.</div>
        <label class="field">Question<input autoFocus value={title} placeholder="e.g. Which block-time target for the next release?" onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></label>
        <label class="field">Background and goal
          <span class="hint">What's the problem, what does success look like, what do people need to know?</span>
          <textarea rows={4} value={context} onInput={(e) => setContext((e.target as HTMLTextAreaElement).value)} />
        </label>
        <div class="field"><b>Options</b>
          {opts.map((o, k) => (
            <div class="row">
              <input class="grow" value={o} placeholder={`Option ${k + 1}`} onInput={(e) => setOpts(opts.map((x, j) => (j === k ? (e.target as HTMLInputElement).value : x)))} />
              {opts.length > 2 && <button class="ghost" aria-label="Remove option" onClick={() => setOpts(opts.filter((_, j) => j !== k))}>✕</button>}
            </div>
          ))}
          <div><button class="ghost" onClick={() => setOpts([...opts, ""])}>＋ Add option</button></div>
        </div>
        <p class="muted small">Votes use approval: each person ticks every option they can live with. Each stakeholder group's approvals are weighted by its own trust and delegation, then combined by voting power.</p>
      </div>
    </Modal>
  );
}

// --- a decision ------------------------------------------------------------------------

function DecisionScreen({ d, iid }: { d: CouncilData; iid: string }) {
  const G = gov.value!;
  const a = useAsync(async () => {
    const [i, args] = await Promise.all([G.issue(iid), G.issue(argsIssueId(iid))]);
    if (!i) return null;
    const results: ChamberResult[] = await Promise.all(d.chambers.map(async (ch) => {
      const b = chamberBallots(ch, i.ballots);
      const outcome = Object.keys(b).length ? await G.chamberOutcome(ch.id, iid, b).catch(() => null) : null;
      return { chamber: ch, outcome, share: approvalShare(i.options, outcome), ballots: Object.keys(b).length, members: ch.members.length, votes: approvals(i.options, b) };
    }));
    return { i, args, results };
  }, [G.c.issue, iid, d.group.id]);
  return (
    <Loading a={a}>{() => {
      if (!a.data) return <div class="empty">This decision doesn't exist.</div>;
      return <Decision d={d} {...a.data} />;
    }}</Loading>
  );
}

function Decision({ d, i, args, results }: { d: CouncilData; i: Issue; args: Issue | null; results: ChamberResult[] }) {
  const G = gov.value!;
  const me = myAddr.value;
  const rec = recordOf(i);
  const phaseIx = PHASES.findIndex((p) => p.id === rec.phase);
  const facilitator = me === i.by;
  const power = chamberPower(d.chambers.map((c) => c.id), d.weights);
  const total = combine(i.options, results, power);
  const myChambers = d.chambers.filter((ch) => isIn(ch, me));
  const onRoll = !!me && i.voters.includes(me);
  const [recording, setRecording] = useState(false);
  const [delegIn, setDelegIn] = useState<Group | null>(null);

  const setPhase = (phase: PhaseId) => act(`Moving to “${PHASES.find((p) => p.id === phase)!.name}”`, (t) => G.proposeTerm(i.id, `{"phase": ${q(phase)}}`, t), { risk: "consequential", key: `phase:${i.id}:${phase}` });

  return (
    <div>
      <div class="topline"><span class="crumbs"><a href="#/councils">Councils</a> › <a href={`#${cHref(d.group.id)}`}>{d.group.name}</a> ›</span></div>
      <h1>{i.title}</h1>
      <div class="small muted">Facilitated by {nameOf(i.by)}</div>

      <div class="row section" style={{ gap: ".4rem", marginTop: "1rem" }} aria-label="Phases">
        {PHASES.map((p, k) => (
          <div class={`step ${k < phaseIx ? "done" : k === phaseIx ? "current" : ""}`} style={{ gridTemplateColumns: "30px auto", alignItems: "center", gap: ".4rem" }}>
            <div class="n" style={{ width: 26, height: 26, fontSize: ".8rem" }}>{k < phaseIx ? "✓" : k + 1}</div>
            <span class={k === phaseIx ? "" : "muted"} style={{ fontWeight: k === phaseIx ? 700 : 400 }}>{p.name}</span>
          </div>
        ))}
      </div>
      <p class="muted small">{PHASES[phaseIx].what}</p>
      {me && !onRoll && rec.phase !== "decided" && (
        // Someone who joined after the decision opened can read it but not take part
        // yet: say so, and what happens next, instead of greyed-out buttons (#83).
        <div class="callout warn small section">
          {d.participants.includes(me)
            ? <><b>You're waiting to be added to this decision.</b> You joined after it opened, so you can read it but not add points, endorse or vote yet. {nameOf(i.by)} (the facilitator) sees you on their waiting list and adds people one at a time.</>
            : <><b>You're not taking part in this council yet.</b> Join one of its stakeholder groups first (<a href={`#${cHref(d.group.id, "stakeholders")}`}>stakeholder groups</a>); the facilitator, {nameOf(i.by)}, can then add you to this decision.</>}
        </div>
      )}

      {args?.title && args.title !== i.title && <div class="card soft section" style={{ whiteSpace: "pre-wrap" }}><b>Background</b><div>{args.title}</div></div>}

      {rec.phase === "decided" && <RecordView i={i} rec={rec} args={args} />}

      {facilitator && rec.phase !== "decided" && <WaitingPanel d={d} issues={[i, ...(args ? [args] : [])]} what="this decision" />}

      <div class="section"><Deliberation i={i} args={args} open={rec.phase !== "decided"} /></div>

      {rec.phase === "vote" && (
        <div class="section card">
          <h2>Your vote</h2>
          {!me ? null : !onRoll ? <p class="muted small">You can vote once you're added to this decision (see above).</p> : (
            <>
              <p class="small muted">Your ballot counts in {myChambers.length ? myChambers.map((c) => c.name).join(", ") : "no stakeholder group yet — join one, or it won't count"}.</p>
              <Ballot i={i} />
              {myChambers.length > 0 && (
                <div class="small muted" style={{ marginTop: ".6rem" }}>Can't decide? Hand this vote to someone in
                  {myChambers.map((ch) => <button class="ghost small" onClick={() => setDelegIn(ch)}>{ch.name}</button>)}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {(rec.phase === "vote" || rec.phase === "decided") && <StakeholderResults i={i} results={results} power={power} total={total} />}

      {facilitator && rec.phase !== "decided" && (
        <div class="section card">
          <h3>Facilitator</h3>
          <div class="row">
            {rec.phase === "deliberate" && <button class="primary" onClick={() => setPhase("vote")}>Close deliberation and open voting</button>}
            {rec.phase === "vote" && <button onClick={() => setPhase("deliberate")}>Back to deliberation</button>}
            {rec.phase === "vote" && <button class="primary" onClick={() => setRecording(true)}>Record the decision</button>}

          </div>
        </div>
      )}
      {recording && <RecordModal i={i} total={total} onClose={() => setRecording(false)} />}
      {delegIn && <DelegateModal g={delegIn} issueId={i.id} issueTitle={i.title} onClose={() => setDelegIn(null)} />}
    </div>
  );
}

function Deliberation({ i, args, open }: { i: Issue; args: Issue | null; open: boolean }) {
  const G = gov.value!;
  const me = myAddr.value;
  const [side, setSide] = useState<"pro" | "con">("pro");
  const [opt, setOpt] = useState(i.options[0] ?? "");
  const [text, setText] = useState("");
  if (!args) return null;
  const list = args.options.map(decodeArg).filter((x): x is NonNullable<ReturnType<typeof decodeArg>> => !!x);
  const endorse: Record<string, number> = {};
  for (const b of Object.values(args.ballots)) for (const r of b) endorse[r] = (endorse[r] ?? 0) + 1;
  const mine = (me && args.ballots[me]) || [];
  const canAct = open && !!me && args.voters.includes(me);
  const toggle = (raw: string) => {
    const next = mine.includes(raw) ? mine.filter((x) => x !== raw) : [...mine, raw];
    act(mine.includes(raw) ? "Withdrawing endorsement" : "Endorsing", (t) => G.cast(args.id, next, t), { risk: "routine", key: `endorse:${args.id}` });
  };
  return (
    <div class="card">
      <h2>Pros and cons</h2>
      <p class="muted small">Add the strongest points for and against each option, and endorse the ones you find convincing — whichever way you'll vote.</p>
      {i.options.map((o) => {
        const pros = list.filter((x) => x.option === o && x.side === "pro").sort((a, b) => (endorse[b.raw] ?? 0) - (endorse[a.raw] ?? 0));
        const cons = list.filter((x) => x.option === o && x.side === "con").sort((a, b) => (endorse[b.raw] ?? 0) - (endorse[a.raw] ?? 0));
        const col = (title: string, xs: typeof list, cls: string) => (
          <div class="grow" style={{ minWidth: 220 }}>
            <div class={`badge ${cls}`}>{title}</div>
            {!xs.length && <div class="muted small" style={{ padding: ".4rem 0" }}>None yet.</div>}
            {xs.map((x) => (
              <div class="row small arg" style={{ padding: ".35rem 0", borderBottom: "1px solid var(--line)", flexWrap: "nowrap" }}>
                <span class="grow">{x.text}</span>
                <button class={`small ${mine.includes(x.raw) ? "primary" : ""}`} disabled={!canAct} onClick={() => toggle(x.raw)} title="Endorse">👍 {endorse[x.raw] ?? 0}</button>
              </div>
            ))}
          </div>
        );
        return (
          <div style={{ marginTop: "1rem" }}>
            <h3>{o}</h3>
            <div class="row" style={{ alignItems: "flex-start" }}>{col("For", pros, "accent")}{col("Against", cons, "warn")}</div>
          </div>
        );
      })}
      {canAct && (
        <div class="card soft stack" style={{ marginTop: "1rem" }}>
          <b>Add a point</b>
          <div class="row">
            <div class="seg"><button class={side === "pro" ? "on" : ""} onClick={() => setSide("pro")}>For</button><button class={side === "con" ? "on" : ""} onClick={() => setSide("con")}>Against</button></div>
            <select style={{ width: "auto" }} value={opt} onChange={(e) => setOpt((e.target as HTMLSelectElement).value)}>{i.options.map((o) => <option value={o}>{o}</option>)}</select>
          </div>
          <div class="row">
            <input class="grow" value={text} placeholder="One clear point" onInput={(e) => setText((e.target as HTMLInputElement).value)} />
            <button disabled={!text.trim()} onClick={() => { const t0 = text.trim(); setText(""); act("Adding your point", (t) => G.addOption(args.id, encodeArg(side, opt, t0), t), { risk: "routine", key: `point:${args.id}:${t0}` }); }}>Add</button>
          </div>
        </div>
      )}
    </div>
  );
}

function StakeholderResults({ i, results, power, total }: { i: Issue; results: ChamberResult[]; power: ReturnType<typeof chamberPower>; total: ReturnType<typeof combine> }) {
  const max = Math.max(0.0001, ...Object.values(total.score));
  const votes = approvals(i.options, i.ballots);
  const voters = Object.keys(i.ballots).length;
  const plural = (n: number) => `${n} vote${n === 1 ? "" : "s"}`;
  return (
    <div class="section card">
      <h2>Results by stakeholder group</h2>
      {total.winner ? <div class="callout" style={{ marginBottom: ".8rem" }}>Leading overall: <b>{total.winner}</b></div>
        : total.tie.length ? <div class="callout warn" style={{ marginBottom: ".8rem" }}>Tied: {total.tie.join(", ")}</div> : null}
      {i.options.map((o) => (
        <div class={`result ${o === total.winner ? "win" : ""}`}>
          <span class="opt">{o}</span>
          <div class="bar"><span style={{ width: `${(100 * total.score[o]) / max}%` }} /></div>
          <b class="small">{pct(total.score[o])}</b>
          <span class="small muted votes">{plural(votes[o] ?? 0)}</span>
        </div>
      ))}
      <p class="small muted">{voters} {voters === 1 ? "person has" : "people have"} voted. Vote counts are approvals, one per person per option, before any weighting; the score is weighted.</p>
      <p class="small muted">Overall score = Σ group voting power × that group's weighted approval. A group that hasn't voted adds nothing; its power isn't handed to the others.</p>
      <div class="list small" style={{ marginTop: ".6rem" }}>
        {results.map((r) => (
          <div class="item" style={{ alignItems: "flex-start" }}>
            <div style={{ width: "34%" }}>
              <b>{r.chamber.name}</b>
              <div class="muted">power {pct(power.share[r.chamber.id] ?? 0)} · {r.ballots}/{r.members} voted</div>
              {r.outcome?.winner && <div>Group's choice (node tally): <b>{r.outcome.winner}</b></div>}
            </div>
            <div class="grow">
              {i.options.map((o) => (
                <div class="result" style={{ margin: ".2rem 0" }}><span class="muted">{o}</span><div class="bar"><span style={{ width: pct(r.share[o] ?? 0) }} /></div><span class="muted">{pct(r.share[o] ?? 0)}</span><span class="muted votes">{plural(r.votes[o] ?? 0)}</span></div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Info title="How the node counts each group">Within each stakeholder group the node computes trust levels, applies censures, resolves delegation (only to members of the same group) and weighs each ballot by <span class="mono">rho:gov:*</span> — over that group's members' ballots only. If you're in several groups, your ballot counts in each. The combination across groups is the weighted sum above, from public data anyone can recompute.</Info>
    </div>
  );
}

function RecordModal({ i, total, onClose }: { i: Issue; total: ReturnType<typeof combine>; onClose: () => void }) {
  const G = gov.value!;
  const [winner, setWinner] = useState<string>(total.winner ?? total.tie[0] ?? "");
  const [rationale, setRationale] = useState("");
  const [actions, setActions] = useState("");
  const save = async () => {
    onClose();
    const scores = `{${Object.entries(total.score).map(([k, v]) => `${q(k)}: ${Math.round(v * 1000)}`).join(", ")}}`;
    const acts = qList(actions.split("\n").map((x) => x.trim()).filter(Boolean));
    await act("Recording the decision", (t) => G.batch("issue", [
      ["propose", [q(i.id), `{"phase": "decided", "winner": ${winner ? q(winner) : "Nil"}, "rationale": ${q(rationale.trim())}, "actions": ${acts}, "scores": ${scores}}`]],
      ["close", [q(i.id)]],
      ["close", [q(argsIssueId(i.id))]],
    ], t), {
      risk: "irreversible",
      key: `record:${i.id}`,
      confirm: `Record this decision and close both issues? It cannot be reopened: the decision of record is what the council is held to, and the deliberation closes with it.`,
      done: "Decision of record saved on chain.",
    });
  };
  return (
    <Modal title="Record the decision" onClose={onClose}
      actions={<><button onClick={onClose}>Cancel</button><button class="primary" disabled={!rationale.trim()} onClick={save}>Record and close</button></>}>
      <div class="stack">
        <label class="field">Outcome
          <select value={winner} onChange={(e) => setWinner((e.target as HTMLSelectElement).value)}>
            {total.ranked.map((o) => <option value={o}>{o} — {pct(total.score[o])}{o === total.winner ? " (leading)" : ""}</option>)}
            <option value="">No decision</option>
          </select>
          {winner !== (total.winner ?? "") && <span class="badge warn">This differs from the combined tally — say why in the rationale.</span>}
        </label>
        <label class="field">Rationale<span class="hint">Why this outcome; note any significant dissent.</span>
          <textarea rows={3} value={rationale} onInput={(e) => setRationale((e.target as HTMLTextAreaElement).value)} /></label>
        <label class="field">Action items<span class="hint">One per line — who does what, by when.</span>
          <textarea rows={3} value={actions} onInput={(e) => setActions((e.target as HTMLTextAreaElement).value)} /></label>
        <p class="muted small">Closes voting and deliberation, and stores the record (with the scores) under your name on the decision.</p>
      </div>
    </Modal>
  );
}

function RecordView({ i, rec, args }: { i: Issue; rec: ReturnType<typeof recordOf>; args: Issue | null }) {
  const dissent = (args?.options ?? []).map(decodeArg).filter((x) => x && x.side === "con" && x.option === rec.winner) as { raw: string; text: string }[];
  const endorse = (raw: string) => Object.values(args?.ballots ?? {}).filter((b) => b.includes(raw)).length;
  return (
    <div class="section card" style={{ borderColor: "var(--accent)" }}>
      <h2>Decision of record</h2>
      <div class="callout"><b>{rec.winner ?? "No decision"}</b></div>
      {rec.rationale && <p style={{ marginTop: ".8rem", whiteSpace: "pre-wrap" }}>{rec.rationale}</p>}
      {rec.actions && rec.actions.length > 0 && <><h3>Action items</h3><ul>{rec.actions.map((x) => <li>{x}</li>)}</ul></>}
      {dissent.length > 0 && <><h3>Recorded dissent</h3><ul class="small">{dissent.map((x) => <li>{x.text} <span class="muted">({endorse(x.raw)} endorsed)</span></li>)}</ul></>}
      <p class="small muted">Recorded on chain by <Addr addr={i.by} avatar={false} /> from the voting power as it stood then. The combination is recomputed from live ratings and delegations, so it can read differently later with the record untouched — this is what the council decided. Ballots and arguments stay public for review.</p>
    </div>
  );
}

// --- adding a stakeholder group to a council that already exists ------------------------

/**
 * The facilitator adds a chamber after the council started: one group deploy
 * creates `<councilId>.<slug>`, one issue deploy names it among the estimate's
 * options, the same two writes "New council" makes. Estimates already cast don't
 * name it, so its power comes from the estimates that do (chamberPower).
 */
function AddStakeholderGroup({ d }: { d: CouncilData }) {
  const me = myAddr.value;
  const [adding, setAdding] = useState(false);
  if (!me || me !== (d.weights?.by ?? d.group.admins[0])) return null;
  return (
    <div style={{ marginTop: ".8rem" }}>
      <button onClick={() => setAdding(true)}>＋ Add a stakeholder group</button>
      {adding && <AddStakeholderGroupModal d={d} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddStakeholderGroupModal({ d, onClose }: { d: CouncilData; onClose: () => void }) {
  const G = gov.value!;
  const cid = d.group.id;
  const taken = new Set(d.chambers.map((ch) => ch.id));
  const takenName = new Set(d.chambers.map((ch) => ch.name.trim().toLowerCase()));
  const suggested = STAKEHOLDERS.filter((s) => !taken.has(chamberId(cid, s.slug)) && !takenName.has(s.name.toLowerCase()));
  const [pick, setPick] = useState(suggested[0]?.slug ?? "");
  const [cname, setCname] = useState("");
  const [policy, setPolicy] = useState<"open" | "invite">(suggested[0]?.policy ?? "open");
  const custom = pick === "";
  const name = custom ? cname.trim() : suggested.find((s) => s.slug === pick)!.name;
  const dup = !!name && takenName.has(name.toLowerCase());
  const ok = !!name && !dup;
  const estimated = d.weights ? Object.keys(d.weights.ballots).length : 0;
  const add = async () => {
    const slug = custom ? makeId(name).replace(/[^a-z0-9-]/g, "") : pick;
    const gid = chamberId(cid, slug);
    onClose();
    const made = await act(`Adding ${name} to ${d.group.name}`, (t) => G.batch("group", [["create", [q(gid), q(name), q(policy)]]], t),
      { risk: "consequential", key: `addChamber:${gid}`, done: `${name} is a stakeholder group of ${d.group.name}.` });
    if (!made || d.weights?.status !== "open") return;
    await act(`Adding ${name} to the voting-power estimates`, (t) => G.addOption(d.weights!.id, gid, t),
      { risk: "consequential", key: `addOption:${d.weights.id}:${gid}`, done: "Participants can now estimate its voting power." });
  };
  return (
    <Modal title={`Add a stakeholder group to ${d.group.name}`} onClose={onClose}
      actions={<><button onClick={onClose}>Cancel</button><button class="primary" disabled={!ok} onClick={add}>Add group</button></>}>
      <div class="stack">
        <div class="field"><b>Which group</b>
          {suggested.map((s) => (
            <label class={`choice ${pick === s.slug ? "on" : ""}`}>
              <input type="radio" name="chamber" checked={pick === s.slug} onChange={() => { setPick(s.slug); setPolicy(s.policy); }} />
              <div><b>{s.name}</b><div class="muted small">{s.blurb}</div></div>
            </label>
          ))}
          <label class={`choice ${custom ? "on" : ""}`}>
            <input type="radio" name="chamber" checked={custom} onChange={() => { setPick(""); setPolicy("open"); }} />
            <input class="grow" placeholder="Another stakeholder group" value={cname} onFocus={() => setPick("")} onInput={(e) => setCname((e.target as HTMLInputElement).value)} />
          </label>
          {dup && <span class="badge warn">{d.group.name} already has a group called {name}.</span>}
        </div>
        <label class="row small"><input type="checkbox" style={{ width: "auto" }} checked={policy === "invite"} onChange={() => setPolicy(policy === "invite" ? "open" : "invite")} /> Invite only (for stakeholders whose standing should be checked, e.g. validators)</label>
        <p class="muted small">You become its first admin and member. If you don't belong to it, leave it once someone else can admin it, or your ballot counts there too.</p>
        <p class="muted small">
          {estimated
            ? `The ${estimated} voting-power estimate${estimated > 1 ? "s" : ""} already made don't include it, so until people update theirs its power is the median of the estimates that do — none at first, so it starts at 0%. Its members can vote in open decisions once you add them, but their group's votes carry no weight until someone estimates its power.`
            : "Nobody has estimated voting power yet, so it starts with an equal share like the others."}
          {" "}Two deploys: one creates the group, one adds it to the voting-power estimates.
        </p>
      </div>
    </Modal>
  );
}
