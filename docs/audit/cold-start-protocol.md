# Cold-start UX audit — protocol

An adversarial audit of rhogov's first ten minutes: **first-run → the Welcome wizard →
join or start a community → the empty community → the first group → the first vote → the
first group's Members tab.**

It exists because a tester opened rhogov, found it empty, and had no idea what to do. The
docs explain the app well; the *first-run signalling* was never designed.

> **Status: all eight findings are fixed and every probe passes (2026-10-12).** What follows is the
> method and the findings **as found** — the text below is present-tense because that is how a finding
> is written, not because the defect is still there. For what fixed each one, and which of them no
> probe covers, see [`register.md`](register.md) → *Where these stand*.

## What this audit is not

It is not a feature audit, and not a bug hunt in the chain layer. It asks one question of
every screen a newcomer meets: **can a stranger name what this app is for, and what to do
next, without opening Help?**

## Non-negotiable constraints

1. **No fabricated data.** rhogov is serverless and its state lives in on-chain contracts.
   A "next step" must create a *real* object on a *real* node. The only sanctioned fixture
   is browser state (`rhogov:*` in localStorage), and even then every community referenced
   must exist on chain.
2. **No backend, relay, analytics or third-party script.** One self-contained `index.html`;
   the only network peer is the user's rnode.
3. The key never leaves the browser. Findings and reports say *whether* a key is set, never
   the key.

## What is in scope

`#/`, `#/welcome`, `#/join`, `#/groups`, the first group page (Votes / Members / About),
the first vote page, `#/inbox`, `#/community`, `#/account`.

Out of scope: councils and chambers (`#/councils`, `#/c/*`) except as the last-gated rename;
accessibility (deserves its own protocol); i18n; anything in `src/chain/*` (vendored); and
every product fix arising from a finding — those become issues. The one exception is the
gated rename series (see `rename-map.md`).

---

## Findings already established by reading source

These are *reading*, not measurement: each is a claim about committed code, with the line
that makes it true. The probes below exist to turn them into machine-checkable failures. A
probe that fails is a *finding*, not a broken test.

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| CS-001 | S3 | Home never says what rhogov is for. The only product statement (`setup.tsx:225`) is on a screen a returning user never sees again. | `home.tsx` (whole file) |
| CS-002 | **S1** | An empty community is told **"You're all caught up."** Its first user has never seen a vote; the app congratulates them and they leave. | `home.tsx:39` |
| CS-003 | S2 | On an empty community the real call to action — *"Start the first one"* — is a bare link in the **third** section, below "Needs your vote". | `home.tsx:58` |
| CS-004 | S3 | Unglossed mechanism words on the cold-start path: `censure`, `roll`, `phlo`. ("liquid democracy" and "web of trust" appear **zero** times in the UI while headlining the README.) | `groups.tsx:240`, `votes.tsx:168`, `kit.tsx:164` |
| CS-005 | S3 | Delegation is offered as `Delegate my vote` / `Delegate this vote` — a term the user must already know. | `groups.tsx:197`, `votes.tsx:146` |
| CS-006 | S2 | A damaged invite link strands the user: `#/join` is matched *before* the readiness guard and the sidebar nav is hidden until ready, so a malformed link renders a bare message with **nothing in the page** — no link, no button (measured by P6). The only escape is the always-mounted Help panel, which a stranded user would not think to open. | `settings.tsx:135`, `main.tsx:31,48,61` |
| CS-007 | **S1** | Accepting an invite **re-asks you to join the community you just joined** (measured: after "Get started" the current step is "Choose a network", and after identity it is "Join or start a community" with a live "Start a new community"). `accept()` sets the community active, then sends you to the wizard at **step 1**; step 3 offers "Start a new community", which installs a **second** set of contracts for ~0.02 REV. (Root cause of the wrong network: the invite's node is written to localStorage but never to the `setupNode` signal — measured: storage held the invite's node while the wizard used the playground default.) | `settings.tsx:137-141`, `setup.tsx:14-15,217-219,251-259`; measured by `scratch/ux-smoke.mjs` |
| CS-008 | S2 | A community whose node is unreachable, or whose contracts are gone, fails with **"Couldn't read the chain." + Retry** — it does not name the community and offers no way to switch or change network. | `kit.tsx:215-219` |

### Corrected during source review (do not re-add)

- A **keyed user with no community** was thought to restart at the network step. It does
  not: `setup.tsx:218` is `useState(hasKey)`, so `netDone` starts true and the wizard opens
  at **step 3**. This is correct behaviour and is protected as guard **G5**.
- **Step 2** was thought to hide the key's trust statement until after Continue. It does
  not: `setup.tsx:109-112` shows *"A new key was made in this browser… It never leaves this
  device"* before Continue, in the default mode. Kept as a **manual** observation for
  persona P-C, not a red probe.

---

## Personas

Each is a stance, not a demographic. Role-play one per pass.

