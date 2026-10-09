// inbox-watch.ts — tell people when a message arrives, wherever they are in the app.
//
// Message COUNTS are public (bodies are not), so checking costs one free read,
// no signature. It runs with the app's 15 s refresh, at most once a minute, and
// alerts only when the count goes UP past what this browser last told you about,
// so a waiting message is announced once, not every minute.
import { signal } from "@preact/signals";
import { active, gov, myAddr } from "../state";
import { notify } from "./kit";

/** Messages waiting on chain for you in the active community (null = not read yet). */
export const waitingCount = signal<number | null>(null);

const MIN_GAP = 60_000;
let lastCheck = 0;
let running = false;

const seenKey = () => `rhogov:inbox-seen:${active.value?.inbox}:${myAddr.value}`;
const seen = () => { try { return Number(localStorage.getItem(seenKey()) ?? 0) || 0; } catch { return 0; } };
const setSeen = (n: number) => { try { localStorage.setItem(seenKey(), String(n)); } catch { /* storage refused */ } };

export async function checkInbox(force = false) {
  const G = gov.value, me = myAddr.value;
  if (!G || !me || running || (!force && Date.now() - lastCheck < MIN_GAP)) return;
  running = true;
  lastCheck = Date.now();
  try {
    const n = Object.values(await G.inboxCounts(me)).reduce((a, b) => a + b, 0);
    waitingCount.value = n;
    const before = seen();
    if (n > before && !location.hash.startsWith("#/inbox")) {
      notify(n === 1 ? "A new message is waiting" : `${n} new messages are waiting`, "Open Inbox to collect and read them.", "info", { label: "Open Inbox", href: "#/inbox" });
    }
    setSeen(n); // after collecting, the count drops, so the next arrival alerts again
  } catch { /* a read that fails is retried on the next refresh */ } finally {
    running = false;
  }
}

/** The tab title carries the count, so it shows even from another tab. */
export function titleWithCount(base: string) {
  const n = waitingCount.value ?? 0;
  return n > 0 ? `(${n}) ${base}` : base;
}
