import { RNode, DeployFailed, NotCarried } from "../chain/node";
import { MASTERDICT_PUBLISH } from "../chain/profile";
import { ActionLocks, BusyAction, PendingWrite, Receipts, WriteCancelled, actionKey, normalizeNode, assertSigningContext, type ActionRef, type Receipt, type SigningRequest, type WriteObserver } from "../chain/write-gate";
// kit.tsx — shared UI pieces: routing, async data, the action runner, small widgets.
import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { filterPeople, resolvePerson, suggestNames } from "../chain/people";
import { Gov, type Community } from "../chain/gov";
import { active, addCommunity, removeCommunity, setActive, addressBook, communities, forceTick, gov, nameNotes, learnListed, learnNames, myAddr, refresh, refreshTick, reviewBeforeSign } from "../state";

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
        {t.kind === "busy" && t.since && <div class="d">Waiting <Elapsed since={t.since} /> · this action is pending; do not repeat it.</div>}
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

// --- declarative action gate ---------------------------------------------------
export type ActionKind = "group" | "issue" | "inbox" | "profile" | "install" | "local";
export function actionRef(kind: ActionKind, verb: string, ...targets: string[]): ActionRef {
  const c = active.value;
  const node = kind === "local" ? "local" : kind === "install" ? targets.shift()! : c?.node;
  const contract = kind === "group" || kind === "issue" || kind === "inbox" ? c?.[kind] : kind === "profile" ? MASTERDICT_PUBLISH : kind;
  if (!node || !contract) throw new Error("Choose a community before starting this action.");
  return { node, actor: myAddr.value ?? "no-key", contract, verb, targets };
}
/** Bind identity to the Gov instance whose callback will execute, not a later active-community value. */
export function scopedAction(G: Gov, kind: "group" | "issue" | "inbox" | "profile", verb: string, ...targets: string[]): ActionRef {
  return { node: G.c.node, actor: myAddr.value ?? "no-key", contract: kind === "profile" ? MASTERDICT_PUBLISH : G.c[kind], verb, targets };
}

type ActionOptions = { action: ActionRef; done?: string; background?: boolean; resume?: string } &
  ({ risk: "routine"; confirm?: string } | { risk: "consequential" | "irreversible"; confirm: string });
