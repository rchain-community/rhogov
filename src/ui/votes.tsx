// votes.tsx — issues: create, cast (approval or ranked), and see the node's weighted result.
import { useState } from "preact/hooks";
import { type Group, type Issue, type Outcome, makeId } from "../chain/gov";
import { gov, myAddr } from "../state";
import { DelegateModal, learnFrom } from "./groups";
import { isCouncilId } from "../chain/council";
import { Addr, Info, Loading, Modal, act, go, nameOf, useAsync } from "./kit";

const STATUS: Record<Issue["status"], [string, string]> = {
  open: ["Voting open", "accent"],
  locked: ["Paused", "warn"],
  closed: ["Closed", ""],
};

export const issueHref = (gid: string, iid: string) =>
  isCouncilId(gid) ? `/c/${encodeURIComponent(gid)}/d/${encodeURIComponent(iid)}` : `/v/${encodeURIComponent(gid)}/${encodeURIComponent(iid)}`;

export function IssueCard({ i, g }: { i: Issue; g?: Group }) {
  const me = myAddr.value;
  const voted = !!me && !!i.ballots[me];
  const onRoll = !!me && (i.voters.includes(me) || i.guests.includes(me));
  const recorded = Object.values(i.results)[0];
  return (
    <div class="card click" onClick={() => go(issueHref(i.gid, i.id))}>
      <div class="row between">
        <h3 style={{ margin: 0 }}>{i.title}</h3>
        <span class={`badge ${STATUS[i.status][1]}`}>{STATUS[i.status][0]}</span>
      </div>
      <div class="row small muted" style={{ marginTop: ".3rem" }}>
        {g && <span>{g.name}</span>}
        <span>{i.mode === "ranked" ? "Ranked choice" : "Approval"}</span>
        <span>{Object.keys(i.ballots).length}/{i.voters.length} voted</span>
        {i.status === "open" && onRoll && (voted ? <span class="badge accent">You voted</span> : <span class="badge warn">Your vote is needed</span>)}
        {i.status === "closed" && typeof recorded === "string" && <span>Result: <b>{recorded}</b></span>}
      </div>
    </div>
  );
}

export function NewIssueModal({ g, onClose }: { g: Group; onClose: () => void }) {
  const G = gov.value!;
  const [title, setTitle] = useState("");
  const [opts, setOpts] = useState<string[]>(["", ""]);
  const [mode, setMode] = useState<"approval" | "ranked">("approval");
  const clean = [...new Set(opts.map((o) => o.trim()).filter(Boolean))];
  const ok = title.trim() && clean.length >= 2;
  const create = async () => {
    const iid = makeId(title);
    onClose();
    const roll = g.members.map((m) => m.addr);
    const r = await act(`Opening “${title.trim()}”`, (t) => G.openIssue(iid, g.id, title.trim(), mode, clean, roll, t), { done: "The vote is open." });
    if (r) go(issueHref(g.id, iid));
  };
  return (
    <Modal title="New vote" onClose={onClose}
      actions={<><button onClick={onClose}>Cancel</button><button class="primary" disabled={!ok} onClick={create}>Open vote</button></>}>
      <div class="stack">
        <label class="field">Question<input autoFocus value={title} placeholder="e.g. Which venue for the spring meetup?" onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></label>
        <div class="field"><b>Options</b>
          {opts.map((o, k) => (
            <div class="row">
              <input class="grow" value={o} placeholder={`Option ${k + 1}`} onInput={(e) => setOpts(opts.map((x, j) => (j === k ? (e.target as HTMLInputElement).value : x)))} />
              {opts.length > 2 && <button class="ghost" aria-label="Remove option" onClick={() => setOpts(opts.filter((_, j) => j !== k))}>✕</button>}
            </div>
          ))}
          <div><button class="ghost" onClick={() => setOpts([...opts, ""])}>＋ Add option</button></div>
        </div>
        <div class="stack">
          <label class={`choice ${mode === "approval" ? "on" : ""}`}><input type="radio" checked={mode === "approval"} onChange={() => setMode("approval")} />
            <div><b>Approval</b><div class="muted small">Tick every option you're happy with. Most approval wins.</div></div></label>
          <label class={`choice ${mode === "ranked" ? "on" : ""}`}><input type="radio" checked={mode === "ranked"} onChange={() => setMode("ranked")} />
            <div><b>Ranked choice</b><div class="muted small">Put options in order of preference. Instant-runoff picks the winner.</div></div></label>
        </div>
        <p class="muted small">All {g.members.length} current members can vote. Anyone can suggest more options while voting is open.</p>
      </div>
    </Modal>
  );
}

