// help.tsx — Help in the menu: the user guide, the README, and a problem report
// that carries the reporter's state, so a bug report says what they were running
// and where, without anyone having to ask.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { isAuxIssue, isCouncilId } from "../chain/council";
import { RNode } from "../chain/node";
import { active, communities, displayName, gov, listedName, myAddr, publishedName, reviewBeforeSign, secretKey } from "../state";
import { Modal, nameOf, recentErrors, route } from "./kit";
import { newVersion } from "./update";

const REPO = "https://github.com/rchain-community/rhogov";
export const GUIDE = `${REPO}/blob/main/docs/user-guide.md`;
export const README = `${REPO}#readme`;
const NEW_ISSUE = `${REPO}/issues/new`;

// --- help that knows where you are ------------------------------------------------

const section = (n: string) => `${GUIDE}#${n}`;

/** The screen you're on: what it's for, and the guide section that explains it. */
function screenHelp(): { title: string; text: string; link: string } {
  const [head, , tab] = route.value.parts;
  if (head === "welcome" || !myAddr.value || !active.value)
    return { title: "Getting started", text: "Three steps: choose a network, create (or bring) your key, then join a community with an invite link or start your own.", link: section("1-getting-started") };
  switch (head) {
    case undefined: return { title: "Home", text: "What needs you now: votes waiting for your ballot, invitations, and new messages.", link: section("4-voting") };
    case "groups": return { title: "Groups", text: "The groups in this community. Join an open one, or start your own and invite people.", link: section("3-groups") };
    case "g":
      if (tab === "members") return { title: "Members", text: "Who is in the group, how much they're trusted, and who votes for whom. Rate trust, delegate your vote, or censure from here.", link: section("6-trust") };
      return { title: "A group", text: "Its votes, members and settings. Open a vote, or vote on one that's open.", link: section("3-groups") };
    case "v": return { title: "A vote", text: "Choose one or more options (or rank them) and press Vote. You can change your vote while it's open. The node counts it, with trust and delegation.", link: section("4-voting") };
    case "councils": case "c": return { title: "Councils", text: "Decisions across stakeholder groups: estimate each group's voting power, deliberate with pros and cons, then vote.", link: section("9-councils-decisions-across-stakeholder-groups") };
    case "inbox": return { title: "Inbox", text: "Messages and invitations sent to you. Collect them to read them; they then live in this browser.", link: section("8-inbox") };
    case "community": return { title: "Community", text: "The invite link to share, where the community lives on chain, and switching communities.", link: section("2-communities-and-invitations") };
    case "account": return { title: "Account", text: "Your name, your address, your balance, and backing up your key.", link: section("10-your-account-and-your-key") };
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
  if (!publishedName(me) && !listedName(me)) tips.push({
    text: displayName.value
      ? <>Others still see your address, not “{displayName.value}”. Your name goes on the community's list by itself once you have a little REV.</>
      : "Others see your address because you haven't chosen a name.",
    href: "#/account", label: "Your name",
  });
  const unread = Object.values(inbox).reduce((a, b) => a + b, 0);
  if (unread) tips.push({ text: `${unread} new message${unread > 1 ? "s are" : " is"} waiting for you.`, href: "#/inbox", label: "Open Inbox" });
  for (const g of groups.filter((g) => g.invited.includes(me) && !g.members.some((m) => m.addr === me)))
    tips.push({ text: <>You're invited to join <b>{g.name}</b>.</>, href: `#/g/${g.id}`, label: "Open group" });
  const mine = groups.filter((g) => g.members.some((m) => m.addr === me));
  if (!mine.length) tips.push({ text: "You're not in any group yet. Join an open group, or start one and invite people.", href: "#/groups", label: "Groups" });
  const issues = (await Promise.all(mine.filter((g) => !isCouncilId(g.id)).map((g) => G.issues(g.id).then((is) => is.map((i) => ({ i, g }))).catch(() => [])))).flat()
    .filter(({ i }) => i.status === "open" && !isAuxIssue(i.id));
  const toVote = issues.filter(({ i }) => (i.voters.includes(me) || i.guests.includes(me)) && !i.ballots[me]);
  if (toVote.length) tips.push({ text: `${toVote.length} open vote${toVote.length > 1 ? "s need" : " needs"} your ballot.`, href: `#/v/${toVote[0].g.id}/${toVote[0].i.id}`, label: "Vote" });
  for (const { i, g } of issues.filter(({ i }) => !i.voters.includes(me) && !i.guests.includes(me)).slice(0, 2))
    tips.push({ text: <>You joined {g.name} after “{i.title}” opened, so you can't vote on it yet. Ask {nameOf(i.by)} to add new members to its roll.</>, href: `#/v/${g.id}/${i.id}`, label: "Open vote" });
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
