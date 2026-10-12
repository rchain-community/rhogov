// setup.tsx — getting started: network, identity, community. Also the Account screen pieces.
import { GUIDE } from "./help";
import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { Gov } from "../chain/gov";
import { generateKey, isValidKey, revAddressOf } from "../chain/keys";
import { nameError } from "../chain/people";
import { RNode, StillUnknown, type NodeStatus } from "../chain/node";
import {
  NETWORKS, R_WALLET, active, addCommunity, displayName, keyName, myAddr, parseInvite, secretKey, setKey,
} from "../state";
import { Copy, Info, Spinner, act, go, notify, short } from "./kit";

export const setupNode = signal<string>(localStorage.getItem("rhogov:setupNode") ?? NETWORKS[0].url);
export const setSetupNode = (u: string) => { setupNode.value = u; try { localStorage.setItem("rhogov:setupNode", u); } catch { /* storage refused */ } };

export function useNodeStatus(url: string) {
  const [s, setS] = useState<{ status?: NodeStatus; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let live = true;
    setS({ loading: true });
    new RNode(url).status().then((status) => live && setS({ status, loading: false }), (e) => live && setS({ error: e.message, loading: false }));
    return () => { live = false; };
  }, [url]);
  return s;
}

/** The one install deploy reserves 2,000,000 phlo at price 1 = 2,000,000 dust (0.02 REV). */
const INSTALL_NEEDS = 2_000_000;

export const rev = (dust: number | null | undefined) => (dust == null ? "—" : `${(dust / 1e8).toLocaleString(undefined, { maximumFractionDigits: 4 })} REV`);

/**
 * What rhogov is for, in one sentence. Home and the welcome screen both open with
 * it: the welcome screen is mounted once and never again, so a purpose stated only
 * there is stated to nobody after the first minute (CS-001). One source, so the
 * wording is fixed in one place.
 */
export const PURPOSE = "Decide things together on RChain: groups, delegated voting, trust, and private inboxes — all on chain, with no administrator in the middle.";

// --- network --------------------------------------------------------------------