// --- the issue page --------------------------------------------------------------

export function IssueScreen({ gid, iid }: { gid: string; iid: string }) {
  const G = gov.value!;
  const a = useAsync(async () => {
    const [i, g, out] = await Promise.all([G.issue(iid), G.group(gid), G.outcome(gid, iid)]);
    if (g) learnFrom([g]);
    return { i, g, out };
  }, [G.c.issue, gid, iid]);
  return (
    <Loading a={a}>{() => {
      const { i, g, out } = a.data!;
      if (!i || !g) return <div class="empty">This vote doesn't exist. <a href="#/groups">Back to groups</a></div>;
      return <IssueView i={i} g={g} out={out} />;
    }}</Loading>
  );
}

function IssueView({ i, g, out }: { i: Issue; g: Group; out: Outcome }) {
  const G = gov.value!;
  const me = myAddr.value;
  const onRoll = !!me && (i.voters.includes(me) || i.guests.includes(me));
  const isOpener = me === i.by;
  const member = !!me && g.members.some((m) => m.addr === me);
  const missing = g.members.map((m) => m.addr).filter((a) => !i.voters.includes(a));
  const [delegating, setDelegating] = useState(false);
  const [adding, setAdding] = useState("");
  const topicDelegate = me ? g.topic[i.id]?.[me] : undefined;
  const standingDelegate = me ? g.deleg[me] : undefined;

  const closeAndRecord = async () => {
    if (!confirm("Close voting? No more ballots can be cast. The node's tally will be recorded as the result under your name.")) return;
    const closed = await act("Closing the vote", (t) => G.close(i.id, t), { done: "Voting closed." });
    if (closed) await act("Recording the result", (t) => G.propose(i.id, out.winner, t), { done: out.winner ? `Recorded: ${out.winner}` : "Recorded: no winner." });
  };

  return (
    <div>
      <div class="topline"><span class="crumbs"><a href="#/groups">Groups</a> › <a href={`#/g/${encodeURIComponent(g.id)}`}>{g.name}</a> ›</span></div>
      <div class="row between">
        <h1 style={{ margin: 0 }}>{i.title}</h1>
        <span class={`badge ${STATUS[i.status][1]}`}>{STATUS[i.status][0]}</span>
      </div>
      <div class="row small muted" style={{ margin: ".4rem 0 1rem" }}>
        <span>Opened by {nameOf(i.by)}</span>
        <span>· {i.mode === "ranked" ? "Ranked choice" : "Approval voting"}</span>
        <span>· {Object.keys(i.ballots).length} of {i.voters.length} voted</span>
      </div>

      <div class="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
        <div class="card">
          <h2>{i.status === "open" ? (me && i.ballots[me] ? "Your vote (you can change it)" : "Cast your vote") : "Ballot"}</h2>
          {i.status !== "open" ? <p class="muted">Voting is {i.status === "closed" ? "closed" : "paused"}.</p>
            : !me ? <p class="muted">Set up your identity to vote.</p>
            : !onRoll ? (
              <div class="callout warn small">
                {member ? <>You joined {g.name} after this vote opened, so you're not on its roll yet. {nameOf(i.by)} can refresh the roll to include you.</>
                  : <>Only members of {g.name} can vote. <a href={`#/g/${encodeURIComponent(g.id)}`}>Join the group</a> first.</>}
              </div>
            ) : <Ballot i={i} />}
          {i.status === "open" && onRoll && (
            <div class="small muted" style={{ marginTop: ".9rem" }}>
              {me && i.ballots[me] ? "Your direct vote overrides any delegation."
                : topicDelegate ? <>Until you vote, {nameOf(topicDelegate)} carries your vote here.</>
                : standingDelegate ? <>Until you vote, {nameOf(standingDelegate)} (your delegate) carries your vote.</>
                : "If you don't vote and haven't delegated, your weight goes unused."}
              {" "}<button class="ghost small" onClick={() => setDelegating(true)}>{topicDelegate ? "Change delegate for this vote" : "Delegate this vote"}</button>
              {topicDelegate && <button class="ghost small" onClick={() => act("Removing delegation for this vote", (t) => G.undelegate(g.id, i.id, t))}>Remove</button>}
            </div>
          )}
        </div>

        <Results i={i} out={out} />
      </div>

      {i.status === "open" && member && (
        <div class="section card soft">
          <div class="row">
            <input class="grow" placeholder="Suggest another option" value={adding} onInput={(e) => setAdding((e.target as HTMLInputElement).value)} />
            <button disabled={!adding.trim() || i.options.includes(adding.trim())} onClick={() => { const o = adding.trim(); setAdding(""); act(`Adding “${o}”`, (t) => G.addOption(i.id, o, t)); }}>Add option</button>
          </div>
        </div>
      )}

      {isOpener && i.status !== "closed" && (
        <div class="section card">
          <h3>You opened this vote</h3>
          <div class="row">
            {missing.length > 0 && <button onClick={() => act("Refreshing the voter roll", (t) => G.setRoll(i.id, g.members.map((m) => m.addr), t), { done: `${missing.length} new member${missing.length > 1 ? "s" : ""} can now vote.` })}>Add {missing.length} new member{missing.length > 1 ? "s" : ""} to the roll</button>}
            <button class="primary" onClick={closeAndRecord}>Close voting and record result</button>
          </div>
        </div>
      )}
      {delegating && <DelegateModal g={g} issueId={i.id} issueTitle={i.title} onClose={() => setDelegating(false)} />}
    </div>
  );
}

