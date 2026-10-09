// setup.tsx — getting started: network, identity, community. Also the Account screen pieces.
import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { Gov } from "../chain/gov";
import { generateKey, isValidKey, revAddressOf } from "../chain/keys";
import { RNode, type NodeStatus } from "../chain/node";
import {
  NETWORKS, R_WALLET, active, addCommunity, displayName, myAddr, parseInvite, secretKey, setDisplayName, setKey,
} from "../state";
import { Copy, Info, Spinner, act, go, notify, short } from "./kit";

export const setupNode = signal<string>(localStorage.getItem("rhogov:setupNode") ?? NETWORKS[0].url);
const setSetupNode = (u: string) => { setupNode.value = u; localStorage.setItem("rhogov:setupNode", u); };

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
  const valid = mode === "new" || isValidKey(imp);
  const save = () => {
    if (!name.trim() || !valid) return;
    setDisplayName(name.trim());
    setKey(mode === "new" ? fresh : imp.trim().replace(/^0x/, ""));
    onDone?.();
  };
  return (
    <div class="stack">
      <label class="field">Your name
        <span class="hint">What others see when you join a group. You can use a different name per group.</span>
        <input value={name} placeholder="e.g. Ada" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
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
          {imp && !isValidKey(imp) && <span class="badge danger">That isn't a valid secp256k1 key</span>}
          {isValidKey(imp) && <span class="muted small">Address: <span class="mono">{revAddressOf(imp)}</span></span>}
        </label>
      )}
      <div><button class="primary" disabled={!name.trim() || !valid} onClick={save}>Continue</button></div>
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
  const start = async () => {
    const key = secretKey.value;
    if (!key || !name.trim()) return;
    setBusy(true);
    const uris = await act("Starting your community", (t) => Gov.install(node, key, t), { done: "Three contracts installed: Inbox, Group, Issue." });
    setBusy(false);
    if (uris) { addCommunity({ name: name.trim(), node, ...uris }); go("/groups"); }
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
          <label class="field">Community name
            <input value={name} placeholder="e.g. RChain Cooperative" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
          <p class="muted small">This deploys three governance contracts — Inbox, Group and Issue — on <span class="mono">{node}</span>, signed by your key. It takes three blocks and a little REV. Anyone you invite uses the same contracts.</p>
          <Info>
            The contracts are quantum-os's <b>rgov-core</b>. They store facts only — members, delegations, trust ratings, censures, ballots — and every write can only change the signer's own row, because your identity is derived on chain from your key. Trust levels, censure, vote weights and the tally are computed by the node's built-in <span class="mono">rho:gov:*</span> functions, so nobody (including you, the installer) controls the outcome. As installer you have no power inside any group.
          </Info>
          {myAddr.value && <div class="small">Your balance: <Balance node={node} addr={myAddr.value} onBalance={setBal} /></div>}
          {bal !== undefined && bal !== null && bal < INSTALL_NEEDS && <div class="callout warn small">Starting a community needs about {(INSTALL_NEEDS / 1e8).toFixed(2)} REV to cover three deploys' fees. Get test REV first, and wait a few seconds for it to arrive.</div>}
          <div><button class="primary" disabled={!name.trim() || busy || !secretKey.value || (bal != null && bal < INSTALL_NEEDS)} onClick={start}>{busy ? <><Spinner /> Installing…</> : "Start community"}</button></div>
        </>
      )}
    </div>
  );
}

// --- the welcome flow --------------------------------------------------------------

export function Welcome() {
  const hasKey = !!myAddr.value;
  const [netDone, setNetDone] = useState(hasKey);
  const step = !netDone ? 1 : !hasKey ? 2 : 3;
  const cls = (n: number) => (step > n ? "step done" : step === n ? "step current" : "step");
  return (
    <div class="stack" style={{ maxWidth: 680 }}>
      <div>
        <h1>Welcome to rhogov</h1>
        <p class="muted">Decide things together on RChain: groups, delegated voting, trust, and private inboxes — all on chain, with no administrator in the middle.</p>
        <p class="small">New here? <a href="https://github.com/rchain-community/rhogov/blob/main/docs/user-guide.md" target="_blank" rel="noopener">Read the user guide</a> — five minutes.</p>
      </div>
      <div class="steps">
        <div class={cls(1)}>
          <div class="n">1</div>
          <div class="card">
            <h3>Choose a network</h3>
            {step === 1 ? (<><NetworkPicker value={setupNode.value} onChange={setSetupNode} /><div style={{ marginTop: ".8rem" }}><button class="primary" onClick={() => setNetDone(true)}>Continue</button></div></>)
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
            <h3>Join or start a community</h3>
            {step === 3 ? <CommunityForm node={setupNode.value} /> : <p class="muted small">A community is one set of governance contracts that its groups share.</p>}
          </div>
        </div>
      </div>
      {active.value && <p class="small"><a href="#/">Back to {active.value.name}</a></p>}
    </div>
  );
}
