// update.tsx — notice when a newer rhogov has been published, and offer to reload.
//
// The page is one static file, so an open tab keeps the version it loaded. It
// checks version.json beside itself (a static file on the same host, so still
// no server) every few minutes and when the tab comes back into view.
import { signal } from "@preact/signals";
import { toasts } from "./kit";

const EVERY = 5 * 60_000;
const newer = signal<string | null>(null);
const later = signal<string | null>(null);

async function check() {
  if (!/^https?:$/.test(location.protocol)) return; // opened from disk: nothing to compare with
  try {
    const url = new URL("version.json", location.href);
    url.searchParams.set("t", String(Date.now()));
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return;
    const { build } = (await r.json()) as { build?: string };
    if (build && build !== __BUILD__) newer.value = build;
  } catch { /* offline or no version.json: try again later */ }
}

export function watchForUpdates() {
  check();
  setInterval(check, EVERY);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
}

export function UpdateBanner() {
  const b = newer.value;
  if (!b || later.value === b) return null;
  // A reload mid-deploy would lose the wait for its block (the action itself still lands).
  const busy = toasts.value.some((t) => t.kind === "busy");
  return (
    <div class="update" role="status">
      <span><b>A new version of rhogov is available.</b> {busy ? "Reload once your action finishes." : "Reload to get it; nothing you've done is lost."}</span>
      <button class="primary small" disabled={busy} onClick={() => location.reload()}>Reload</button>
      <button class="ghost small" onClick={() => (later.value = b)}>Later</button>
    </div>
  );
}