export function Ballot({ i }: { i: Issue }) {
  const G = gov.value!;
  const me = myAddr.value!;
  const prior = i.ballots[me] ?? [];
  const [picked, setPicked] = useState<string[]>(prior);
  const changed = JSON.stringify(picked) !== JSON.stringify(prior);
  const submit = () => act(prior.length ? "Changing your vote" : "Casting your vote", (t) => G.cast(i.id, picked, t), { done: "Your ballot is on chain." });

  if (i.mode === "approval") {
    return (
      <div class="stack">
        <span class="muted small">Tick every option you'd be happy with.</span>
        {i.options.map((o) => {
          const on = picked.includes(o);
          return (
            <label class={`choice ${on ? "on" : ""}`}>
              <input type="checkbox" checked={on} onChange={() => setPicked(on ? picked.filter((x) => x !== o) : [...picked, o])} />
              <b>{o}</b>
            </label>
          );
        })}
        <div><button class="primary" disabled={!picked.length || !changed} onClick={submit}>{prior.length ? "Update my vote" : "Vote"}</button></div>
      </div>
    );
  }
  const rest = i.options.filter((o) => !picked.includes(o));
  const move = (k: number, d: number) => { const n = [...picked]; [n[k], n[k + d]] = [n[k + d], n[k]]; setPicked(n); };
  return (
    <div class="stack">
      <span class="muted small">Pick options in order of preference — first is your favourite. You don't have to rank them all.</span>
      <div class="rank">
        {picked.map((o, k) => (
          <div class="r">
            <span class="pos">{k + 1}</span><span class="grow">{o}</span>
            <button class="ghost small" aria-label="Move up" disabled={k === 0} onClick={() => move(k, -1)}>↑</button>
            <button class="ghost small" aria-label="Move down" disabled={k === picked.length - 1} onClick={() => move(k, 1)}>↓</button>
            <button class="ghost small" aria-label="Remove" onClick={() => setPicked(picked.filter((x) => x !== o))}>✕</button>
          </div>
        ))}
        {rest.map((o) => (
          <div class="r off">
            <span class="pos">–</span><span class="grow">{o}</span>
            <button class="small" onClick={() => setPicked([...picked, o])}>Rank {picked.length + 1}{["st", "nd", "rd"][picked.length] ?? "th"}</button>
          </div>
        ))}
      </div>
      <div><button class="primary" disabled={!picked.length || !changed} onClick={submit}>{prior.length ? "Update my vote" : "Vote"}</button></div>
    </div>
  );
}

