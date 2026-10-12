// kit.tsx — shared UI pieces: routing, async data, the action runner, small widgets.
import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { blake2b } from "@noble/hashes/blake2.js";
import { filterPeople, resolvePerson, suggestNames } from "../chain/people";
import { Gov } from "../chain/gov";
import { hex } from "../chain/keys";
import { addressBook, communities, forceTick, gov, nameNotes, learnListed, learnNames, myAddr, refresh, refreshTick, reviewBeforeSign } from "../state";

// --- routing (hash) ------------------------------------------------------------

const parse = () => {
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = h.split("?");
  return { path, parts: path.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs) };
};
export const route = signal(parse());
window.addEventListener("hashchange", () => { route.value = parse(); window.scrollTo(0, 0); });
export const go = (path: string) => { location.hash = path; };
export const href = (...parts: string[]) => "#/" + parts.map(encodeURIComponent).join("/");

// --- async data ------------------------------------------------------------------

export interface Async<T> { data: T | undefined; error: string | null; loading: boolean; reload: () => void }

/** Load something from the chain; re-runs on deps and after every write (refreshTick). */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): Async<T> {
  const [n, setN] = useState(0);
  const [s, setS] = useState<{ data: T | undefined; error: string | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  const tick = refreshTick.value;
  // One read at a time per screen. A background refresh that lands while the
  // previous read is still running is skipped, not stacked — stacking is how a
  // slow public node gets buried under its own polling.
  const inFlight = useRef(false);
  const lastKey = useRef("");
  const runId = useRef(0);
  useEffect(() => {
    const key = JSON.stringify([...deps, n, forceTick.value]);
    if (key === lastKey.current && inFlight.current) return; // a poll while still reading: skip
    lastKey.current = key;
    const id = ++runId.current; // only the newest read may set state
    inFlight.current = true;
    setS((p) => ({ ...p, loading: true }));
    fn().then(
      (data) => id === runId.current && setS({ data, error: null, loading: false }),
      (e) => id === runId.current && setS((p) => ({ data: p.data, error: (e as Error).message ?? String(e), loading: false })),
    ).finally(() => { if (id === runId.current) inFlight.current = false; });
  }, [...deps, n, tick]);
  useEffect(() => () => { runId.current++; }, []); // unmounted: ignore late answers
  return { ...s, reload: () => setN((x) => x + 1) };
}

// --- toasts ----------------------------------------------------------------------

interface Toast { id: number; title: string; detail?: string; kind: "busy" | "done" | "error" | "info"; since?: number; action?: { label: string; href: string } }
export const toasts = signal<Toast[]>([]);

/** The last few failures this session, for a problem report (Help → Report a problem). */
export const recentErrors: { at: string; title: string; detail?: string; route: string }[] = [];
function logError(title: string, detail?: string) {
  recentErrors.push({ at: new Date().toISOString(), title, detail, route: location.hash || "#/" });
  if (recentErrors.length > 5) recentErrors.shift();
}
let tid = 0;
function pushToast(t: Omit<Toast, "id">) {
  const id = ++tid;
  toasts.value = [...toasts.value, { ...t, id }];
  return {
    update: (u: Partial<Toast>) => { toasts.value = toasts.value.map((x) => (x.id === id ? { ...x, ...u } : x)); },
    close: (ms = 0) => setTimeout(() => { toasts.value = toasts.value.filter((x) => x.id !== id); }, ms),
  };
}
/** Errors stay until dismissed: they are what someone has to act on. */
export const notify = (title: string, detail?: string, kind: Toast["kind"] = "done", action?: Toast["action"]) => {
  if (kind === "error") logError(title, detail);
  const t = pushToast({ title, detail, kind, action });
  if (kind === "done") t.close(4000);
  // "info" (a new message, say) waits to be seen, but not forever.
  if (kind === "info") t.close(60_000);
};

const dismiss = (id: number) => (toasts.value = toasts.value.filter((x) => x.id !== id));

/** Seconds since `since`, ticking, so a long wait visibly is one. */
function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const h = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(h); }, []);
  const s = Math.floor((Date.now() - since) / 1000);
  return <span class="elapsed">{s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`}</span>;
}

function ToastCard({ t }: { t: Toast }) {
  return (
    <div class={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
      {t.kind === "busy" ? <span class="spinner" /> : <span class="icon">{t.kind === "done" ? "✓" : t.kind === "info" ? "✉" : "⚠"}</span>}
      <div class="grow">
        <div class="t">{t.kind === "error" ? `Couldn't finish: ${t.title}` : t.title}</div>
        {t.detail && <div class="d">{t.detail}</div>}
        {t.action && <a class="toast-action" href={t.action.href} onClick={() => dismiss(t.id)}>{t.action.label} →</a>}
        {t.kind === "busy" && t.since && <div class="d">Waiting <Elapsed since={t.since} /> · you can keep using the app; this card stays until it's done.</div>}
      </div>
      {t.kind !== "busy" && <button class="ghost small" onClick={() => dismiss(t.id)} aria-label="Dismiss">✕</button>}
    </div>
  );
}