export function NetworkPicker({ value, onChange }: { value: string; onChange: (u: string) => void }) {
  const preset = NETWORKS.find((n) => n.url === value);
  const [custom, setCustom] = useState(preset ? "" : value);
  const s = useNodeStatus(value);
  return (
    <div class="stack">
      {NETWORKS.map((n) => (
        <label class={`choice ${value === n.url ? "on" : ""}`}>
          <input type="radio" name="net" checked={value === n.url} onChange={() => onChange(n.url)} />
          <div><b>{n.label}</b> <span class="mono muted">{n.url}</span><div class="muted small">{n.note}</div></div>
        </label>
      ))}
      <label class={`choice ${!preset ? "on" : ""}`}>
        <input type="radio" name="net" checked={!preset} onChange={() => custom && onChange(custom)} />
        <div class="grow">
          <b>Another node</b>
          <div class="row" style={{ marginTop: ".3rem" }}>
            <input class="grow" placeholder="https://your-node:40403" value={custom} onInput={(e) => setCustom((e.target as HTMLInputElement).value)} />
            <button class="small" onClick={() => /^https?:\/\//.test(custom) && onChange(custom.trim())}>Use</button>
          </div>
        </div>
      </label>
      <div class="small">
        {s.loading ? <span><Spinner /> Checking {value}…</span>
          : s.error ? <span class="badge danger">Can't reach it</span>
          : <span class="row"><span class="badge accent">Connected</span><span class="muted">shard {s.status?.shardId} · block {s.status?.latestBlockNumber} · rnode {s.status?.version?.node}{s.status?.devMode ? " · dev mode" : ""}</span></span>}
        {s.error && <div class="muted small" style={{ marginTop: ".3rem" }}>{s.error}. If it's a local node, start it with <span class="mono">--api-host 127.0.0.1</span>; a page served over https can only reach http on localhost.</div>}
      </div>
    </div>
  );
}

// --- identity -------------------------------------------------------------------

export function IdentityForm({ onDone }: { onDone?: () => void }) {
  const [mode, setMode] = useState<"new" | "import">("new");
  const [name, setName] = useState(displayName.value);
  const [imp, setImp] = useState("");
  const [fresh] = useState(generateKey);
  // An existing key brings its own name: look it up as soon as the key is valid.
  const [found, setFound] = useState<{ key: string; name: string | null } | null>(null);
  const impKey = imp.trim().replace(/^0x/, "");
  useEffect(() => {
    if (mode !== "import" || !isValidKey(impKey)) { setFound(null); return; }
    let live = true;
    keyName(setupNode.value, revAddressOf(impKey)).then((n) => { if (live) setFound({ key: impKey, name: n }); });
    return () => { live = false; };
  }, [mode, impKey]);
  const keysName = mode === "import" && found?.key === impKey ? found.name : null;
  const looking = mode === "import" && isValidKey(impKey) && found?.key !== impKey;
  const chosen = keysName ?? name.trim();
  const valid = mode === "new" || isValidKey(impKey);
  const bad = keysName ? "" : nameError(name);
  const save = () => {
    if (!valid || looking || bad) return;
    setKey(mode === "new" ? fresh : impKey, chosen);
    onDone?.();
  };
  return (
    <div class="stack">
      {keysName ? (
        <div class="callout small">This key is <b>{keysName}</b>. That name comes with it; you can change it later on <b>Account</b>.</div>
      ) : (
        <label class="field">Your name
          <span class="hint">{mode === "import" ? "If this key already has a name, it keeps that name." : "What others call you."} Unique in each community; capitals count; it can't start with a number.</span>
          <input value={name} placeholder="e.g. Ada" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          {name.trim() && bad && <span class="badge danger">{bad}</span>}
        </label>
      )}
      <div class="seg" role="tablist">
        <button class={mode === "new" ? "on" : ""} onClick={() => setMode("new")}>Create a new key</button>
        <button class={mode === "import" ? "on" : ""} onClick={() => setMode("import")}>I have a key</button>
      </div>
      {mode === "new" ? (
        <div class="card soft small">
          A new key was made in this browser. Your address will be <span class="mono">{short(revAddressOf(fresh))}</span>.
          It never leaves this device; you can back it up from <b>Account</b> afterwards.
        </div>
      ) : (
        <label class="field">Private key (64 hex characters)
          <span class="hint">From r-wallet, quantum-os <span class="mono">/rholang key show</span>, or another rhogov browser.</span>
          <input class="mono" value={imp} onInput={(e) => setImp((e.target as HTMLInputElement).value)} placeholder="0b60b3ff…" autocomplete="off" />
          {imp && !isValidKey(impKey) && <span class="badge danger">That isn't a valid secp256k1 key</span>}
          {isValidKey(impKey) && <span class="muted small">Address: <span class="mono">{revAddressOf(impKey)}</span></span>}
        </label>
      )}
      <div><button class="primary" disabled={!valid || looking || !!bad} onClick={save}>{looking ? "Looking up this key…" : "Continue"}</button></div>
    </div>
  );
}

/**
 * One refresh signal for every balance on screen. The setup page shows the same
 * balance twice (the identity step and the community form, which needs it to
 * enable "Start community"), so a faucet request in one must refresh both.
 */
const balanceTick = signal(0);
const refreshBalances = () => { balanceTick.value++; };

export function Balance({ node, addr, onBalance }: { node: string; addr: string; onBalance?: (b: number | null) => void }) {
  const [bal, setBal] = useState<number | null | undefined>(undefined);
  const tick = balanceTick.value;
  const st = useNodeStatus(node);
  useEffect(() => {
    new RNode(node).balance(addr).then((b) => { setBal(b); onBalance?.(b); }, () => { setBal(null); onBalance?.(null); });
  }, [node, addr, tick]);
  const faucet = async () => {
    try {
      await new RNode(node).faucet(addr);
      notify("Test REV requested", "It arrives with the next block — usually a few seconds.");
      // Re-read until it shows up, rather than once and hoping; a slow block can take a minute.
      for (const ms of [3000, 6000, 10000, 16000, 25000, 40000, 60000, 90000]) setTimeout(refreshBalances, ms);
    } catch (e) { notify("Faucet unavailable", (e as Error).message, "error"); }
  };
  return (
    <span class="row">
      <b>{bal === undefined ? <Spinner /> : rev(bal)}</b>
      <button class="ghost small" onClick={refreshBalances}>Refresh</button>
      {st.status?.devMode && <button class="small" onClick={faucet}>Get test REV</button>}
      {st.status && !st.status.devMode && (
        <span class="small">This node has no faucet. On the RChain testnet, <a href={R_WALLET} target="_blank" rel="noopener">r-wallet</a>'s faucet can fund <button class="ghost small" onClick={() => navigator.clipboard?.writeText(addr)}>your address ⧉</button>; elsewhere, ask someone to send you REV.</span>
      )}
      {bal === 0 && <span class="muted small">Every action costs a little phlo (gas), paid in REV.</span>}
    </span>
  );
}

// --- community ----------------------------------------------------------------

export function CommunityForm({ node }: { node: string }) {
  const [tab, setTab] = useState<"join" | "start">("join");
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [bal, setBal] = useState<number | null | undefined>(undefined);
  const invite = parseInvite(link);
  const join = () => { if (invite) { addCommunity(invite); go("/"); } };
  // An install that was sent but never confirmed (a stalled network, a closed
  // tab): remembered, so pressing Start again looks for it rather than paying
  // for a second set of contracts.
  const pendingKey = `rhogov:pending-install:${node}:${myAddr.value}`;
  const [pending, setPending] = useState<{ sig: string; name: string } | null>(() => { try { return JSON.parse(localStorage.getItem(pendingKey) ?? "null"); } catch { return null; } });
  const remember = (p: { sig: string; name: string } | null) => {
    setPending(p);
    try { if (p) localStorage.setItem(pendingKey, JSON.stringify(p)); else localStorage.removeItem(pendingKey); } catch { /* storage refused */ }
  };
  const start = async () => {
    const key = secretKey.value;
    const cname = (pending?.name ?? name).trim();
    if (!key || !cname) return;
    setBusy(true);
    let unknown = false;
    const uris = await act("Starting your community", async (t) => {
      try {
        return await Gov.install(node, key, t, { resume: pending?.sig, onSubmitted: (sig) => remember({ sig, name: cname }) });
      } catch (e) {
        // Still unknown: keep remembering it. Definitely not carried, or failed: forget it.
        if (e instanceof StillUnknown) unknown = true; else remember(null);
        throw e;
      }
    }, { risk: "irreversible", key: `install:${node}:${myAddr.value}`, done: "Three contracts installed: Inbox, Group, Issue." });
    setBusy(false);
    if (uris) { remember(null); addCommunity({ name: cname, node, ...uris }); go("/groups"); }
    else if (!unknown) remember(null);
  };
  return (
    <div class="stack">
      <div class="seg">
        <button class={tab === "join" ? "on" : ""} onClick={() => setTab("join")}>Join with an invite link</button>
        <button class={tab === "start" ? "on" : ""} onClick={() => setTab("start")}>Start a new community</button>
      </div>
      {tab === "join" ? (
        <>
          <label class="field">Invite link
            <span class="hint">Someone in the community can copy it from <b>Settings → Invite people</b>.</span>
            <textarea rows={3} class="mono" value={link} onInput={(e) => setLink((e.target as HTMLTextAreaElement).value)} placeholder="https://…#/join?c=…" />
          </label>
          {link && !invite && <span class="badge danger">That doesn't look like a rhogov invite link</span>}
          {invite && <div class="card soft small"><b>{invite.name}</b> on <span class="mono">{invite.node}</span></div>}
          <div><button class="primary" disabled={!invite} onClick={join}>Join community</button></div>
        </>
      ) : (
        <>
          {pending && (
            <div class="callout warn small stack">
              <span>You started <b>{pending.name}</b> earlier and it hasn't confirmed yet. <b>Look for “{pending.name}”</b> checks whether it was carried, instead of installing another (which would cost again).</span>
              <span><button class="ghost small" onClick={() => { if (confirm(`Forget "${pending.name}" and install a new community? If the earlier one is carried later, you'll have paid for both.`)) remember(null); }}>Forget it and start fresh</button></span>
            </div>
          )}
          <label class="field">Community name
            <input value={name} placeholder="e.g. RChain Cooperative" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
          <p class="muted small">This deploys three governance contracts — Inbox, Group and Issue — on <span class="mono">{node}</span>, signed by your key. It takes one block and about 0.02 REV. Anyone you invite uses the same contracts.</p>
          <Info title="What gets installed, and where">
            The contracts are quantum-os's <b>rgov-core</b>. They store facts only — members, delegations, trust ratings, censures, ballots — and every write can only change the signer's own row, because your identity is derived on chain from your key. Trust levels, censure, vote weights and the tally are computed by the node's built-in <span class="mono">rho:gov:*</span> functions, so nobody (including you, the installer) controls the outcome. As installer you have no power inside any group.
          </Info>
          {myAddr.value && <div class="small">Your balance: <Balance node={node} addr={myAddr.value} onBalance={setBal} /></div>}
          {bal !== undefined && bal !== null && bal < INSTALL_NEEDS && <div class="callout warn small">Starting a community needs about {(INSTALL_NEEDS / 1e8).toFixed(2)} REV to cover the install's fee. Get test REV first, and wait a few seconds for it to arrive.</div>}
          <div><button class="primary" disabled={!(pending?.name ?? name).trim() || busy || !secretKey.value || (!pending && bal != null && bal < INSTALL_NEEDS)} onClick={start}>{busy ? <><Spinner /> {pending ? "Looking…" : "Installing…"}</> : pending ? `Look for “${pending.name}”` : "Start community"}</button></div>
        </>
      )}
    </div>
  );
}

// --- the welcome flow --------------------------------------------------------------

export function Welcome() {
  const hasKey = !!myAddr.value;
  // Arriving with a community already chosen but no key (from an invite, or after
  // switching keys inside a community): the community answers the network and
  // the community steps. Only your name and key are asked, then you're in (#10).
  const [joining] = useState(() => (active.value && !myAddr.value ? active.value : null));
  useEffect(() => { if (joining && setupNode.value !== joining.node) setSetupNode(joining.node); }, []);
  useEffect(() => { if (joining && hasKey) go("/"); }, [hasKey]);
  const [netDone, setNetDone] = useState(hasKey || !!joining);
  const step = !netDone ? 1 : !hasKey ? 2 : 3;
  const cls = (n: number) => (step > n ? "step done" : step === n ? "step current" : "step");
  return (
    <div class="stack" style={{ maxWidth: 680 }}>
      <div>
        <h1>Welcome to rhogov</h1>
        <p class="muted">{PURPOSE}</p>
        <p class="small">New here? <a href={GUIDE} target="_blank" rel="noopener">Read the user guide</a> — five minutes.</p>
      </div>
      <div class="steps">
        <div class={cls(1)}>
          <div class="n">1</div>
          <div class="card">
            <h3>Choose a network</h3>
            {step === 1 ? (<><NetworkPicker value={setupNode.value} onChange={setSetupNode} /><div style={{ marginTop: ".8rem" }}><button class="primary" onClick={() => setNetDone(true)}>Continue</button></div></>)
              : joining ? <div class="small"><span class="mono">{joining.node}</span> <span class="muted">· from your invite to {joining.name}</span></div>
              : <div class="row between"><span class="mono small">{setupNode.value}</span><button class="ghost small" onClick={() => setNetDone(false)}>Change</button></div>}
          </div>
        </div>
        <div class={cls(2)}>
          <div class="n">2</div>
          <div class="card">
            <h3>Your identity</h3>
            {step === 2 ? <IdentityForm />
              : step > 2 ? (
                <div class="stack small">
                  <div class="row between"><span><b>{displayName.value}</b> · <span class="mono">{short(myAddr.value!)}</span> <Copy text={myAddr.value!} /></span>
                    <button class="ghost small" onClick={() => { if (confirm("Forget this key? Back it up first if it holds anything.")) setKey(null); }}>Use another</button></div>
                  <Balance node={setupNode.value} addr={myAddr.value!} />
                </div>
              ) : <p class="muted small">A key in this browser signs everything you do. No account, no email.</p>}
          </div>
        </div>
        <div class={cls(3)}>
          <div class="n">3</div>
          <div class="card">
            <h3>{joining ? `Join ${joining.name}` : "Join or start a community"}</h3>
            {joining ? <p class="muted small">You're joining <b>{joining.name}</b>; it opens as soon as you have a key.</p>
              : step === 3 ? <CommunityForm node={setupNode.value} /> : <p class="muted small">A community is one set of governance contracts that its groups share.</p>}
          </div>
        </div>
      </div>
      {active.value && <p class="small"><a href="#/">Back to {active.value.name}</a></p>}
    </div>
  );
}
