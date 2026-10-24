// help.tsx — Help in the menu: the user guide, the README, and a problem report
// that carries the reporter's state, so a bug report says what they were running
// and where, without anyone having to ask.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { asking, isAuxIssue, isCouncilId } from "../chain/council";
import { isMemberOf, membershipStatus } from "../chain/gov";
import { RNode } from "../chain/node";
import { active, chainReset, communities, displayName, gov, listedName, myAddr, publishedName, reviewBeforeSign, secretKey } from "../state";
import { Modal, nameOf, pendingWrites, recentErrors, route } from "./kit";
import { nameProblem } from "./name-sync";
import { newVersion } from "./update";
import { backgroundNotificationChoice, notificationAvailable } from "./inbox-watch";
import { readPendingInstall, setupNode } from "./setup";

const REPO = "https://github.com/rhovision-org/rhogov";
export const GUIDE = `${REPO}/blob/main/docs/user-guide.md`;
export const README = `${REPO}#readme`;
const NEW_ISSUE = `${REPO}/issues/new`;

// --- help that knows where you are ------------------------------------------------

const section = (n: string) => `${GUIDE}#${n}`;

/** The screen you're on: what it's for, and the guide section that explains it. */
function screenHelp(): { title: string; text: string; link: string } {
  const [head, , tab] = route.value.parts;
  if (chainReset.value && head !== "join")
    return { title: "A reset network", text: "The network was restarted from a new genesis, so everything on its old chain is gone. Your key is in this browser: keep it and you keep your address and name, or use a new key on this network only. Then join or start a community again; the old ones stay under Community → Earlier chains.", link: section("more-than-one-network-and-a-network-that-is-reset") };
  if (head === "welcome" || !myAddr.value || !active.value)
    return { title: "Getting started", text: "Three steps: choose a network, create (or bring) your key, then join a community with an invite link or start your own. If a button is greyed out, the screen says why — a name is missing, there is no key yet, or the fee is not covered.", link: section("1-getting-started") };
  switch (head) {
    case undefined: return { title: "Home", text: "What needs you now: votes waiting for your ballot, invitations, and new messages. A community with no groups yet offers the first thing to do instead, since there is nothing to catch up on.", link: section("4-voting") };
    case "groups": return { title: "Groups", text: "The groups in this community. Join an open one, or start your own and invite people. Invitations are recorded on chain, so they follow your key to any browser.", link: section("3-groups") };
    case "g":
      if (tab === "members") return { title: "Members", text: "Who is in the group, how much they're trusted, and who votes for whom. Rate trust, hand your vote to someone, or dispute someone's trust from here. Admins approve requests to join here, each in one step: invite, and say how much they trust the person.", link: section("6-trust") };
      return { title: "A group", text: "Its votes, members and settings. Open a vote, or vote on one that's open.", link: section("3-groups") };
    case "v": return { title: "A vote", text: "Choose one or more options (or rank them) and press Vote. You can change your vote while it's open. The node counts it, with trust and delegation.", link: section("4-voting") };
    case "councils": case "c": return { title: "Councils", text: "Decisions across stakeholder groups: estimate each group's voting power, deliberate with pros and cons, then vote. The facilitator can add a stakeholder group later.", link: section("9-councils-decisions-across-stakeholder-groups") };
    case "inbox": return { title: "Inbox", text: "Messages and invitations. Invitations come from the group's on-chain state and follow your key; collected notes and messages live in this browser. Export archive saves the collected messages to a readable JSON file, without your key. Import it in another browser with the same key and community; existing messages stay and repeated imports add no extra copies. This costs no fee and does not restore messages on chain. Files can be edited, so imported messages are not proof of their sender. Background system notifications are optional: rhogov asks only after you press Enable notifications, then a hidden tab checks about every five minutes.", link: section("8-inbox") };
    case "community": return { title: "Community", text: "The invite link to share, switching communities, and communities kept from a network's earlier chain. This browser remembers which communities you've joined; use a community's invite link to open it on another device. The network address and the three contract addresses are under “Where it lives”, closed by default — you only need them to wire rhogov to a quantum-os room or a node.", link: section("2-communities-and-invitations") };
    case "account": return { title: "Account", text: "Your name, your address, your balance, saving your key as a password-protected keystore file, signed actions rhogov is still waiting to hear about (Check it looks one up), and recovering a remembered decline of background Inbox notifications without prompting automatically.", link: section("10-your-account-and-your-key") };
    default: return { title: "rhogov", text: "", link: GUIDE };
  }
}

interface Tip { text: ComponentChildren; href?: string; label?: string; external?: boolean }

const NEEDS = 2_000_000; // about what a community install costs; enough for any single action