/**
 * Work in progress and failures sit in the middle of the screen, where they are
 * seen; a success is a brief note in the corner.
 */
/** Where the centre card was dragged to, as an offset from the middle; remembered. */
const POS_KEY = "rhogov:card-offset";
const cardOffset = signal<{ x: number; y: number }>((() => { try { return JSON.parse(localStorage.getItem(POS_KEY) ?? "") ?? { x: 0, y: 0 }; } catch { return { x: 0, y: 0 }; } })());

/** Drag the card by any part that isn't a button or link; double-click puts it back in the middle. */
function dragCard(e: PointerEvent) {
  if ((e.target as HTMLElement).closest("button, a") || e.button !== 0) return;
  e.preventDefault();
  const start = { x: e.clientX, y: e.clientY }, from = cardOffset.value;
  const half = { x: window.innerWidth / 2 - 40, y: window.innerHeight / 2 - 40 }; // keep it on screen
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  const move = (m: PointerEvent) => { cardOffset.value = { x: clamp(from.x + m.clientX - start.x, half.x), y: clamp(from.y + m.clientY - start.y, half.y) }; };
  const up = () => {
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
    try { localStorage.setItem(POS_KEY, JSON.stringify(cardOffset.value)); } catch { /* storage refused */ }
  };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
}
const recentre = () => { cardOffset.value = { x: 0, y: 0 }; try { localStorage.removeItem(POS_KEY); } catch { /* storage refused */ } };

