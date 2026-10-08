// inbox.tsx — on-chain messages. Sending is public-write; receiving consumes.
import { useState } from "preact/hooks";
import type { InboxMessage } from "../chain/gov";
import { looksLikeRevAddress } from "../chain/keys";
import { active, addressBook, archive, archived, gov, learnNames, myAddr, setArchive } from "../state";
import { learnFrom } from "./groups";
import { Addr, Info, Loading, Modal, act, go, nameOf, useAsync } from "./kit";

export function InboxScreen() {
  const G = gov.value!;
  const me = myAddr.value!;
  const c = active.value!;
  const waiting = useAsync(() => G.inboxCounts(me), [c.inbox, me]);
  // Names for the recipient picker and the senders.
  useAsync(async () => { learnFrom(await G.groups()); learnNames(archived(me, c).map((m) => ({ addr: m.from, label: "" }))); return true; }, [c.group, me]);
  const [msgs, setMsgs] = useState<InboxMessage[]>(() => archived(me, c));
  const [composing, setComposing] = useState<{ to?: string; subject?: string } | null>(null);
  const n = Object.values(waiting.data ?? {}).reduce((x, y) => x + y, 0);

  const collect = async () => {
    const got = await act("Collecting your messages", (t) => G.receive(t), { done: "Messages collected." });
    if (got && got.length) { archive(me, c, got); setMsgs(archived(me, c)); }
  };
  const remove = (m: InboxMessage) => { const next = msgs.filter((x) => x !== m); setArchive(me, c, next); setMsgs(next); };

  return (
    <div>
      <div class="row between">
        <h1>Inbox</h1>
        <button class="primary" onClick={() => setComposing({})}>✎ New message</button>
      </div>
      <Loading a={waiting}>{() => (
        n > 0 ? (
          <div class="callout row between" style={{ margin: ".6rem 0 1rem" }}>
            <span><b>{n} new message{n > 1 ? "s" : ""}</b> waiting on chain.</span>
            <button class="primary" onClick={collect}>Collect</button>
          </div>
        ) : <p class="muted">No new messages on chain.</p>
      )}</Loading>
      {!msgs.length ? <div class="card soft empty">Nothing here yet.</div> : (
        <div class="stack">
          {[...msgs].reverse().map((m) => (
            <div class="card">
              <div class="row between">
                <div class="row"><Addr addr={m.from} /><span class="muted small">{m.at ? new Date(m.at).toLocaleString() : ""}</span></div>
                <div class="row">
                  {m.type === "invite" && m.fields.gid && <button class="primary small" onClick={() => go(`/g/${encodeURIComponent(m.fields.gid)}`)}>Open {m.fields.group || "group"}</button>}
                  <button class="ghost small" onClick={() => setComposing({ to: m.from, subject: m.fields.subject ? `Re: ${m.fields.subject.replace(/^Re: /, "")}` : "" })}>Reply</button>
                  <button class="ghost small" aria-label="Delete" onClick={() => remove(m)}>✕</button>
                </div>
              </div>
              {m.type === "invite" && <span class="badge warn">Invitation</span>}
              {m.fields.subject && <h3 style={{ marginTop: ".5rem" }}>{m.fields.subject}</h3>}
              <p style={{ whiteSpace: "pre-wrap", margin: ".3rem 0 0" }}>{m.fields.body}</p>
            </div>
          ))}
        </div>
      )}
      <div class="section">
        <Info>
          <p>Your inbox lives in the community's Inbox contract. Anyone can drop a message in; the sender's name is stamped by the contract from their key, so it can't be faked. Anyone can see <i>how many</i> messages you have, but the public read interface never shows their contents.</p>
          <p><b>Collect</b> takes the messages out of the contract and keeps them in this browser — on chain they're gone afterwards, so a second reader can't take them too. Messages are not encrypted: they sit in chain state until collected, so don't send secrets.</p>
        </Info>
      </div>
      {composing && <Compose initial={composing} onClose={() => setComposing(null)} />}
    </div>
  );
}

export function Compose({ initial, onClose }: { initial: { to?: string; subject?: string }; onClose: () => void }) {
  const G = gov.value!;
  const [to, setTo] = useState(initial.to ?? "");
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [body, setBody] = useState("");
  const known = Object.entries(addressBook.value).filter(([a]) => a !== myAddr.value);
  const ok = looksLikeRevAddress(to) && body.trim();
  return (
    <Modal title="New message" onClose={onClose}
      actions={<><button onClick={onClose}>Cancel</button><button class="primary" disabled={!ok} onClick={() => { onClose(); act(`Sending to ${nameOf(to)}`, (t) => G.send(to.trim(), "note", { subject: subject.trim(), body: body.trim() }, t), { done: "Delivered to their inbox." }); }}>Send</button></>}>
      <div class="stack">
        <label class="field">To
          {known.length > 0 && (
            <select value={known.some(([a]) => a === to) ? to : ""} onChange={(e) => setTo((e.target as HTMLSelectElement).value)}>
              <option value="">Choose someone…</option>
              {known.map(([a, n]) => <option value={a}>{n}</option>)}
            </select>
          )}
          <input class="mono" placeholder="or paste a REV address (1111…)" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} />
          {to && !looksLikeRevAddress(to) && <span class="badge danger">That doesn't look like a REV address</span>}
        </label>
        <label class="field">Subject<input value={subject} onInput={(e) => setSubject((e.target as HTMLInputElement).value)} /></label>
        <label class="field">Message<textarea rows={5} value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} /></label>
        <p class="muted small">Not encrypted — readable in chain state until collected.</p>
      </div>
    </Modal>
  );
}
