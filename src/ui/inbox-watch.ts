// inbox-watch.ts — tell people when a message arrives, wherever they are in the app.
//
// Message COUNTS are public (bodies are not), so checking costs one free read,
// no signature. Visible pages share the app's refresh loop and check at most once
// a minute. A person can explicitly opt in to a slower hidden-tab check, which
// raises a system notification when the waiting count increases.
import { signal } from "@preact/signals";
import { active, gov, myAddr } from "../state";
import { notify } from "./kit";

/** Messages waiting on chain for you in the active community (null = not read yet). */
export const waitingCount = signal<number | null>(null);

const MIN_GAP = 60_000;
const BACKGROUND_GAP = 5 * 60_000;
const NOTIFICATION_CHOICE = "rhogov:inbox-notifications";
export type InboxNotificationChoice = "unset" | "enabled" | "declined";

const readChoice = (): InboxNotificationChoice => {
  if (typeof localStorage === "undefined") return "unset";
  try {
    const v = localStorage.getItem(NOTIFICATION_CHOICE);
    return v === "enabled" || v === "declined" ? v : "unset";
  } catch { return "unset"; }
};
const writeChoice = (v: InboxNotificationChoice) => {
  backgroundNotificationChoice.value = v;
  try { localStorage.setItem(NOTIFICATION_CHOICE, v); } catch { /* storage refused */ }
};

/** The person's explicit choice. `unset` never triggers a browser permission prompt. */
export const backgroundNotificationChoice = signal<InboxNotificationChoice>(readChoice());
export const notificationAvailable = () => typeof window !== "undefined" && "Notification" in window;
export const backgroundNotificationsEnabled = () =>
  backgroundNotificationChoice.value === "enabled" && notificationAvailable() && Notification.permission === "granted";

/** Called only from the Inbox button, so permission is never requested on first load. */
export async function enableBackgroundNotifications(): Promise<boolean> {
  if (!notificationAvailable()) return false;
  let permission = Notification.permission;
  if (permission === "default") {
    try { permission = await Notification.requestPermission(); }
    catch { permission = "denied"; }
  }
  const enabled = permission === "granted";
  writeChoice(enabled ? "enabled" : "declined");
  return enabled;
}

/** A local decline is durable; rhogov does not ask again on later loads. */
export function declineBackgroundNotifications() { writeChoice("declined"); }

let lastCheck = 0;
let running = false;
let watchStarted = false;

const seenKey = () => `rhogov:inbox-seen:${active.value?.inbox}:${myAddr.value}`;
const seen = () => { try { return Number(localStorage.getItem(seenKey()) ?? 0) || 0; } catch { return 0; } };
const setSeen = (n: number) => { try { localStorage.setItem(seenKey(), String(n)); } catch { /* storage refused */ } };
const messageTitle = (n: number) => n === 1 ? "A new message is waiting" : `${n} new messages are waiting`;

function systemNotify(n: number) {
  if (!backgroundNotificationsEnabled()) return;
  try {
    const note = new Notification(messageTitle(n), {
      body: "Open rhogov to collect and read them.",
      tag: `rhogov-inbox:${active.value?.inbox}:${myAddr.value}`,
    });
    note.onclick = () => { window.focus(); location.hash = "#/inbox"; note.close(); };
  } catch { /* browser notification failed; the count still remains in the app */ }
}

export async function checkInbox(force = false) {
  const G = gov.value, me = myAddr.value;
  if (!G || !me || running || (!force && Date.now() - lastCheck < MIN_GAP)) return;
  running = true;
  lastCheck = Date.now();
  try {
    const n = Object.values(await G.inboxCounts(me)).reduce((a, b) => a + b, 0);
    waitingCount.value = n;
    const before = seen();
    if (n > before) {
      if (document.visibilityState === "hidden") systemNotify(n);
      else if (!location.hash.startsWith("#/inbox"))
        notify(messageTitle(n), "Open Inbox to collect and read them.", "info", { label: "Open Inbox", href: "#/inbox" });
    }
    setSeen(n); // after collecting, the count drops, so the next arrival alerts again
  } catch { /* a read that fails is retried on the next refresh */ } finally {
    running = false;
  }
}

/** Start one slower poll for an opted-in hidden tab. */
export function startInboxWatch() {
  if (typeof window === "undefined" || watchStarted) return;
  watchStarted = true;
  window.setInterval(() => {
    if (document.visibilityState === "hidden" && backgroundNotificationsEnabled()) void checkInbox(true);
  }, BACKGROUND_GAP);
}

/** The tab title carries the count, so it shows even from another tab. */
export function titleWithCount(base: string) {
  const n = waitingCount.value ?? 0;
  return n > 0 ? `(${n}) ${base}` : base;
}