export function Toasts() {
  const centre = toasts.value.filter((t) => t.kind === "busy" || t.kind === "error");
  const corner = toasts.value.filter((t) => t.kind === "done" || t.kind === "info");
  const { x, y } = cardOffset.value;
  return (
    <>
      {centre.length > 0 && (
        <div class="toasts centre" aria-live="assertive" title="Drag to move · double-click to centre"
          style={{ transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` }}
          onPointerDown={dragCard} onDblClick={recentre}>
          {centre.map((t) => <ToastCard key={t.id} t={t} />)}
        </div>
      )}
      <div class="toasts" aria-live="polite">{corner.map((t) => <ToastCard key={t.id} t={t} />)}</div>
    </>
  );
}

const TICK: Record<string, string> = {
  submitted: "Signed and sent. Waiting for a block…",
  Pooled: "In the node's queue, waiting for a block…",
  "Block not yet available": "Waiting for a block…",
  waiting: "Waiting for a block…",
  slow: "Still not in a block after 4 minutes: the network is slow. rhogov keeps checking; don't repeat this, or it could happen twice.",
  unconfirmed: "The node didn't confirm it, but it may have been carried anyway. Checking for it before anything else…",
};

/**
 * How much a write can cost the person doing it. Declared at the call site so the
 * gate below can decide what to ask, rather than each site remembering.
 */
export type Risk = "routine" | "consequential" | "irreversible";

/**
 * A write's identity: its deploy term, hashed. The term carries the contract, the
 * verb and the arguments — and never a name shown to a person — so two clicks on
 * the same action give one id, and two different targets give two. Keying this on
 * the visible title instead would collide across targets and be defeated by a
 * title that varies (§ the in-flight lock, docs/audit/remediation.md).
 */
const writeId = (term: string) => hex(blake2b(new TextEncoder().encode(term), { dkLen: 16 }));

/**
 * Writes in flight *now*, by their identity. In memory only.
 *
 * A durable version of this was tried and retracted: it kept a reload from
 * offering a second close or a second install, but it also refused the *resume*
 * that Gov.install already does properly — `deploys.spec.ts` installs, is
 * interrupted, reloads, and asks the app to look for the install it started. A
 * lock that cannot tell "pressing again" from "finishing what I started" breaks
 * the better mechanism rather than protecting it.
 */
const inFlight = new Set<string>();

const locked = (id: string) => inFlight.has(id);
const acquire = (id: string) => { inFlight.add(id); };
const release = (id: string) => { inFlight.delete(id); };

// --- review-before-sign ---------------------------------------------------------

const review = signal<{ title: string; term: string; resolve: (ok: boolean) => void } | null>(null);
export function ReviewModal() {
  const r = review.value;
  if (!r) return null;
  const done = (ok: boolean) => { review.value = null; r.resolve(ok); };
  return (
    <Modal title={`Sign: ${r.title}`} onClose={() => done(false)}
      actions={<><button onClick={() => done(false)}>Cancel</button><button class="primary" onClick={() => done(true)}>Sign and send</button></>}>
      <p class="muted small">This is the exact rholang your key will sign. It's sent to the node, executed in a block, and costs a small fee.</p>
      <pre class="code">{r.term}</pre>
    </Modal>
  );
}

/**
/**
 * Run a chain write with visible progress.
 *
 * `key` is the write's identity: the same action cannot be started twice at once,
 * and the id is derived from the target rather than a heading, so two different
 * targets never collide and a label containing a name never defeats it.
 *
 * `risk` is a declaration of intent at every call site — it is deliberately *not*
 * used to decide anything here. Deriving behaviour from it was tried and retracted
 * twice: a question for every irreversible write is confirm fatigue, and a durable
 * lock for them refuses the resume that Gov.install already does properly. What a
 * site wants asked, it asks in `confirm`, where the trade-off can be stated in
 * words; and what it wants explained, it explains in the screen or modal the
 * person is looking at, which is where a dialog cannot be dismissed unread.
 */
export async function act<T>(
  title: string,
  run: (onTick: (s: string) => void) => Promise<T>,
  opts: { risk: Risk; key: string; term?: string; done?: string; confirm?: string | false },
): Promise<T | undefined> {
  const id = writeId(opts.key);
  if (locked(id)) {
    notify(`Already in progress: ${title}`, "It's still waiting for a block (see the card). Pressing again would do it twice.", "info");
    return undefined;
  }
  acquire(id);
  try {
    // Only a question the call site actually states gets asked. Deriving one from
    // `risk` was the first thing tried here and it was wrong twice over: a modal on
    // every irreversible write is confirm fatigue, and because a dismissed dialog
    // silently cancels the action, a synthesised question on the install path broke
    // every test that starts a community. `confirm: false` silences a question a
    // site would otherwise inherit from its own flow.
    if (opts.confirm && !confirm(opts.confirm)) return undefined;
    // Review shows the rholang, so it only opens when there is one to show. `key`
    // identifies the write for the lock and is usually a composite, not a term —
    // showing that as "the exact rholang your key will sign" would be a lie.
    // Coverage grows as call sites can hand over a real term; today two can.
    if (reviewBeforeSign.value && opts.term) {
      const ok = await new Promise<boolean>((resolve) => { review.value = { title, term: opts.term!, resolve }; });
      if (!ok) return undefined;
    }
    const t = pushToast({ title, detail: "Signing…", kind: "busy", since: Date.now() });
    try {
      const out = await run((s) => t.update({ detail: TICK[s] ?? s }));
      t.update({ kind: "done", detail: opts.done ?? "Recorded on chain." });
      t.close(3500);
      refresh(true);
      return out;
    } catch (e) {
      logError(title, (e as Error).message);
      t.update({ kind: "error", detail: (e as Error).message });
      refresh(true);
      return undefined;
    }
  } finally {
    release(id);
  }
}

// --- widgets ---------------------------------------------------------------------

/**
 * Plain words for the mechanisms, in one place.
 *
 * A control labelled "Censure" or "…to the roll" asks the reader to already know
 * the mechanism before they can act. The plain word belongs on the control; the
 * mechanism's own name belongs in the explanation beside it, where someone who
 * wants the precise term can find it (CS-004, CS-005). One map, so a word is
 * changed once rather than in every place it is written.
 */
export const PLAIN = {
  censure: "Dispute their trust",
  uncensure: "Withdraw the dispute",
  delegate: "Hand my vote to someone",
  delegateThisVote: "Hand this vote to someone",
  voters: "who may vote",
} as const;

export function Modal({ title, children, actions, onClose }: { title: string; children: ComponentChildren; actions?: ComponentChildren; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        {actions && <div class="actions">{actions}</div>}
      </div>
    </div>
  );
}

export const Spinner = () => <span class="spinner" aria-label="Loading" />;

export function Loading({ a, children }: { a: Async<unknown>; children: () => ComponentChildren }) {
  if (a.data === undefined && a.loading) return <div class="empty"><Spinner /> Reading the chain…</div>;
  if (a.data === undefined && a.error) return <div class="callout danger"><b>Couldn't read the chain.</b> {a.error} <button class="small" onClick={a.reload}>Retry</button></div>;
  return <>{children()}</>;
}

const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
export const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-5)}` : a);
/** What to call someone: always a name. No name yet says so (their address is on the ⧉ button). */
export const nameOf = (a: string) => (a === myAddr.value ? "You" : addressBook.value[a] ?? "No name yet");

export function Avatar({ addr, size = 34 }: { addr: string; size?: number }) {
  const n = addressBook.value[addr] ?? addr.slice(4);
  return <span class="avatar" style={{ width: size, height: size, background: `hsl(${hue(addr)} 45% 45%)` }}>{n.slice(0, 1).toUpperCase()}</span>;
}

export function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button class="copy small" title={label} aria-label={label}
      onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); }); }}>
      {ok ? "✓" : "⧉"}
    </button>
  );
}