const browserStorage = {
  get length() { return localStorage.length; },
  key: (i: number) => localStorage.key(i),
  getItem: (k: string) => localStorage.getItem(k),
  setItem: (k: string, v: string) => localStorage.setItem(k, v),
  removeItem: (k: string) => localStorage.removeItem(k),
};
const receipts = new Receipts(browserStorage);
const actionLocks = new ActionLocks(receipts);
window.addEventListener("storage", (event) => { if (event.key?.startsWith("rhogov:pending-write:")) actionVersion.value++; });
export const actionVersion = signal(0);
const backgroundNotice = new Set<string>();
export const actionBusy = (ref: ActionRef) => { actionVersion.value; return actionLocks.has(ref); };
export const pendingWrites = () => {
  actionVersion.value;
  try { return receipts.list().filter((r) => r.action.actor === myAddr.value); } catch { return []; }
};
export function forgetPendingInstall(node: string, signature: string) {
  const ref = actionRef("install", "install", node);
  if (receipts.get(ref)?.signature === signature) { receipts.forget(ref); actionVersion.value++; }
}
interface Review { title: string; request: SigningRequest; resolve: (ok: boolean) => void }
const review = signal<Review | null>(null);
const reviewQueue: Review[] = [];
const askReview = (title: string, request: SigningRequest) => new Promise<boolean>((resolve) => {
  const item = { title, request, resolve };
  if (review.value) reviewQueue.push(item); else review.value = item;
});
export function ReviewModal() {
  const r = review.value;
  if (!r) return null;
  const done = (ok: boolean) => { review.value = reviewQueue.shift() ?? null; r.resolve(ok); };
  return (
    <Modal title={"Sign: " + r.title} onClose={() => done(false)}
      actions={<><button onClick={() => done(false)}>Cancel</button><button class="primary" onClick={() => done(true)}>Sign and send</button></>}>
      <p class="muted small">This is the exact rholang your key will sign. Sending it costs phlo (gas).</p>
      <div class="small"><b>Node:</b> <span class="mono">{r.request.node}</span></div>
      <div class="small"><b>Signing address:</b> <span class="mono">{r.request.actor}</span></div>
      <div class="small"><b>Phlo limit:</b> {r.request.phloLimit.toLocaleString()}</div>
      <pre class="code">{r.request.term}</pre>
    </Modal>
  );
}
function stillCurrent(ref: ActionRef) {
  if (ref.actor !== (myAddr.value ?? "no-key")) throw new WriteCancelled();
  const c = active.value;
  if (ref.contract.startsWith("rho:id:") && (!c || normalizeNode(c.node) !== normalizeNode(ref.node) ||
      (ref.contract !== MASTERDICT_PUBLISH && ![c.group, c.issue, c.inbox].includes(ref.contract)))) throw new WriteCancelled();
}
/** Every action declares risk and a stable target. Review uses the actual term at the deploy boundary. */
export async function act<T>(title: string, run: (onTick: WriteObserver) => Promise<T> | T, opts: ActionOptions): Promise<T | undefined> {
  const id = actionKey(opts.action);
  if (opts.background && (reviewBeforeSign.value || opts.risk !== "routine")) {
    if (!backgroundNotice.has(id)) {
      backgroundNotice.add(id);
      notify("Your name is waiting for review", "Open Account and choose Publish name when you're ready.", "info", { label: "Account", href: "#/account" });
    }
    return undefined;
  }
  let release: (() => void) | undefined;
  const trigger = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
  const wasDisabled = trigger?.disabled ?? false;
  try {
    release = actionLocks.acquire(opts.action, opts.resume); // BEFORE any confirmation or review
    actionVersion.value++;
    if (trigger) { trigger.disabled = true; trigger.setAttribute("aria-busy", "true"); }
    const execute = async () => {
      stillCurrent(opts.action);
      if (opts.risk !== "routine" && (!opts.confirm || !confirm(opts.confirm))) return undefined;
      const t = pushToast({ title, detail: opts.resume ? "Checking the earlier deploy…" : "Preparing…", kind: "busy", since: Date.now() });
      const observer: WriteObserver = Object.assign((s: string) => t.update({ detail: TICK[s] ?? s }), {
        beforeSign: async (request: SigningRequest) => {
          if (opts.resume) throw new Error("A receipt check must not submit another deploy.");
          assertSigningContext(opts.action, request);
          stillCurrent(opts.action);
          if (reviewBeforeSign.value || opts.risk === "irreversible") {
            t.update({ detail: "Waiting for your review…" });
            if (!await askReview(title, request)) throw new WriteCancelled();
          }
          stillCurrent(opts.action);
          assertSigningContext(opts.action, request);
          t.update({ detail: "Signing…" });
        },
        onSigned: (signature: string) => { receipts.remember(opts.action, signature, title); actionVersion.value++; },
        onSettled: () => { receipts.forget(opts.action); actionVersion.value++; },
      });
      try {
        const out = await run(observer);
        if (opts.resume) { receipts.forget(opts.action); actionVersion.value++; }
        t.update({ kind: "done", detail: opts.done ?? "Recorded on chain." });
        t.close(3500);
        refresh(true);
        return out;
      } catch (e) {
        if (e instanceof WriteCancelled) { t.update({ kind: "info", detail: "Cancelled before signing." }); t.close(2000); return undefined; }
        if (opts.resume && e instanceof DeployFailed) { receipts.forget(opts.action); actionVersion.value++; }
        const pending = receipts.get(opts.action);
        const message = pending && e instanceof NotCarried ? "The short status check found no terminal receipt. That is not proof the deploy cannot land later." : (e as Error).message;
        const detail = message + (pending ? " Its signature is saved on Account. Check it there before repeating this action." : "");
        logError(title, detail);
        t.update({ kind: "error", detail, ...(pending ? { action: { label: "Check pending actions", href: "#/account" } } : {}) });
        refresh(true);
        return undefined;
      }
    };
    if (navigator.locks && opts.action.node !== "local")
      return await navigator.locks.request("rhogov:write:" + id, { ifAvailable: true }, async (lock) => {
        if (!lock) throw new BusyAction();
        return execute();
      });
    return await execute();
  } catch (e) {
    if (e instanceof WriteCancelled) return undefined;
    if (e instanceof PendingWrite)
      notify("This action was already submitted", "Its signature is saved on Account. Check the earlier deploy rather than send another.", "info", { label: "Check pending actions", href: "#/account" });
    else if (e instanceof BusyAction)
      notify("This action is already in progress", "Finish its review or wait for its result before repeating it.", "info");
    else notify(title, (e as Error).message, "error");
    return undefined;
  } finally {
    release?.(); actionVersion.value++;
    if (trigger?.isConnected && !wasDisabled) { trigger.disabled = false; trigger.removeAttribute("aria-busy"); }
  }
}
export function PendingActions() {
  const pending = pendingWrites();
  if (!pending.length) return null;
  const check = async (receipt: Receipt) => {
    let terminal = false;
    const result = await act("Checking the earlier action", async (t) => {
      try { return await new RNode(receipt.action.node).outcome(receipt.signature, { onTick: t, timeoutMs: 12_000 }); }
      catch (e) { if (e instanceof DeployFailed) terminal = true; throw e; }
    }, { risk: "routine", action: actionRef("local", "check-receipt", receipt.signature), done: "The earlier action was carried. The page has been refreshed." });
    if (result !== undefined || terminal) { receipts.forget(receipt.action); actionVersion.value++; refresh(true); }
  };
  return <div class="card stack">
    <h2>Pending actions</h2>
    <p class="muted small">These deploys may still be carried. Checking reads their existing signatures; it does not repeat them or spend another fee.</p>
    {pending.map((receipt) => <div class="stack small">
      <b>{receipt.title}</b><span class="mono">{receipt.action.node}</span>
      <div class="row"><span class="mono grow">{short(receipt.signature)}</span><Copy text={receipt.signature} label="Copy deploy signature" />
        <button disabled={actionBusy(actionRef("local", "check-receipt", receipt.signature))} onClick={() => check(receipt)}>Check status</button></div>
    </div>)}
  </div>;
}



