// settings.tsx — account (key, name, balance) and community (invite link, contracts, switching).
import { useEffect, useState } from "preact/hooks";
import { generateKey } from "../chain/keys";
import {
  NETWORKS, active, addCommunity, communities, communityKey, displayName, inviteLink, myAddr, parseInvite, removeCommunity,
  reviewBeforeSign, secretKey, setActive, setDisplayName, setKey, setReview,
} from "../state";
import { Copy, Modal, go, short } from "./kit";
import { Balance, setSetupNode, setupNode } from "./setup";
import { sameName } from "../chain/gov";
import { nameError } from "../chain/people";
import { GUIDE } from "./help";
import { nameProblem, syncMyName } from "./name-sync";

export function AccountScreen() {
  const [reveal, setReveal] = useState(false);
  const [name, setName] = useState(displayName.value);
  // The key's own name can arrive after the screen opens (it's looked up on chain).
  useEffect(() => { setName(displayName.value); }, [displayName.value]);
  const bad = name.trim() ? nameError(name) : "";
  const addr = myAddr.value;
  const c = active.value;
  const backup = () => {
    const blob = new Blob([`rhogov key backup\naddress: ${addr}\nprivate key: ${secretKey.value}\n\nAnyone with this key can act as you. Keep it offline.\n`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rhogov-key-${addr?.slice(0, 10)}.txt`;
    a.click();
  };
  if (!addr) return <div class="empty">No identity yet. <a href="#/welcome">Set one up</a></div>;
  return (
    <div class="stack" style={{ maxWidth: 720 }}>
      <h1>Account</h1>
      <div class="card stack">
        <label class="field">Your name
          <span class="hint">What everyone calls you, set by your key alone (it comes with your key to any device; capitals count; it can't start with a number): in the chain's name directory where it has one, otherwise on this community's name list. Unique within the community.</span>
          <div class="row"><input class="grow" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            <button disabled={name.trim() === displayName.value || !name.trim() || !!bad} onClick={() => { setDisplayName(name.trim()); syncMyName(true); }}>Save</button></div>
          {bad && <span class="badge danger">{bad}</span>}
        </label>
        {nameProblem.value && sameName(nameProblem.value.name, displayName.value) && (
          <div class="callout warn small">
            <b>Someone else in this community has claimed “{nameProblem.value.name}”</b>, so others see you as “{nameProblem.value.name} (unclaimed)”. Choose another name above. If that's another key of yours (one you used before on some device), sign in with that key to rename it, then come back to this one.
          </div>
        )}
        <div><b>Your address</b> <span class="muted small">— share it so people can invite you or message you</span>
          <div class="row"><span class="mono">{addr}</span><Copy text={addr} /></div></div>
        {c && <div><b>Balance</b> on {c.name}'s network<div><Balance node={c.node} addr={addr} /></div></div>}
      </div>
      <div class="card stack">
        <h2>Your key</h2>
        <p class="muted small">Your private key is stored only in this browser. It signs every action you take. If you clear site data without a backup, it's gone — and so is this identity.</p>
        <div class="row">
          <button onClick={backup}>Download backup</button>
          <button onClick={() => setReveal(!reveal)}>{reveal ? "Hide key" : "Show key"}</button>
          <button class="danger" onClick={() => { if (confirm("Remove this key from this browser? Without a backup you lose this identity.")) { setKey(null); go("/welcome"); } }}>Remove from this browser</button>
        </div>
        {reveal && <div class="callout warn small"><b>Anyone with this key can act as you.</b><div class="row"><span class="mono">{secretKey.value}</span><Copy text={secretKey.value!} /></div></div>}
      </div>
      <div class="card stack">
        <h2>Signing</h2>
        <label class="row"><input type="checkbox" style={{ width: "auto" }} checked={reviewBeforeSign.value} onChange={(e) => setReview((e.target as HTMLInputElement).checked)} />
          Show me the exact rholang before I sign each action</label>
        <p class="small muted">Anything that moves trust, membership, voting weight or money is shown before it is signed. Routine housekeeping — putting your name on the community's list, sending a message — signs without asking, so it can happen quietly in the background.</p>
      </div>
    </div>
  );
}

export function CommunityScreen() {
  const c = active.value;
  const [paste, setPaste] = useState(false);
  if (!c) return <div class="empty">No community yet. <a href="#/welcome">Join or start one</a></div>;
  const link = inviteLink(c);
  return (
    <div class="stack" style={{ maxWidth: 720 }}>
      <h1>Community</h1>
      <div class="card stack">
        <h2>Invite people</h2>
        <p class="muted small">Send this link. It tells their browser which network and which governance contracts {c.name} uses — nothing secret is in it. They create their own key when they open it.</p>
        <div class="row"><input class="mono grow" readOnly value={link} onFocus={(e) => (e.target as HTMLInputElement).select()} /><Copy text={link} label="Copy invite link" /></div>
      </div>
      {/* Contract addresses and the raw node URL are for someone wiring rhogov to a room
          or a node, not for the everyday surface. Kept, unchanged, one click in (#47). */}
      <details class="card small">
        <summary>Where {c.name} lives, and entering contracts by hand</summary>
        <div class="stack small" style={{ marginTop: ".6rem" }}>
          <div><b>Network</b> <span class="mono">{c.node}</span></div>
          <div><b>Inbox contract</b> <span class="mono">{c.inbox}</span> <Copy text={c.inbox} /></div>
          <div><b>Group contract</b> <span class="mono">{c.group}</span> <Copy text={c.group} /></div>
          <div><b>Issue contract</b> <span class="mono">{c.issue}</span> <Copy text={c.issue} /></div>
          <p class="muted">These are quantum-os <b>rgov-core</b> contracts. A quantum-os room can use the same ones with <span class="mono">/gov chain inbox|group|issue &lt;uri&gt;</span>, so a group pushed from a room shows up here and vice versa.</p>
          <div><button class="small" onClick={() => setPaste(true)}>Enter contract addresses by hand</button></div>
        </div>
      </details>
      {communities.value.length > 1 && (
        <div class="card stack">
          <h2>Switch community</h2>
          {communities.value.map((x) => (
            <div class="row between">
              <span><b>{x.name}</b> <span class="muted small mono">{short(x.group)}</span></span>
              <div class="row">
                {communityKey(x) === communityKey(c) ? <span class="badge accent">current</span> : <button class="small" onClick={() => { setActive(communityKey(x)); go("/"); }}>Switch</button>}
                <button class="small ghost danger" onClick={() => confirm(`Forget ${x.name} in this browser? Nothing on chain changes.`) && removeCommunity(x)}>Forget</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div class="row">
        <button onClick={() => go("/welcome")}>Join or start another community</button>
      </div>
      {paste && <ManualCommunity onClose={() => setPaste(false)} />}
    </div>
  );
}

function ManualCommunity({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState({ name: "", node: active.value?.node ?? "", inbox: "", group: "", issue: "" });
  const ok = v.name && /^https?:\/\//.test(v.node) && [v.inbox, v.group, v.issue].every((u) => /^rho:id:[a-z0-9]+$/.test(u.trim()));
  const f = (k: keyof typeof v, label: string, ph: string) => (
    <label class="field">{label}<input class={k === "name" ? "" : "mono"} placeholder={ph} value={v[k]} onInput={(e) => setV({ ...v, [k]: (e.target as HTMLInputElement).value.trim() })} /></label>
  );
  return (
    <Modal title="Use existing contracts" onClose={onClose}
      actions={<><button onClick={onClose}>Cancel</button><button class="primary" disabled={!ok} onClick={() => { addCommunity(v); onClose(); go("/"); }}>Add</button></>}>
      <div class="stack">
        <p class="muted small">For contracts installed elsewhere — e.g. by <span class="mono">/gov chain install</span> in a quantum-os room.</p>
        {f("name", "Name", "e.g. Our room's governance")}
        {f("node", "Node URL", "https://…")}
        {f("inbox", "Inbox contract", "rho:id:…")}
        {f("group", "Group contract", "rho:id:…")}
        {f("issue", "Issue contract", "rho:id:…")}
      </div>
    </Modal>
  );
}

/**
 * Networks this browser has chosen for itself: the built-in ones, the one picked
 * in setup, and those of communities already joined. An invite is just a link,
 * and it can name any host; everything you do in its community is signed and
 * sent there, so a host you never chose is called out before you go on (#30).
 */
function familiarNode(node: string): boolean {
  const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  const known = [...NETWORKS.map((n) => n.url), setupNode.value, ...communities.value.map((c) => c.node)].map(norm);
  return known.includes(norm(node));
}

export function JoinScreen({ query }: { query: URLSearchParams }) {
  const c = parseInvite(`?c=${query.get("c") ?? ""}`);
  const [trusted, setTrusted] = useState(false);
  if (!c) return <DamagedInvite />;
  const known = communities.value.some((x) => communityKey(x) === communityKey(c));
  const foreign = !known && !familiarNode(c.node);
  const accept = () => {
    addCommunity(c);
    // The invite answers the network (and the community): setup asks only for a name and key.
    setSetupNode(c.node);
    if (!myAddr.value) { setKey(null); go("/welcome"); }
    else go("/groups");
  };
  return (
    <div class="stack" style={{ maxWidth: 560 }}>
      <h1>You're invited to {c.name}</h1>
      <div class="card stack">
        <p>{c.name} makes decisions together on RChain with rhogov: groups, votes, delegation and trust — all recorded on chain.</p>
        {foreign ? (
          <div class="callout warn stack">
            <b>This invite points to a network you didn't choose: <span class="mono">{c.node}</span></b>
            <span class="small">It isn't one of rhogov's networks, and you haven't used it before. Everything you do in {c.name} would be signed by your key and sent to that address. Whoever runs it sees your actions and decides what you're shown. Only join a network you recognise, from someone you trust.</span>
            <label class="row small"><input type="checkbox" style={{ width: "auto" }} checked={trusted} onChange={(e) => setTrusted((e.target as HTMLInputElement).checked)} /> I recognise this network and trust whoever sent the invite</label>
          </div>
        ) : <div class="small muted">Network: <span class="mono">{c.node}</span></div>}
        <div>{known ? <button class="primary" onClick={() => { setActive(communityKey(c)); go("/"); }}>Open {c.name}</button>
          : <button class="primary" disabled={foreign && !trusted} onClick={accept}>{myAddr.value ? `Join ${c.name}` : "Get started"}</button>}</div>
        {!myAddr.value && <p class="muted small">Next you'll pick a name and get a key — it takes a few seconds and stays in this browser.</p>}
      </div>
    </div>
  );
}

/**
 * An invite link that doesn't decode (cut off when pasted, wrapped in an email,
 * a character lost): say so, and give somewhere to go from here, since the menu
 * isn't shown to someone without a key or community yet (#15).
 */
function DamagedInvite() {
  const [manual, setManual] = useState(false);
  return (
    <div class="stack" style={{ maxWidth: 560 }}>
      <h1>This invite link is damaged</h1>
      <div class="card stack">
        <p>Part of the link is missing or changed, so rhogov can't tell which community it's for. This usually happens when a long link is cut off or wrapped while being pasted or emailed.</p>
        <ul class="stack small" style={{ paddingLeft: "1.1rem", margin: 0 }}>
          <li><b>Ask for a fresh link</b>, ideally sent as one unbroken line (a chat message, not wrapped email text), and open that instead.</li>
          <li><b>Have the community's three contract addresses?</b> <a href="#" onClick={(e) => { e.preventDefault(); setManual(true); }}>Enter contract addresses by hand</a>.</li>
          <li><b>Want your own?</b> <a href="#/welcome">Start your own community</a>.</li>
          {active.value && <li><a href="#/">Back to {active.value.name}</a></li>}
          <li>New to rhogov? <a href={GUIDE} target="_blank" rel="noopener">Read the user guide</a>.</li>
        </ul>
      </div>
      {manual && <ManualCommunity onClose={() => setManual(false)} />}
    </div>
  );
}

export { generateKey };