/** A person: their name, with their REV address one click away (tooltip and copy). */
export function Addr({ addr, avatar = true }: { addr: string; avatar?: boolean }) {
  return (
    <span class="addr" title={nameNotes.value[addr] ? `${nameNotes.value[addr]}\n${addr}` : addr}>
      {avatar && <Avatar addr={addr} size={26} />}
      <span class="nm">{nameOf(addr)}</span>
      <Copy text={addr} label={`Copy ${nameOf(addr) === "You" ? "your" : `${nameOf(addr)}'s`} REV address`} />
    </span>
  );
}

export function Trust({ level }: { level: number | undefined }) {
  const l = level ?? 0;
  return <span class="trust" title={`Trust level ${l} of 5`} aria-label={`Trust level ${l} of 5`}>{[1, 2, 3, 4, 5].map((i) => <i class={i <= l ? "on" : ""} />)}</span>;
}

/**
 * A collapsed explanation. The summary names the question it answers, because a
 * reader who cannot tell what is behind a closed "How does this work?" has no
 * reason to open it — which is how four separate findings read as "undisclosed"
 * when the text was already on the page. Pass `title` at every call site.
 */
export function Info({ title = "How does this work?", children }: { title?: string; children: ComponentChildren }) {
  return <details class="small"><summary>{title}</summary><div style={{ marginTop: ".5rem" }}>{children}</div></details>;
}

// --- choosing a person -------------------------------------------------------------

export function PersonField({ label, hint, initial = "", onChange }: { label: string; hint?: string; initial?: string; onChange: (addr: string | null) => void }) {
  const G = gov.value!;
  const [text, setText] = useState(initial ? (addressBook.value[initial] ?? initial) : "");
  const [picking, setPicking] = useState(false);
  // Everyone this community knows: members of any group, and its name list.
  const people = useAsync(async () => {
    const [gs, listed] = await Promise.all([G.groups().catch(() => []), G.names().catch(() => ({}))]);
    learnListed(listed, true);
    // Group labels (not a creator's, which is the group's name), and directory names where there is one.
    learnNames(gs.flatMap((g) => g.members.map((m) => ({ addr: m.addr, label: m.label !== g.name ? m.label : "" }))));
    const addrs = new Set([...gs.flatMap((g) => g.members.map((m) => m.addr)), ...Object.keys(listed)]);
    // People you know from your other communities on the same network count too:
    // someone in "colab" can be invited into a group here by the name they use there.
    const elsewhere: Record<string, { name: string; from: string }> = {};
    for (const c of communities.value.filter((x) => x.node === G.c.node && x.group !== G.c.group)) {
      const O = new Gov(c, () => null);
      const [ogs, olisted] = await Promise.all([O.groups().catch(() => []), O.names().catch(() => ({} as Record<string, string>))]);
      for (const g of ogs) for (const m of g.members) if (m.label && m.label !== g.name && !elsewhere[m.addr]) elsewhere[m.addr] = { name: m.label, from: c.name };
      for (const [a, n] of Object.entries(olisted)) elsewhere[a] = { name: n, from: c.name }; // a claim beats a label
    }
    return { here: [...addrs], elsewhere };
  }, [G.c.group]);
  // Match on the names as shown, so "Jim" finds whoever claimed it, not an "(unclaimed)" label.
  const names: Record<string, string> = Object.fromEntries((people.data?.here ?? []).map((a) => [a, addressBook.value[a] ?? ""]).filter(([, n]) => n));
  // Names from other communities fill in only where they don't clash with a name used here.
  const used = new Set(Object.values(names));
  const fromElsewhere: Record<string, string> = {};
  for (const [a, x] of Object.entries(people.data?.elsewhere ?? {})) {
    if (!names[a] && !used.has(x.name)) { names[a] = x.name; used.add(x.name); fromElsewhere[a] = x.from; }
  }
  const r = resolvePerson(text, names);
  useEffect(() => { onChange(r.ok ? r.addr : null); }, [r.ok ? r.addr : null]);
  // Names start with a letter, addresses with a digit: so while it reads as a
  // name, offer the names that start with what's typed so far.
  const choices = suggestNames(text, Object.entries(names).filter(([a]) => a !== myAddr.value).map(([, n]) => n));
  const choose = (n: string) => { setText(n); setPicking(false); };
  return (
    <div class="field person-field">{label}
      <span class="hint">{hint ?? "Start typing their name and pick it, or paste their REV address (from their Account page)."}</span>
      <input value={text} placeholder="A name, or 1111…" autocomplete="off" autocapitalize="off" spellcheck={false} aria-label={label}
        onInput={(e) => { setText((e.target as HTMLInputElement).value); setPicking(true); }}
        onKeyDown={(e) => { if (e.key === "Enter" && picking && choices.length) { e.preventDefault(); choose(choices[0]); } if (e.key === "Escape") setPicking(false); }} />
      {picking && choices.length > 0 && !r.ok && (
        <div class="choices" role="listbox" aria-label="Matching names">
          {choices.map((n) => <button type="button" role="option" class="choice-name" onClick={() => choose(n)}>{n}</button>)}
        </div>
      )}
      {text.trim() && (r.ok
        ? <span class="small muted">→ {fromElsewhere[r.addr] ? <><b>{names[r.addr]}</b> from {fromElsewhere[r.addr]} <Copy text={r.addr} label={`Copy ${names[r.addr]}'s REV address`} /></> : <Addr addr={r.addr} avatar={false} />}{!r.name && " (not known in your communities yet)"}</span>
        : (picking && choices.length) ? null
        : <span class="badge danger">{
            r.why === "bad-address" ? "That doesn't look like a complete REV address."
            : people.loading && !people.data ? "Looking up names…"
            : `No one in your communities is called “${text.trim()}” (capitals count). Someone can be found by name once they've joined a group or their name is on the community's list (that takes them a little REV). Until then, paste their REV address.`}</span>)}
    </div>
  );
}

/**
 * Choose among people by typing: a box that narrows a list to the names that
 * start with what's typed (or addresses, once it starts with a digit). The same
 * as-you-type choice as PersonField, for lists of people already on screen.
 */
export function usePeopleFilter(addrs: string[], placeholder = "Start typing a name…") {
  const [q, setQ] = useState("");
  const matches = filterPeople(q, addrs, (a) => addressBook.value[a] ?? "");
  const box = (
    <input class="people-filter" type="search" value={q} placeholder={placeholder} aria-label="Find a person by name"
      autocomplete="off" autocapitalize="off" spellcheck={false} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
  );
  return { q, box, matches };
}