// --- widgets ---------------------------------------------------------------------

export function Modal({ title, children, actions, onClose }: { title: string; children: ComponentChildren; actions?: ComponentChildren; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
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
  // An error stays on screen while a retry (or the 15 s poll) runs: swapping it for
  // a spinner each time would close anything opened from it, mid-typing.
  if (a.data === undefined && a.error) return <ChainError error={a.error} retry={a.reload} retrying={a.loading} />;
  if (a.data === undefined && a.loading) return <div class="empty"><Spinner /> Reading the chain…</div>;
  return <>{children()}</>;
}

/**
 * A community that can't be read: say which one and where, what probably went
 * wrong, and give every way out from here, not just Retry (#16). A returning
 * user whose node moved or whose contracts are gone must not be stuck.
 */
export function ChainError({ error, retry, retrying = false }: { error: string; retry: () => void; retrying?: boolean }) {
  const c = active.value;
  const [moving, setMoving] = useState(false);
  const unreachable = /can't reach the node|failed to fetch|no answer in|network/i.test(error);
  const others = communities.value.filter((x) => x.group !== c?.group);
  if (!c) return <div class="callout danger"><b>Couldn't read the chain.</b> {error} <button class="small" onClick={retry}>Retry</button></div>;
  return (
    <div class="callout danger stack">
      <b>Couldn't read the chain for {c.name}.</b>
      <span class="small">
        {unreachable
          ? <>Its network, <span class="mono">{c.node}</span>, isn't answering. It may be down for a moment, or it may have moved (a local node restarted on another port, say).</>
          : <>Its network, <span class="mono">{c.node}</span>, answered, but {c.name}'s contracts didn't. They may not exist on this network (a reset test network loses everything), or the community was entered with a wrong address.</>}
      </span>
      <span class="small muted">The node said: {error}</span>
      <div class="row wrap">
        <button class="small" disabled={retrying} onClick={retry}>{retrying ? <><Spinner /> Retrying…</> : "Retry"}</button>
        <button class="small" onClick={() => setMoving(true)}>Change network address</button>
        {others.map((x) => <button class="small" onClick={() => { setActive(x.group); go("/"); }}>Switch community: {x.name}</button>)}
        <button class="small" onClick={() => go("/welcome")}>Join or start another community</button>
        <button class="small danger" onClick={() => { act("Forgetting this community", () => { removeCommunity(c); go(communities.value.length ? "/" : "/welcome"); }, { risk: "consequential", action: actionRef("local", "forget-community", c.group), confirm: `Forget ${c.name} in this browser? Nothing on chain changes; you can rejoin with its invite link.`, done: "Community forgotten in this browser." }); }}>Forget {c.name}</button>
      </div>
      <span class="small muted">Still stuck? <b>Help → Report a problem</b> (in the menu) sends us what rhogov knows, including this error.</span>
      {moving && <MoveNode c={c} onClose={() => setMoving(false)} onMoved={retry} />}
    </div>
  );
}

/** Point a community at another address for the same network: same contracts, new node URL. */
function MoveNode({ c, onClose, onMoved }: { c: Community; onClose: () => void; onMoved: () => void }) {
  const [url, setUrl] = useState(c.node);
  const [check, setCheck] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const test = async () => {
    setCheck("Checking…"); setOk(false);
    try {
      const st = await new RNode(url.trim()).status();
      const found = await new Gov({ ...c, node: url.trim() }, () => null).answers().catch(() => false);
      setOk(found);
      setCheck(found ? `Connected (shard ${st.shardId ?? "?"}, block ${st.latestBlockNumber ?? "?"}), and ${c.name}'s contracts answer there.`
        : `Connected, but ${c.name}'s contracts don't answer there: that's a different network, or they're gone.`);
    } catch (e) { setCheck(`Can't reach it: ${(e as Error).message}`); }
  };
  return (
    <Modal title={`Change ${c.name}'s network address`} onClose={onClose}
      actions={<><button onClick={onClose}>Cancel</button><button class="primary" disabled={!ok} onClick={() => { addCommunity({ ...c, node: url.trim().replace(/\/+$/, "") }); onClose(); onMoved(); }}>Use this address</button></>}>
      <div class="stack">
        <p class="small muted">Use this when the same network is reachable at a different address. The community's contracts must answer there; rhogov checks before switching.</p>
        <label class="field">Node address
          <div class="row"><input class="grow mono" value={url} onInput={(e) => { setUrl((e.target as HTMLInputElement).value); setOk(false); setCheck(null); }} /><button onClick={test}>Check</button></div>
        </label>
        {check && <span class={`small ${ok ? "" : "muted"}`}>{check}</span>}
      </div>
    </Modal>
  );
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
