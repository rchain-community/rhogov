// settings.tsx — account (key, name, balance) and community (invite link, contracts, switching).
import { useState } from "preact/hooks";
import { generateKey } from "../chain/keys";
import {
  active, addCommunity, communities, communityKey, displayName, inviteLink, myAddr, parseInvite, removeCommunity,
  reviewBeforeSign, secretKey, setActive, setDisplayName, setKey, setReview,
} from "../state";
import { Copy, Modal, go, short } from "./kit";
import { Balance } from "./setup";
import { syncMyName } from "./name-sync";

export function AccountScreen() {
  const [reveal, setReveal] = useState(false);
  const [name, setName] = useState(displayName.value);
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
          <span class="hint">What everyone sees instead of your address, set by your key alone: in the chain's name directory where it has one, otherwise on this community's name list. Unique within the community.</span>
          <div class="row"><input class="grow" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            <button disabled={name.trim() === displayName.value || !name.trim()} onClick={() => { setDisplayName(name.trim()); syncMyName(true); }}>Save</button></div>
        </label>
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
      <div class="card stack small">
        <h2>Where {c.name} lives</h2>
        <div><b>Network</b> <span class="mono">{c.node}</span></div>
        <div><b>Inbox contract</b> <span class="mono">{c.inbox}</span> <Copy text={c.inbox} /></div>
        <div><b>Group contract</b> <span class="mono">{c.group}</span> <Copy text={c.group} /></div>
        <div><b>Issue contract</b> <span class="mono">{c.issue}</span> <Copy text={c.issue} /></div>
        <p class="muted">These are quantum-os <b>rgov-core</b> contracts. A quantum-os room can use the same ones with <span class="mono">/gov chain inbox|group|issue &lt;uri&gt;</span>, so a group pushed from a room shows up here and vice versa.</p>
      </div>
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
        <button onClick={() => setPaste(true)}>Enter contract addresses by hand</button>
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

export function JoinScreen({ query }: { query: URLSearchParams }) {
  const c = parseInvite(`?c=${query.get("c") ?? ""}`);
  if (!c) return <div class="empty">This invite link is incomplete or damaged. Ask for a fresh one.</div>;
  const known = communities.value.some((x) => communityKey(x) === communityKey(c));
  const accept = () => {
    addCommunity(c);
    if (!myAddr.value) { localStorage.setItem("rhogov:setupNode", c.node); setKey(null); go("/welcome"); }
    else go("/groups");
  };
  return (
    <div class="stack" style={{ maxWidth: 560 }}>
      <h1>You're invited to {c.name}</h1>
      <div class="card stack">
        <p>{c.name} makes decisions together on RChain with rhogov: groups, votes, delegation and trust — all recorded on chain.</p>
        <div class="small muted">Network: <span class="mono">{c.node}</span></div>
        <div>{known ? <button class="primary" onClick={() => { setActive(communityKey(c)); go("/"); }}>Open {c.name}</button>
          : <button class="primary" onClick={accept}>{myAddr.value ? `Join ${c.name}` : "Get started"}</button>}</div>
        {!myAddr.value && <p class="muted small">Next you'll pick a name and get a key — it takes a few seconds and stays in this browser.</p>}
      </div>
    </div>
  );
}

export { generateKey };