/** Next steps for you, from your actual state: key, funds, name, groups, votes, messages. */
async function tipsFor(): Promise<Tip[]> {
  const tips: Tip[] = [];
  const c = active.value, me = myAddr.value, G = gov.value;
  if (newVersion.value) tips.push({ text: "A newer version of rhogov is available.", href: "javascript:location.reload()", label: "Reload" });
  if (!me) return [...tips, { text: "Create or bring your key: it's your identity here, and it signs everything you do.", href: "#/welcome", label: "Set up" }];
  // The install form scopes its reminder to the chosen network and identity.
  const nodeUrl = route.value.parts[0] === "welcome" || !c ? setupNode.value : c.node;
  try {
    const pending = readPendingInstall(nodeUrl, me) as { name?: unknown; sig?: unknown } | null;
    if (typeof pending?.name === "string" && pending.name.trim() && typeof pending?.sig === "string" && pending.sig) tips.push({
      text: <>You started “{pending.name}” and it hasn't confirmed yet. On the same network, choose Start a new community → Look for “{pending.name}”; don't install again while its outcome is unknown.</>,
      href: "#/welcome", label: "Continue setup",
    });
  } catch { /* An unreadable reminder must not hide the other Help tips. */ }
  if (!c || !G) return [...tips, { text: "Join a community with an invite link someone sent you, or start your own.", href: "#/welcome", label: "Continue setup" }];
  const node = new RNode(c.node);
  const [st, bal, groups, inbox] = await Promise.all([
    node.status().catch(() => null), node.balance(me), G.groups().catch(() => []), G.inboxCounts(me).catch(() => ({} as Record<string, number>)),
  ]);
  if (!st) tips.push({ text: <>The network node <span class="mono">{c.node}</span> isn't answering, so nothing can be read or signed right now. Try again shortly.</> });
  if (bal !== null && bal < NEEDS) tips.push({
    text: <>Your balance is {bal / 1e8} REV, too little to act (each action needs about 0.02 REV for its fee). {st?.devMode ? "This network has a faucet." : "Ask someone to send REV to your address."}</>,
    href: "#/account", label: st?.devMode ? "Get test REV" : "Your address",
  });
  if (nameProblem.value) tips.push({
    text: <>“{nameProblem.value.name}” is claimed by someone else here, so others see you as “{nameProblem.value.name} (unclaimed)”. Choose another name, or if that address is an old key you still have, sign in with it and rename it.</>,
    href: "#/account", label: "Your name",
  });
  else if (!publishedName(me) && !listedName(me)) tips.push({
    text: displayName.value
      ? <>Your name “{displayName.value}” isn't claimed in this community yet, so others may see “No name yet” for you. It goes on the community's list by itself once you have a little REV.</>
      : "Others see “No name yet” for you, because you haven't chosen a name.",
    href: "#/account", label: "Your name",
  });
  if (route.value.parts[0] === "inbox") tips.push({
    text: "To move collected messages to another browser, export the archive here, then use the same key and community there to import it. Keep the readable file private; it does not include your key.",
    href: "#/inbox", label: "Your archive",
  });
  if (route.value.parts[0] === "inbox" && notificationAvailable() && backgroundNotificationChoice.value === "unset") tips.push({
    text: "Want message alerts while this tab is hidden? Enable them from Inbox. Permission is requested only after you choose to enable them.",
    href: "#/inbox", label: "Inbox notifications",
  });
  if (route.value.parts[0] === "account" && notificationAvailable() && backgroundNotificationChoice.value === "declined") tips.push({
    text: "Background Inbox notifications are off. You can deliberately reconsider them here; rhogov still will not request browser permission until you press Enable notifications in Inbox.",
    href: "#/account", label: "Notification choice",
  });
  const waitingOn = pendingWrites.value.filter((p) => p.addr === me).length;
  if (waitingOn) tips.push({
    text: `${waitingOn} action${waitingOn > 1 ? "s you signed haven't" : " you signed hasn't"} reached a block yet and may still land. Check before doing ${waitingOn > 1 ? "them" : "it"} again.`,
    href: "#/account", label: "Waiting to hear about",
  });
  const unread = Object.values(inbox).reduce((a, b) => a + b, 0);
  if (unread) tips.push({ text: `${unread} new message${unread > 1 ? "s are" : " is"} waiting for you.`, href: "#/inbox", label: "Open Inbox" });
  for (const g of groups.filter((g) => membershipStatus(g, me) === "invited"))
    tips.push({ text: <>You're invited to join <b>{g.name}</b>.</>, href: `#/g/${g.id}`, label: "Open group" });
  for (const g of groups.filter((g) => membershipStatus(g, me) === "asked"))
    tips.push({ text: <>You asked to join <b>{g.name}</b>; waiting for an admin to approve.</>, href: `#/g/${g.id}`, label: "Open group" });
  for (const { name, n, to } of asking(groups, me))
    tips.push({ text: <>{n} {n > 1 ? "people are" : "person is"} asking to join <b>{name}</b>. As an admin, you approve each one.</>, href: `#${to}`, label: "Review" });
  const mine = groups.filter((g) => isMemberOf(g, me));
  // Wording kept as it was: cold-start.spec.ts asserts this string, and it is the
  // guard for "Help knows the right next step for a brand-new community". The
  // first-run case is carried by Home's own callout instead (RC-01).
  if (!mine.length) tips.push({ text: "You're not in any group yet. Join an open group, or start one and invite people.", href: "#/groups", label: "Groups" });
  const issues = (await Promise.all(mine.filter((g) => !isCouncilId(g.id)).map((g) => G.issues(g.id).then((is) => is.map((i) => ({ i, g }))).catch(() => [])))).flat()
    .filter(({ i }) => i.status === "open" && !isAuxIssue(i.id));
  const toVote = issues.filter(({ i }) => (i.voters.includes(me) || i.guests.includes(me)) && !i.ballots[me]);
  if (toVote.length) tips.push({ text: `${toVote.length} open vote${toVote.length > 1 ? "s need" : " needs"} your ballot.`, href: `#/v/${toVote[0].g.id}/${toVote[0].i.id}`, label: "Vote" });
  for (const { i, g } of issues.filter(({ i }) => !i.voters.includes(me) && !i.guests.includes(me)).slice(0, 2))
    tips.push({ text: <>You joined {g.name} after “{i.title}” opened, so it isn't open to you yet. Ask {nameOf(i.by)} to add you to it.</>, href: `#/v/${g.id}/${i.id}`, label: "Open vote" });
  const big = mine.find((g) => g.members.length >= 3 && !g.deleg[me] && !isCouncilId(g.id));
  if (big && !toVote.length) tips.push({ text: <>Can't follow every vote in {big.name}? You can hand your vote to someone you trust; voting yourself always overrides it.</>, href: `#/g/${big.id}/members`, label: "Delegate" });
  if (recentErrors.length) tips.push({ text: <>Something went wrong earlier: “{recentErrors[recentErrors.length - 1].title}”. If it keeps happening, report it; the report includes what rhogov knows.</> });
  return tips;
}

function HelpPanel({ onClose, onReport }: { onClose: () => void; onReport: () => void }) {
  const here = screenHelp();
  const [tips, setTips] = useState<Tip[] | null>(null);
  useEffect(() => { tipsFor().then(setTips, () => setTips([])); }, []);
  return (
    <Modal title="Help" onClose={onClose} actions={<button onClick={onClose}>Close</button>}>
      <div class="stack">
        <div>
          <h3>{here.title}</h3>
          <p>{here.text} <a href={here.link} target="_blank" rel="noopener">More in the guide →</a></p>
        </div>
        <div>
          <h3>For you, right now</h3>
          {tips === null ? <p class="muted">Looking at where you are…</p>
            : !tips.length ? <p class="muted">Nothing needs you. You're all set.</p>
            : <ul class="tips">{tips.map((t) => (
                <li>{t.text}{t.href && <> <a href={t.href} onClick={() => !t.href!.startsWith("javascript") && onClose()}>{t.label} →</a></>}</li>
              ))}</ul>}
        </div>
        <div class="row wrap small">
          <a href={GUIDE} target="_blank" rel="noopener">User guide</a> ·
          <a href={README} target="_blank" rel="noopener">About rhogov</a> ·
          <a href="#" onClick={(e) => { e.preventDefault(); onReport(); }}>Report a problem</a>
        </div>
      </div>
    </Modal>
  );
}

/** A tip's text as plain words, for the report. */
function plain(t: ComponentChildren): string {
  if (t === null || t === undefined || typeof t === "boolean") return "";
  if (typeof t === "string" || typeof t === "number") return String(t);
  if (Array.isArray(t)) return t.map(plain).join("");
  return plain((t as { props?: { children?: ComponentChildren } }).props?.children);
}

/**
 * What a report says about the reporter. Only public or harmless facts: the
 * address is public by design, and the key is never included (only whether one
 * is set). Shown in full, and editable, before anything leaves the page.
 */
async function snapshot(): Promise<string> {
  const c = active.value, me = myAddr.value;
  const lines: string[] = [];
  lines.push(`- rhogov version: ${__BUILD__}`);
  lines.push(`- page: ${location.origin}${location.pathname} · screen ${location.hash.split("?")[0] || "#/"}`);
  lines.push(`- browser: ${navigator.userAgent} · ${window.innerWidth}×${window.innerHeight}`);
  if (c) {
    const st = await new RNode(c.node).status().catch((e) => ({ error: (e as Error).message }) as Record<string, unknown>);
    const s = st as Record<string, any>;
    lines.push(`- node: ${c.node} · ${s.error ? `unreachable (${s.error})` : `rnode ${s.version?.node ?? "?"} · shard ${s.shardId ?? "?"} · block ${s.latestBlockNumber ?? "?"}${s.devMode ? " · dev mode" : ""}`}`);
    lines.push(`- community: ${c.name} (${communities.value.length} joined in this browser)`);
    lines.push(`  - inbox \`${c.inbox}\`\n  - group \`${c.group}\`\n  - issue \`${c.issue}\``);
  } else {
    lines.push("- community: none yet (still in setup)");
  }
  lines.push(`- identity: ${me ? `${displayName.value || "(no name)"} · \`${me}\`` : secretKey.value ? "a key that isn't valid" : "no key yet"}`);
  if (c && me) {
    const bal = await new RNode(c.node).balance(me).catch(() => null);
    lines.push(`- balance: ${bal === null ? "couldn't read" : `${bal / 1e8} REV`}`);
  }
  lines.push(`- review before signing: ${reviewBeforeSign.value ? "on" : "off"}`);
  const tips = await tipsFor().catch(() => []);
  lines.push("", "**What rhogov's Help suggested**", "");
  lines.push(...(tips.length ? tips.map((t) => `- ${plain(t.text)}`) : ["- nothing (all set)"]));
  lines.push("", "**Recent errors**", "");
  lines.push(...(recentErrors.length
    ? recentErrors.map((e) => `- ${e.at} on ${e.route}: **${e.title}**${e.detail ? ` — ${e.detail}` : ""}`)
    : ["- none this session"]));
  return lines.join("\n");
}

function ReportModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [what, setWhat] = useState("");
  const [state, setState] = useState<string | null>(null);
  useEffect(() => { snapshot().then(setState, (e) => setState(`(couldn't collect: ${(e as Error).message})`)); }, []);
  const body = `**What happened**\n\n${what.trim() || "_describe what you did, what you expected, and what you saw_"}\n\n**My setup** (collected by rhogov)\n\n${state ?? ""}\n`;
  // GitHub takes the issue from the URL; keep it within what browsers and GitHub accept.
  const url = `${NEW_ISSUE}?title=${encodeURIComponent(title.trim() || "Problem report")}&body=${encodeURIComponent(body.slice(0, 6000))}`;
  return (
    <Modal title="Report a problem" onClose={onClose}
      actions={<><button onClick={onClose}>Cancel</button><a class="btn primary" href={url} target="_blank" rel="noopener" onClick={() => setTimeout(onClose, 0)} aria-disabled={!state}>Open the report on GitHub</a></>}>
      <div class="stack">
        <p class="small muted">This opens a new issue on GitHub with the details below filled in, for you to check and submit (you need a GitHub account). Nothing is sent until you submit it there.</p>
        <label class="field">Short title<input value={title} placeholder="e.g. Start community fails on the playground" onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></label>
        <label class="field">What happened<textarea rows={4} value={what} placeholder="What you did, what you expected, and what you saw." onInput={(e) => setWhat((e.target as HTMLTextAreaElement).value)} /></label>
        <div class="field">What rhogov adds about your setup
          <span class="hint">Your address and contract addresses are public. Your key is never included.</span>
          <pre class="code" style={{ whiteSpace: "pre-wrap" }}>{state ?? "Collecting…"}</pre>
        </div>
      </div>
    </Modal>
  );
}

/** The Help block in the menu. */
export function Help() {
  const [panel, setPanel] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [open, setOpen] = useState(false); // phones: the links fold into one menu item
  return (
    <div class={`help ${open ? "open" : ""}`}>
      <div class="help-title">Help</div>
      <button class="help-toggle" aria-expanded={open} onClick={() => setOpen(!open)}><span aria-hidden="true">?</span> Help</button>
      <div class="help-links" onClick={() => setOpen(false)}>
        <a href="#" onClick={(e) => { e.preventDefault(); setPanel(true); }}><span aria-hidden="true">✦</span> Help for you</a>
        <a href={GUIDE} target="_blank" rel="noopener"><span aria-hidden="true">?</span> User guide</a>
        <a href={README} target="_blank" rel="noopener"><span aria-hidden="true">ⓘ</span> About rhogov</a>
        <a href="#" onClick={(e) => { e.preventDefault(); setReporting(true); }}><span aria-hidden="true">⚠</span> Report a problem</a>
      </div>
      {panel && <HelpPanel onClose={() => setPanel(false)} onReport={() => { setPanel(false); setReporting(true); }} />}
      {reporting && <ReportModal onClose={() => setReporting(false)} />}
    </div>
  );
}