| ID | Persona | What they stress |
|---|---|---|
| P-A | **The stranded stranger** — arrived on a truncated or forwarded invite | CS-006: damaged link, no menu, no way out |
| P-B | **The impatient clicker** — Ctrl-clicks through, never opens the `Info` expanders, tabs away mid-deploy | Dead clicks, redundant steps, reload during a write |
| P-C | **The skeptic** — will not type a name into an app that mints a key unasked | Does step 2 earn trust before Continue? (read: yes, `setup.tsx:109-112`) |
| P-D | **The returning user with a stale key** — the localnet was restarted, or the browser sat unused | CS-008: does the failure name the community and offer a way out? |
| P-E | **The non-crypto user** — knows Robert's Rules, not keys or gas | CS-004/CS-005: censure, roll, delegate, phlo |
| P-F | **The invited outsider with no key** — clicked a real invite on a phone | CS-007: re-asked the network, re-asked to join |
| P-G | **The small-screen user** — 390×844 | Is Home's real call to action above the fold? |

## Scenario matrix

| ID | Entry state | How to construct (no fabricated data) | Persona | Headline question |
|---|---|---|---|---|
| S1 | Fresh browser | open the app | P-B, P-C | Is the wizard self-evident, and is purpose stated? |
| S2 | Key + community, **empty** | real key, real `startCommunity()` | P-E, P-G | CS-002/CS-003 — does the app lie or guide? |
| S2b | Key + community, in no group | then `#/groups` | P-E | Does "not in any group yet" lead somewhere? |
| S3 | Key + populated community | two cooperating personas | — | Baseline only: does the first vote page front-load the roll control? |
| S4 | Stale key | seed `rhogov:key` only | P-D | **No finding** — resumes at the community step (guard G5) |
| S4b | Stale community (dead contracts) | seed a community with `rho:id:zzzz…` | P-D | CS-008 |
| S4c | Unreachable node | seed a community + a dead node URL | P-D | CS-008 |
| S5 | Bad invite | `#/join?c=notbase64`, no query | P-A | CS-006 |
| S5b | Invite parses, points nowhere | valid base64, dead contracts | P-A | Warned before adding? |
| S6 | Invite, no key | `#/join?c=…` → "Get started" | P-F | **CS-007 — the sharpest defect** |
| S7 | Invite, existing key, already joined | `#/join?c=…` when known | — | "Open {name}" — **no finding** (green test in `cold-start.spec.ts`) |

Every cell is walked and produces a finding **or an explicit "no finding"** note. S4 and S7
are recorded as no-finding today and are protected by guards.

## Severity rubric

| Sev | Name | Test |
|---|---|---|
| **S1** | Blocker | Cannot complete the path, or is steered into an irreversible/misleading action (CS-007's second install; CS-002's "all caught up" → they leave). |
| **S2** | Major | Completes, but forms a wrong expectation or hits a dead end that needs Help to escape (CS-003, CS-006, CS-008). |
| **S3** | Minor | Friction, redundant steps, an unglossed-but-guessable label (CS-001, CS-004, CS-005). |
| **S4** | Nit | Polish, wording, ordering. |

Rule: a finding the persona *could not have diagnosed without reading source* is capped at S2.

## Finding record

```
id            CS-007
title         An invite re-asks the newcomer to join the community they just joined
severity      S1
persona       P-F
entry state   S6 (invite link, no key)
route         #/welcome (after #/join?c=… → "Get started")
steps         1. open a real invite  2. press "Get started"
observed      the wizard opens at the network step, then offers "Start a new community"
              for the community already in the sidebar
expected      the network and the community are pre-answered and collapsed; only a name
              is asked for
evidence      probe invite.probe.spec.ts › "P7a — the invite answers the network step";
              "P7b — the invite's community is not offered again"; trace; stills
repro         always
lockstep      setup.tsx:14/218, settings.tsx:139; guide §1
```

## Evidence template

The issue body reuses the app's own safe report shape — Help → Report a problem already
emits a `**My setup**` block that says *whether* a key is set and **never the key**
(`help.tsx:132-161`). File issues with:

```sh
gh issue create --label ux-audit --label cold-start --body-file <finding>.md
```

For the automated probes, capture evidence with traces and screenshots on:

```sh
RHOGOV_AUDIT=1 npx playwright test tests/e2e/audit/invite.probe.spec.ts \
  --trace on --screenshot on -g "does not re-ask"
```

## Method

Two passes, reconciled:

