# CLAUDE.md — rhogov

Project context for Claude Code sessions. Read it before changing anything.

## What this is

**rhogov** is a governance app for the [rholo](https://github.com/rhovision-org/rholo)
node: groups, liquid democracy, a web of trust with censure, multi-stakeholder councils and
inboxes, all on chain. It is the successor UI to rgov. It runs on
[quantum-os](https://github.com/rhovision-org/quantum-os)'s rgov-core contracts and
rholo's `rho:gov:*` natives.

- **Live:** https://rhovision-org.github.io/rhogov/. Every push to `main` deploys it
  through `.github/workflows/pages.yml`.
- **Default network:** the Rholang playground, https://playground.rhobot.net. It's a
  dev-mode node with a faucet and **no name directory**.
- **Backlog:** the repo's GitHub issues, labelled `inbox`, `names`, `upstream`, `testing`
  and `enhancement`.
- **User docs:** [`docs/user-guide.md`](docs/user-guide.md) and [`README.md`](README.md).
  The app's Help menu links to both.

## Principles: keep these true

- **Serverless, except for rnode.** The build is **one self-contained `index.html`**
  (vite-plugin-singlefile), plus a `version.json` beside it.
  - Its only network peer is the rnode HTTP API the user chose.
  - Don't add a backend, relay, database, analytics or third-party script.
- **The key never leaves the browser.** It signs locally: secp256k1 over blake2b256 of
  `DeployDataProto`, in `src/chain/keys.ts`.
  - Nothing may log, send or report the key.
  - Help → Report a problem says whether a key is set, never the key itself, and
    `newcomer.spec.ts` asserts that.
- **State lives in contracts; computation is native; no policy lives in a contract.**
  - Standing, weights and outcomes come from `rho:gov:*` in one read-only query
    (`standingProgram` in `gov.ts`). Anyone can recompute them.
  - Don't reimplement tallying, trust or delegation in TypeScript to show *results*.
    Client-side code may only *preview* or *explain* them.
- **Councils are conventions over the same three contracts.** There is no extra
  contract; the README's "stored as" table is the spec.
  - Chambers are `<councilId>.<slug>`.
  - Voting-power estimates live on `<cid>.weights`.
  - Pros and cons live on `<iid>.args`.
  - The phase is recorded in the facilitator's result.
- **`src/chain/rgov-core.js` is vendored from quantum-os.**
  - Don't edit it here: change it upstream, then run `scripts/sync-rgov-core.sh ../quantum-os`.
  - A contract change belongs in a quantum-os issue or PR. Example: inbox history,
    quantum-os#241.
- **Names, not addresses.** People are shown by name everywhere, with their REV address
  one click away.
  - Display a person with `Addr` / `nameOf`.
  - Pick a person with `PersonField`, which takes a name or an address. To choose from a
    list already on screen, use `usePeopleFilter`. Both work as you type: names that start
    with the typed text are offered or kept, while text starting with a digit is matched as
    an address. Every new person picker should use one of them.
  - Names come from the chain's name directory where one exists. Otherwise they come from
    the community's hidden `~names` group (`Gov.names` / `setName`).
  - The address book combines **community-scoped labels and claims** with a
    **network-scoped authoritative directory cache** (`inScope` in `state.ts`).
    Labels and `~names` claims from another community never show, while authoritative
    directory names survive switches between communities on the same network.
    Uniqueness uses `looksLike`/`nameSkeleton` (look-alikes collide).
  - Names are unique **within a community**, case-sensitive, and never start with a digit
    (`nameError` in `people.ts`). Typed text starting with a digit is an address.
  - **A name belongs to its key.** Switching keys (`setKey`) drops the old name; the new
    key's own name is looked up (`keyName`) and adopted, and `syncMyName` only renames
    on an explicit Save. Only claims (the name list or the directory) count; a group
    label that collides with a claim shows as "Name (unclaimed)".

## Layout

```
src/chain/  node.ts (rnode HTTP: status/explore/deploy/outcome/balance/faucet, RhoExpr decode,
                     InsufficientFunds pre-check)
            keys.ts (identity, REV address, deploy signing)
            keystore.ts (the key as a Web3 Secret Storage v3 file: scrypt + aes-128-ctr)
            gov.ts (typed Gov API over rgov-core + the native standing query; batch(); names)
            council.ts (multi-stakeholder conventions, median power, combination, approvals)
            people.ts (resolvePerson: name or address → person)
            profile.ts (master-dictionary names; NoDirectory fallback)
            rgov-core.js (vendored)
src/ui/     kit.tsx (routing, useAsync, act(), toasts/cards, Addr, Copy, PersonField, Modal)
            setup.tsx (welcome: network → identity → community; Balance + faucet)
            home, groups, votes, council, inbox, settings (screens)
            help.tsx (state-aware Help panel + problem report)   update.tsx (new-version banner)
            inbox-watch.ts (new-message alerts)   name-sync.ts (publish/list your name)
src/state.ts  networks, chains (per-chain key/name/communities, resets: #89), key, communities,
              address book, refresh ticks (15 s poll)
tests/        unit.ts   chain-check.ts (live API)   e2e/*.spec.ts (Playwright, file:// build)
```

## Conventions

- **Every chain write goes through `act(title, run, {risk, key})`** (in `kit.tsx`). Both
  fields are required, so a new call site cannot be written without saying how much the
  write can cost the person (`risk`: `routine`, `consequential`, `irreversible`) and what
  it is (`key`, which identifies the write — the same one can't run twice at once, and a
  different target never collides with it).
  - **Ask a question only where the call site states one**, in `confirm`. Deriving a
    question from `risk` was tried and removed: it is confirm fatigue, and a dialog is
    more often dismissed unread than read. An explanation belongs in the screen or modal
    the person is already looking at.
  - Never advise repeating a write that may still land:
  `RNode.deploy` throws `StillUnknown` (keep the signature, don't retry), `NotCarried` (safe
  to retry) or `DeployFailed` (ran and failed, fee charged). A reasonless refusal is
  checked for 2 minutes before either verdict.
  - It shows the centred, draggable progress card ("Waiting N s") and refreshes after the
    write.
  - On failure it shows a persistent error card and logs to `recentErrors`.
  - Error messages must say what to do, not just what failed. `InsufficientFunds` and the
    explanation of the node's opaque "not available in cache" error are the model.
- **Multi-step writes on one contract use `Gov.batch`**: one deploy, one block. The
  community install is one deploy.
- **Reads use the newest block**, not the last finalized one: `explore-deploy-by-block-hash`
  in `RNode.explore`.
- **A new screen or feature updates three places:**
  - `screenHelp()` and, if it creates a "next step", `tipsFor()` in `help.tsx`;
  - the user guide, keeping its section anchors stable, because Help links to them;
  - the README if it changes what rhogov does.
- **Keep the copy plain and direct.** Explain trade-offs to the person rather than hiding
  them; the existing toasts and Help tips show the tone.
  - **A mechanism's name belongs in the explanation; the control says what it does.** A
    button labelled "Censure" or "…to the roll" asks the reader to know the mechanism
    before they can act. Use the plain words in `PLAIN` (`kit.tsx`) for the control, and
    keep the precise term in the `Info` beside it for anyone who wants it.
  - **A claim in the copy names what enforces it.** A string that promises something —
    "private", "can't be undone", "matches the node's tally" — has to be true of the code
    or the `rho:gov:*` native behind it. Copy that asserts what the chain does not do cost
    two findings, in both directions: over-claiming (an inbox described as private over
    bodies stored in plaintext) and under-disclosing (a threshold never stated at all).
- Commit straight to `main` (it deploys). Write commit messages as the existing history
  does.

## Commands

```sh
npm install
npm run typecheck        # tsc --noEmit — the lint step; run before committing
npm test                 # rgov-core selftest (91 checks) + unit tests (no node needed)
npm run build            # dist/index.html + dist/version.json (tsc runs first)
npm run test:e2e         # Playwright against dist/ — BUILD FIRST; needs a node (below)
npm run test:chain       # the Gov API against a live node
```

### A node for chain and e2e tests

- **Local node.** Use quantum-os's localnet. Clone quantum-os beside this repo, then run
  `cd ../quantum-os/scripts/localnet && bash run-node.sh`. It needs `bin/rnode` built from
  rholo `dev` @ `bc80abb` or later. It serves `http://127.0.0.1:40403`, the default
  `RHOGOV_NODE`.
  - Run it in the background; it is long-lived.
  - The test keys (Alice/Bob/Carol/Dave in `tests/e2e/helpers.ts`) are funded at genesis.
- **Playground.** Set `RHOGOV_NODE=https://playground.rhobot.net`. The same test keys are
  funded there.
  - In a cloud session the sandbox proxy needs `RHOGOV_PROXY=1` (browser) and
    `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` (Node).
  - The playground is slow: a full suite there takes 15–25 minutes.
  - Its faucet is rate-limited, so don't run several newcomer tests back to back.
- **Chromium.** In cloud sessions the SessionStart hook sets `CHROMIUM_PATH` to the
  pre-installed Chromium. Never run `playwright install`.
- **Gotchas.**
  - A test that waits on the chain needs generous timeouts; `actionTimeout` is 60 s.
  - The update-banner test serves `dist/` over HTTP itself and needs no node.

## When something fails on the playground

Reproduce it with a fresh key in a scratch script: `scratch/` is gitignored. Use
`new RNode(url)`, `generateKey()`, `node.faucet(addr)` and `Gov.install`, as
`scratch/pg2.ts` once did. Users can file reports from the app (Help → Report a problem);
those issues carry the reporter's version, node, community, balance, Help's suggestions and
recent errors.
