import { render } from "preact";
import { useEffect } from "preact/hooks";
import { syncMyName } from "./ui/name-sync";
import { Help } from "./ui/help";
import { UpdateBanner, watchForUpdates } from "./ui/update";
import { checkInbox, titleWithCount, waitingCount } from "./ui/inbox-watch";
import "./styles.css";
import { active, displayName, myAddr, refreshTick } from "./state";
import { AccountScreen, CommunityScreen, JoinScreen } from "./ui/settings";
import { GroupScreen, GroupsScreen } from "./ui/groups";
import { HomeScreen } from "./ui/home";
import { InboxScreen } from "./ui/inbox";
import { ReviewModal, Toasts, route, short } from "./ui/kit";
import { Welcome } from "./ui/setup";
import { IssueScreen } from "./ui/votes";
import { CouncilScreen, CouncilsScreen } from "./ui/council";


const NAV = [
  ["/", "⌂", "Home"],
  ["/groups", "◎", "Groups"],
  ["/councils", "⚖", "Councils"],
  ["/inbox", "✉", "Inbox"],
  ["/community", "⚑", "Community"],
  ["/account", "☺", "Account"],
] as const;

function Page() {
  const { parts, query } = route.value;
  const [head, a, b] = parts;
  if (head === "join") return <JoinScreen query={query} />;
  if (head === "welcome" || !myAddr.value || !active.value) return <Welcome />;
  switch (head) {
    case undefined: return <HomeScreen />;
    case "groups": return <GroupsScreen />;
    case "g": return <GroupScreen gid={a} tab={b} />;
    case "v": return <IssueScreen gid={a} iid={b} />;
    case "councils": return <CouncilsScreen />;
    case "c": return <CouncilScreen cid={a} tab={b} sub={parts[3]} />;
    case "inbox": return <InboxScreen />;
    case "community": return <CommunityScreen />;
    case "account": return <AccountScreen />;
    default: return <div class="empty">Nothing here. <a href="#/">Home</a></div>;
  }
}

function App() {
  const ready = !!myAddr.value && !!active.value;
  // Re-checked with every refresh, so a newcomer's name goes on the list as soon
  // as they have the REV for it, and everyone's names stay current.
  useEffect(() => { if (ready) syncMyName(); }, [ready, active.value?.group, myAddr.value, refreshTick.value]);
  useEffect(() => { if (ready) checkInbox(); }, [ready, active.value?.inbox, myAddr.value, refreshTick.value]);
  useEffect(() => { waitingCount.value = null; }, [active.value?.inbox, myAddr.value]);
  useEffect(() => { document.title = titleWithCount("rhogov"); }, [waitingCount.value]);
  const path = "/" + (route.value.parts[0] ?? "");
  const on = (p: string) => (p === "/" ? path === "/" : path.startsWith(p) || (p === "/groups" && (path === "/g" || path === "/v")) || (p === "/councils" && path === "/c"));
  return (
    <div class="app">
      <nav class="side">
        <div class="brand"><span class="logo">ρ</span> rhogov</div>
        {ready && <div class="nav">{NAV.map(([p, icon, label]) => <a href={`#${p}`} class={on(p) ? "on" : ""}><span aria-hidden="true">{icon}</span> {label}{p === "/inbox" && (waitingCount.value ?? 0) > 0 && <span class="count" aria-label={`${waitingCount.value} new`}>{waitingCount.value}</span>}</a>)}</div>}
        <Help />
        <div class="build muted" title="The version of rhogov this page is running">version {__BUILD__}</div>
        {ready && <div class="foot"><div><b>{active.value!.name}</b></div><div>{displayName.value} · <span class="mono">{short(myAddr.value!)}</span></div></div>}
      </nav>
      <main><UpdateBanner /><Page /></main>
      <Toasts />
      <ReviewModal />
    </div>
  );
}

render(<App />, document.getElementById("app")!);
watchForUpdates();