1. **Manual role-play** — walk the S-matrix with `npm run dev` (http://localhost:5180), one
   persona per pass, recording each finding with the record above. A persona "passes" only if
   they can name the app's purpose **and** their next action without opening Help.
2. **Automated probes** — `npm run test:audit` (see below). Probes assert the *desired*
   behaviour and were **expected red** when written; the red set was the findings. All of them pass
   now — see `register.md`'s "Where these stand" for what fixed each, because a probe that starts
   passing on its own is a warning that it has gone stale. Guards must keep passing.

A finding is confirmed when a probe names it and a manual walk reproduces it; a probe with no
manual reproduction is recorded as "probe-only, unverified by eye".

## Running the probes

The probes need a live node, so they are **not** in CI (`ci.yml` runs `npm test` and
`npm run build` only). Prefer localnet (`http://127.0.0.1:40403`, quantum-os
`scripts/localnet/run-node.sh`, with the funded genesis keys in `tests/e2e/helpers.ts`) to the
playground (15–25 min and a rate-limited faucet).

```sh
npm run test:audit                                                    # build + probes (red expected)
RHOGOV_NODE=https://playground.rhobot.net npm run test:audit          # anywhere
npm run build && RHOGOV_NODE=… npm run test:e2e                       # the normal suite, incl. the guards
```

### Result of the first full run (playground, 2026-10-12)

**10 red, 6 green.** Every probe red, every guard green — the design exactly. (The run
predates the split below, so its "6 green" includes the guards that now run in the normal
suite; the audit directory is now probes only, 12 tests of which 10 are findings.)

| | Result |
|---|---|
| Guards (now in `tests/e2e/cold-start.spec.ts`) | ✓ green |
| Probes P1, P2, P3, P4, P5 | ✘ red — CS-001…CS-005 |
| Probes P6, P7a, P7b, P8 | ✘ red — CS-006, CS-007 ×2, CS-008 |
| Probe P11 | ✘ red — CS-008 |

Two reds are worth quoting as evidence:

- **CS-002, live:** `Expected substring: not "You're all caught up"` — the app congratulates
  a first user on a community where nothing exists.
- **CS-004, live:** the census found `{ "#/g/<group>": ["roll", …] }` — the vote page's
  "Add N new members to the roll", once a second person has joined.

### Corrections forced by that run

Four defects in the *probes*, not the app. Each was a false result and is fixed; they are
listed so the same mistakes are not reintroduced.

1. **`test.describe.serial` made the audit useless.** One failure aborted the rest of the
   file — 10 of 15 tests never ran. Serial mode is right for a *suite*; an audit must
   enumerate every finding. Now plain `test.describe` (declaration order still holds at
   `workers: 1`).
2. **`visibleText()` read the DOM too early.** While a screen loads, `main` contains only
   "Reading the chain…", so a `not.toContain` assertion (P2) and a census (P4) both passed
   *spuriously* — reporting the app cleaner than it is. `visibleText()` now waits for the
   loader to clear. **This was the most important fix of the run.**
3. **P4's census was degenerate with one member.** `Censure` renders only against *other*
   people (`member && !self`) and the roll only grows when someone joins late, so a
   one-founder community shows neither. The scenario now has a second person, which is also
   the first moment the app is really a governance app.
4. **G3 asserted the wrong string.** `"A key in this browser signs everything you do."` is
   the *collapsed* step-2 placeholder (`setup.tsx:248`), shown at step 3 — not what step 2
   renders. It now asserts the identity form.

Also verified: the targets of **P6/P7a/P7b** were measured independently before the suite ran
(a throwaway `scratch/ux-smoke.mjs`, gitignored — the same results the probes now report), and
**P11** was run both offline and on the playground, failing on its intended assertion each time.

## Probe index

| Probe | File | Finding | State |
|---|---|---|---|
| P1 | `audit/cold-start.probe.spec.ts` | CS-001 | red |
| P2 | " | CS-002 | red |
| P3 | " | CS-003 | red |
| P4 | " | CS-004 | red |
| P5 | " | CS-005 | red |
| P6 | `audit/invite.probe.spec.ts` | CS-006 | red |
| P7a | " | CS-007 | red (most valuable) |
| P7b | " | CS-007 | red (most valuable) |
| P8 | " | CS-008 | red |
| P11 | `audit/returning.probe.spec.ts` | CS-008 | red |

The two `setup` tests in `cold-start.probe.spec.ts` arrange the scenario; they are not findings.

## Guards

The green guards are **not** in the audit directory — they run in the normal suite, so they
extend ordinary coverage rather than hiding behind `RHOGOV_AUDIT=1`:

| Guard | File | Protects |
|---|---|---|
| G1 | `tests/e2e/cold-start.spec.ts` | Help's next step for a brand-new community |
| G3 | " | the wizard's step machine and "Change" |
| G5 | " | a keyed user resuming at the community step (the S4 no-finding) |
| — | " | an invite to a known community opening it (the S7 no-finding) |

Guards G2 (the unfunded-install gate) and G4 (the report never carries the key) are already
asserted by `tests/e2e/newcomer.spec.ts:28-35,49-51`; duplicating them would add runtime for
no new signal.

## Findings register

Filed findings, severity, probe and issue links live in [`register.md`](register.md).
