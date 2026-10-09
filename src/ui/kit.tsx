// kit.tsx — shared UI pieces: routing, async data, the action runner, small widgets.
import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { addressBook, forceTick, myAddr, refresh, refreshTick, reviewBeforeSign } from "../state";

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

interface Toast { id: number; title: string; detail?: string; kind: "busy" | "done" | "error"; since?: number }
export const toasts = signal<Toast[]>([]);
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
export const notify = (title: string, detail?: string, kind: Toast["kind"] = "done") => {
  const t = pushToast({ title, detail, kind });
  if (kind !== "error") t.close(4000);
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
      {t.kind === "busy" ? <span class="spinner" /> : <span class="icon">{t.kind === "done" ? "✓" : "⚠"}</span>}
      <div class="grow">
        <div class="t">{t.kind === "error" ? `Couldn't finish: ${t.title}` : t.title}</div>
        {t.detail && <div class="d">{t.detail}</div>}
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
export function Toasts() {
  const centre = toasts.value.filter((t) => t.kind !== "done");
  const corner = toasts.value.filter((t) => t.kind === "done");
  return (
    <>
      {centre.length > 0 && <div class="toasts centre" aria-live="assertive">{centre.map((t) => <ToastCard key={t.id} t={t} />)}</div>}
      <div class="toasts" aria-live="polite">{corner.map((t) => <ToastCard key={t.id} t={t} />)}</div>
    </>
  );
}

const TICK: Record<string, string> = {
  submitted: "Signed and sent. Waiting for a block…",
  Pooled: "In the node's queue, waiting for a block…",
  "Block not yet available": "Waiting for a block…",
  waiting: "Waiting for a block…",
};

// --- review-before-sign ---------------------------------------------------------

const review = signal<{ title: string; term: string; resolve: (ok: boolean) => void } | null>(null);
export function ReviewModal() {
  const r = review.value;
  if (!r) return null;
  const done = (ok: boolean) => { review.value = null; r.resolve(ok); };
  return (
    <Modal title={`Sign: ${r.title}`} onClose={() => done(false)}
      actions={<><button onClick={() => done(false)}>Cancel</button><button class="primary" onClick={() => done(true)}>Sign and send</button></>}>
      <p class="muted small">This is the exact rholang your key will sign. It's sent to the node, executed in a block, and costs a little phlo (gas).</p>
      <pre class="code">{r.term}</pre>
    </Modal>
  );
}

/**
 * Run a chain write with visible progress: optional review, then a toast that
 * follows the deploy into a block and reports what came back.
 */
export async function act<T>(title: string, run: (onTick: (s: string) => void) => Promise<T>, opts: { done?: string; preview?: string } = {}): Promise<T | undefined> {
  if (reviewBeforeSign.value && opts.preview) {
    const ok = await new Promise<boolean>((resolve) => { review.value = { title, term: opts.preview!, resolve }; });
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
    t.update({ kind: "error", detail: (e as Error).message });
    refresh(true);
    return undefined;
  }
}

// --- widgets ---------------------------------------------------------------------

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
export const nameOf = (a: string) => (a === myAddr.value ? "You" : addressBook.value[a] ?? short(a));

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

export function Addr({ addr, avatar = true }: { addr: string; avatar?: boolean }) {
  const named = addr === myAddr.value || !!addressBook.value[addr];
  return (
    <span class="addr" title={addr}>
      {avatar && <Avatar addr={addr} size={26} />}
      <span class="nm">{nameOf(addr)}</span>
      {named && <span class="ad">{short(addr)}</span>}
      <Copy text={addr} label="Copy address" />
    </span>
  );
}

export function Trust({ level }: { level: number | undefined }) {
  const l = level ?? 0;
  return <span class="trust" title={`Trust level ${l} of 5`} aria-label={`Trust level ${l} of 5`}>{[1, 2, 3, 4, 5].map((i) => <i class={i <= l ? "on" : ""} />)}</span>;
}

export function Info({ children }: { children: ComponentChildren }) {
  return <details class="small"><summary>How does this work?</summary><div style={{ marginTop: ".5rem" }}>{children}</div></details>;
}