function Results({ i, out }: { i: Issue; out: Outcome }) {
  // Per-option bars are shown for orientation; the WINNER is the node's own
  // rho:gov:tally over the same ballots and weights.
  const score: Record<string, number> = Object.fromEntries(i.options.map((o) => [o, 0]));
  for (const [voter, choices] of Object.entries(out.ballots)) {
    const w = out.weights[voter] ?? 0;
    if (out.mode === "ranked") { if (choices[0] in score) score[choices[0]] += w; }
    else for (const c of choices) if (c in score) score[c] += w;
  }
  const total = Object.values(out.weights).reduce((x, y) => x + y, 0);
  const max = Math.max(1, ...Object.values(score));
  const voters = Object.keys(out.ballots);
  const recorded = Object.entries(i.results);
  return (
    <div class="card">
      <h2>{i.status === "closed" ? "Result" : "Standing so far"}</h2>
      {!voters.length ? <p class="muted">No ballots yet.</p> : (
        <>
          {out.winner && <div class="callout" style={{ marginBottom: ".8rem" }}>{i.status === "closed" ? "Winner" : "Leading"}: <b>{out.winner}</b> <span class="muted small">— tallied by the node</span></div>}
          {i.options.map((o) => (
            <div class={`result ${o === out.winner ? "win" : ""}`}>
              <span class="opt">{o}</span>
              <div class="bar"><span style={{ width: `${(100 * score[o]) / max}%` }} /></div>
              <span class="small muted">{score[o]}</span>
            </div>
          ))}
          <p class="small muted">{out.mode === "ranked" ? "Bars show weighted first preferences; the winner is found by instant runoff." : "Bars show weighted approvals."} Total weight cast: {total}.</p>
        </>
      )}
      <details>
        <summary>Who voted, and with what weight</summary>
        <div class="list small" style={{ marginTop: ".4rem" }}>
          {voters.map((v) => (
            <div class="item"><span class="grow"><Addr addr={v} avatar={false} /></span><span class="muted">{out.ballots[v].join(" › ")}</span><b>×{out.weights[v] ?? 0}</b></div>
          ))}
        </div>
        <p class="small muted">Ballots are public on chain. A weight includes every member whose vote was delegated to this voter{out.trustActive ? ", and each member counts 1 + their trust level" : ""}.</p>
      </details>
      {recorded.length > 0 && (
        <div class="small" style={{ marginTop: ".8rem" }}>
          {recorded.map(([by, r]) => {
            const agrees = r === out.winner;
            return <div>Recorded by {nameOf(by)}: <b>{String(r ?? "no winner")}</b> {agrees ? <span class="badge accent">matches the node's tally</span> : <span class="badge danger">differs from the node's tally</span>}</div>;
          })}
        </div>
      )}
      <Info>
        Nobody counts these votes by hand — not the opener, not this app. The ballots, delegations and trust ratings are public facts in the Group and Issue contracts, and this page asks the node to run its built-in functions over them (<span class="mono">trustLevels → censure → resolveWeights → tally</span>). Anyone can repeat the same query and must get the same answer. A recorded result is a claim by whoever recorded it; the badge shows whether it matches.
      </Info>
    </div>
  );
}
