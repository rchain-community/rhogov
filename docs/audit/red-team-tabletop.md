# Red-team tabletop — protocol and facilitator pack

An adversarial exercise against rhogov's governance surface, played by testers who are
**crypto-competent and DAO-literate**. Nobody here gets *lost*; they get **misled**. The
question is:

> **If a competent adversary wants a decision, a name, a signature or a weight, what does the
> app let them have — and can the person affected tell?**

> **Status: all sixteen findings are addressed and all five probes pass (2026-10-12).** The scenarios,
> predictions and injects below are the record of the exercise as it was played. What fixed each
> finding, and which half of it remains upstream, is in
> [`register-redteam.md`](register-redteam.md) → *Where these stand*; the upstream half is collected in
> [#75](https://github.com/rhovision-org/rhogov/issues/75).
>
> **Two things changed in the app since these were written**, so a scenario that names a control may
> name it differently from the one on screen: **Censure** is now **Dispute their trust**, **Delegate my
> vote** is now **Hand my vote to someone**, and a vote's list of voters is no longer called "the roll"
> in the interface (RC-07).

This is the second exercise against rhogov. The [cold-start
audit](cold-start-protocol.md) asked whether a *stranger* could find their way; this one asks
what a *hostile expert* can take. Findings live in [`register-redteam.md`](register-redteam.md).

**Finding IDs are scenario-bound**: `RT-nn` is scenario `Tn`, for `RT-01`…`RT-12`. IDs above
`RT-12` are findings with no scenario card — they came from the same reading but are not among
T1–T12. The register sorts by severity for reading; the ID keeps a finding tied to its origin.

## What this exercise is not

Not a penetration test of the rnode or the contracts' cryptography. Not a code review. Not a
test of whether the *node* computes correctly — it asks whether a person can be **misled about
what the node computed**, and whether an actor can change the inputs everyone else relies on.

## Non-negotiable constraints

1. **The hard prohibition.** No adversarial sequence may touch a community we did not install
   ourselves, in this session, with a key from `tests/e2e/helpers.ts`. The real RhoVision /
   `colab` community on the playground is **never opened**. The pre-flight checklist below
   enforces this.
2. **No fixtures but browser state.** Every community is installed this run by a real deploy.
   `rhogov:*` localStorage is the only permitted fixture.
3. **`src/chain/rgov-core.js` is vendored** (`CLAUDE.md:44-47`). Upstream seams are written up
   for quantum-os / rholo, never edited here.
4. **No key material in any artefact.** Reports say only *whether* a key is set — the shape the
   app's own report already uses (`src/ui/help.tsx:132-161`).
5. **Probes assert the client-observable seam.** A probe observes what the UI shows and does;
   it does not craft raw rholang deploys.

## The threat model, as trust boundaries

Every boundary is a place the app makes a claim about who can be trusted. Each seam is a
boundary trusted further than the copy says.

| | Boundary | What the app trusts it for | What an adversary controls | Client-fixable seam | Upstream seam |
|---|---|---|---|---|---|
| **TB1** | Browser & localStorage | the key, active community, inbox archive, preferences (`src/state.ts:14-22`) | anything a page-load can write — proven by the sanctioned `seed()` fixture | join labels bleed across communities (`state.ts:140`); stale address book; `setupNode` written raw (`settings.tsx:139`) | — |
| **TB2** | The node — incl. a hostile one | **everything read and every deploy sent**; no other peer (`node.ts:97-116`) | all reads; it receives each signed deploy; the invite names it | invite accepts any `http(s)` host (`state.ts:105-106`); no last-updated signal | — |
| **TB3** | The contracts over `rho:gov:*` | standing, weights, outcomes | — | the client recomputes node-owned numbers: council power/median/score (`council.ts:104-168`), vote bars (`votes.tsx:230-237`) | native formula drift |
| **TB4** | Other members | their ballots, their labels, their messages; an opener's roll and an admin's roles | `setRoll`, `propose`, `setRole`, `censure` | no warning where these bite | `setRoll` unguarded (`rgov-core.js:690-704`); `propose` ungated (`:771-779`) |
| **TB5** | The invite link | the node + three contract addresses, "nothing secret" (`settings.tsx:78`) | the whole link — it decides the node the victim signs to | host shown only as `small muted` (`settings.tsx:147`) | — |
| **TB6** | Name directory & name list | the identity of people | any label; case and homoglyph variants | `(2)` by address order (`state.ts:155-162`); no Unicode normalisation (`people.ts:9-15`) | directory has no uniqueness check |

## The four persona rungs

Each rung is a stance with its own inference engine. A seam visible to one rung is invisible to
another, which is what makes the rungs non-redundant.

### Rung RA — the pragmatic member
*Logic:* "I came to decide something; the screen tells me what is decided and what to press."
*Will infer:* the loudest label is the truth. *Will try:* the primary button on every screen;
forward the invite; send a message containing a password. *Counts as a win:* acting on a
decision without being misled. *Positioned to see:* **disclosure** seams.

### Rung RB — the operator / steward
*Logic:* "I run this group; the app's process is the group's process."
*Will infer:* the roll is fixed when the vote opens; the record matches the tally; installing
gives no special power. *Will try:* "Add N new members to the roll", "Record the decision",
"Make admin", "Censure". *Counts as a win:* a record everyone accepts. *Positioned to see:*
**process-integrity** seams.

### Rung RC — the protocol engineer
*Logic:* "Which of these numbers is the node's, and which is this page's?"
*Will infer:* nothing until recomputed. *Will try:* recompute every result from chain state;
turn on review-before-sign and count how many writes show a term; kill the node mid-read.
*Counts as a win:* every number attributed, every promise kept. *Positioned to see:*
**display-vs-node** seams.

### Rung RD — the capture adversary
*Logic:* "I want the outcome; what will nobody notice?"
*Will try:* rewrite the roll after seeing the tally; post a competing result on someone else's
issue; get one rating recorded to flip a group to admin-weighting; wear a trusted name in
another community; name an attacker's node in a forwarded link. *Counts as a win:* the decision,
unseen and unprovable. *Positioned to see:* **capture** seams.

### Sightlines

| Seam | RA | RB | RC | RD |
|---|---|---|---|---|
| Foreign node in an invite (T1) | symptom | — | ✓ | ✓ |
| Roll changed after the tally (T2) | — | symptom | — | ✓ |
| One rating flips weighting (T3) | symptom | ✓ | ✓ | ✓ |
| A losing winner recorded (T4) | ✓ | ✓ | ✓ | ✓ |
| Name bleed / homoglyph (T5) | ✓ | — | — | ✓ |
| Silent staleness (T6) | symptom | — | ✓ | ✓ |
| Review-before-sign coverage (T7) | — | — | ✓ | — |
| Retry after a timeout (T8) | ✓ | ✓ | — | — |
| Costless censure / cascade (T9) | — | ✓ | — | ✓ |
| Council arithmetic as fact (T10) | ✓ | — | ✓ | — |
| The longest bar loses (T11) | ✓ | — | symptom | — |
| Inbox not private / not stamped (T12) | ✓ | — | ✓ | ✓ |

## Predict–observe logic tests

A prediction is only useful if it can be **refuted**. A prediction that holds is recorded as an
explicit **no-finding**, exactly as the cold-start protocol records S4 and S7.

| Rung | Prediction | How checked | Expected | Observed |
|---|---|---|---|---|
| RA | Given a forwarded invite, RA signs without ever being able to name the node | RP2 | the foreign host is named prominently before signing | host shown only as `small muted` (`settings.tsx:147`); no gate |
| RA | RA reads "Leading overall" as the decision | manual + RP9 | the label is qualified as client-computed | unqualified (`council.tsx:530`) |
| RA | RA reads the longest bar as the winner | manual + RP10 | bars labelled prominently as first preferences | muted footnote only (`votes.tsx:255`) |
| RA | RA believes the inbox is private and sends a secret | RP8 | the headline is qualified | "private inboxes" (`setup.tsx:225`) |
| RB | RB believes the roll is fixed at open | RP3 | changing it warns and confirms | no warning, no confirm (`votes.tsx:168`) |
| RB | RB believes the saved record matches the tally | manual + RP4 | a persistent compare badge | badge only while recording (`council.tsx:587`) |
| RB | RB believes installing grants no special power | manual + source | the council copy agrees | it says the opposite (`council.tsx:141`) |
| RC | Every displayed result is the node's | manual + RP9 | every result attributed | council power/median/score are client (`council.ts:104-168`) |
| RC | With review on, every write shows its term | RP1 | ~25 of 25 | 2 (`groups.tsx:77,146`) |
| RC | A failed read is visible | RP6 | surfaced even when data is present | silent (`kit.tsx:41,44,216-217`) |
| RD | The electorate cannot change once ballots exist | manual + RP3 | refused | allowed (`rgov-core.js:690-704`) |
| RD | A losing option cannot become the recorded winner | manual + RP4 | refused or persistently flagged | allowed (transient warn) |
| RD | One rating cannot convert a group to admin-weighting | manual + source | a quorum is required | any rating (`gov.ts:210-213`) |
| RD | A name cannot be worn where it is unclaimed | manual + RP5 | scoped to its community | bleeds (`state.ts:140`) |

## How a scenario is built

No fixtures. The community is installed this run by a key from `helpers.ts:KEYS` via
`coldStart()`; a second or third member is minted the way `tests/e2e/names.spec.ts:18-20` does it
(`generateKey()`, `node.faucet(...)`, poll `balance`) — **the playground faucet is rate-limited,
so budget a few keys per run.** A scenario is never run against a link we did not generate.

## The scenario pack

Ordered by exploitability — effort for the adversary × impact, easiest-and-worst first.

**T1 · A hostile node named by the invite link.** *Rungs* RA, RC.
*Setup:* the attacker rewrites the invite's `node` (a host they run) and forwards the link.
*Objective:* get the victim to display governance state from, and sign deploys to, a host they
never chose. *Injects:* ① the link parses cleanly and the only hint is `Network: <host>` in
`small muted`; ② the Community screen shows the same host with no "not the network you chose";
③ the balance does not move, because the deploy went elsewhere.
*Should:* the node is checked against `NETWORKS` (`state.ts:32-36`) and named prominently before
any signature. *Decision points:* does `parseInvite` see the host? does the join screen warn?
*Finding:* **RT-01** — client.

**T2 · Capture the roll after the tally.** *Rungs* RD, RB.
*Setup:* an open vote with a real second voter; the opener then sweeps in a sockpuppet via "Add
N new members to the roll". *Objective:* change the electorate after ballots exist.
*Injects:* ① the roll button sits in the same row as "Close voting and record result", directly
under the live "Standing so far"; ② no `confirm()` fires, unlike close (`votes.tsx:111`);
③ README:172-174 says the roll is "fixed when it opens". *Should:* the app warns and confirms
that this changes the electorate, and the contract refuses once ballots exist.
*Finding:* **RT-02** — client (warning) + upstream (quantum-os: `setRoll` must check membership
and refuse once ballots exist or while locked).

**T3 · One rating flips the group to admin-weighted.** *Rung* RD.
*Setup:* three equal members, one-person-one-vote; the adversary gets a single level-0 rating
recorded, or has "Make admin" pressed. *Objective:* convert a flat group to admin-weighting
(admins at weight 6) with one cheap write. *Injects:* ① "trust weighting starts once anyone
rates a member" is a hint, not a warning (`groups.tsx:202`); ② the first rating is level 0 and
looks inert; ③ the next tally shows admins at ×6. *Should:* the weight consequence is shown
before the write, and "Make admin" states that it grants weight 6.
*Finding:* **RT-03** — client + upstream (rholo: one rating should not be enough).

**T4 · Record — or propose — a winner that lost.** *Rungs* RD, RB.
*Setup:* a council decision with a live tally; the facilitator records a different winner, and a
non-opener posts a competing result (`propose` is ungated). *Objective:* make the record differ
from the tally, unrecoverably. *Injects:* ① a warn badge appears *while* recording; ② after
saving there is **no** persistent compare-to-tally badge, unlike votes (`votes.tsx:267-274`);
③ a second proposer's entry is silently another key in `results`. *Should:* the record carries a
persistent badge against the recomputable tally. *Finding:* **RT-04** — client + upstream.

**T5 · Impersonation by name bleed and homoglyph.** *Rungs* RD, RA.
*Setup:* two communities, both ours; one address joins a group in A with the label "Treasurer"
and also belongs to B. *Objective:* wear a trusted name where it is unclaimed. *Injects:* ① in B
the label shows with no "(unclaimed)" suffix; ② `(2)` is assigned by address order, not claim
order, contradicting `docs/user-guide.md:356`; ③ a homoglyph renders identically at body size.
*Should:* labels are scoped to the community that gave them. *Finding:* **RT-05** — client.

**T6 · The frozen chain: silent staleness.** *Rungs* RC, RA.
*Setup:* load a screen, then make the node refuse reads. *Objective:* show that a stale screen is
indistinguishable from a current one. *Injects:* ① old data is kept on error; ② there is no
last-updated indicator anywhere; ③ the 15 s poll fails silently. *Should:* a failed refresh is
visible even when data exists. *Finding:* **RT-06** — client.

**T7 · Review-before-sign, kept for 2 of ~25 writes.** *Rung* RC.
*Setup:* turn on "Show me the exact rholang before I sign each action", then cast a vote,
censure, rate, delegate, invite, send a message. *Objective:* show a stated promise is kept for
2 of ~25 writes. *Injects:* ① Create group shows the modal; ② the very next action does not;
③ the setting stays ticked, so the user believes it holds. *Should:* every write shows its term,
or the promise is amended. *Finding:* **RT-07** — client.

**T8 · The second community: retry after a timeout.** *Rungs* RA, RB.
*Setup:* an install against a slow node, or a node answering "executed on another node".
*Objective:* get a double charge or a second community. *Injects:* ① the copy offers retry
without distinguishing "may have landed" from "did not land"; ② most write buttons have no
in-flight disable; ③ a failed deploy still costs phlo and nothing says so. *Should:* in-flight
writes are disabled, and the retry advice separates the two cases. *Finding:* **RT-08** — client.

**T9 · The costless censure and its cascade.** *Rungs* RB, RD.
*Setup:* a trust chain; censure a mid-level member. *Objective:* wipe a rival's trust for free.
*Injects:* ① the copy says "two-thirds (and at least two)"; ② the real threshold is
`max(2, ⌈⅔·eligible⌉)` and it **cascades**; ③ vouchers lose what they staked, unshown before
signing. *Should:* the threshold and the cascade are stated. *Finding:* **RT-09** — client +
upstream (rholo: threshold semantics).

**T10 · Council arithmetic presented as the node's.** *Rungs* RC, RA.
*Setup:* a council with asymmetric estimates. *Objective:* show a browser number read as the
node's. *Injects:* ① "Leading overall" reads as an outcome; ② the per-chamber line *is*
qualified, so the omission looks deliberate; ③ the saved record stores browser numbers.
*Should:* client-computed values are labelled as such everywhere. *Finding:* **RT-10** — client.

**T11 · The longest bar that loses.** *Rung* RA.
*Setup:* a ranked vote where the first-preference leader loses the instant runoff. *Objective:* a
member reads the longest bar as the winner. *Injects:* ① the longest bar is the loser; ② the
only disclosure is a muted footnote; ③ the win styling marks the shorter-bar winner.
*Should:* bars are labelled as first preferences, or runoff rounds are shown.
*Finding:* **RT-11** — client.

**T12 · The inbox that is neither private nor stamped.** *Rungs* RA, RC.
*Setup:* send a plaintext message; then an `invite`-typed message whose sender-controlled
`fields.group`/`fields.gid` are hostile. *Objective:* read a "private" message from chain state;
get the victim to navigate via a trusted-looking button. *Injects:* ① the headline says "private
inboxes"; ② "the sender's name … can't be faked" — only the address is stamped, and bodies are
plaintext; ③ the "Open {label}" button carries a sender-chosen label and id. *Should:* the
headline does not over-claim, and the button is rendered as untrusted. *Finding:* **RT-12** —
client + upstream.

## Abuse-severity rubric

Three axes, each 1–4, then mapped onto the existing S1–S4 so both registers sort together.

- **Impact (I).** I1 cosmetic · I2 a wrong expectation, recovered · I3 a decision mis-recorded,
  or trust/weight moved, without informed consent · I4 capture, impersonation, funds, or a
  signed deploy sent to an attacker's host.
- **Exploitability (X).** X1 needs source-reading or a privileged role *and* a node trick ·
  X2 needs a privileged role (opener/admin/facilitator) · X3 several coordinated cheap writes ·
  X4 one click by one ordinary member, or a forwarded link.
- **Detectability (D).** D1 invisible · D2 visible only to someone who knows the mechanism ·
  D3 visible on screen, transient · D4 visible and persistent.

| Class | Condition | Maps to |
|---|---|---|
| AS-1 | I4; or I3 with X4 **and** D1 | **S1** Blocker |
| AS-2 | I3; or I4 needing X2/X3 | **S2** Major |
| AS-3 | I2 | **S3** Minor |
| AS-4 | I1 | **S4** Nit |

Rule (mirrors the cold-start rule): **a finding at D1 that crosses TB2–TB6 is bumped one class.**
Every register row keeps its raw `I/X/D` so a reader can re-derive the class and disagree
explicitly.

> **Corrected during the run.** This rule originally read *D1/D2*. Applying it made RT-12 — a
> headline wording problem — an **S1 blocker**, which is indefensible: D2 means *visible to
> someone who knows the mechanism*, not invisible. Tightened to D1. See the register's
> "Corrections forced by the run".

## Finding record

```
id            RT-02
title         The opener can rewrite the voter roll after the tally is visible, with no warning
severity      S1 (AS-1)   I3 X2 D2 → bumped, crosses TB4
persona       RD the capture adversary; RB the operator
scenario      T2
route         #/v/:gid/:iid
observed      "Add 1 new member to the roll" sits beside "Close voting and record result",
              directly under the live "Standing so far"; no confirm fires
expected      the app warns and confirms that this changes the electorate
evidence      RP3 (red); trace; screenshot
owner         client (warning) + upstream:quantum-os (setRoll must check membership)
```

## Evidence template

Reuses the app's own key-safe report shape (`help.tsx:132-161`) — it says whether a key is set
and **never** the key. Probes capture evidence with:

```sh
RHOGOV_REDTEAM=1 npx playwright test tests/e2e/redteam/redteam.probe.spec.ts \
  --trace on --screenshot on -g "RP3"
```

## Method

Two passes, reconciled. **Manual role-play** walks T1–T12 with the pre-flight checklist signed.
**Automated probes** (`npm run test:redteam`) assert the *desired* behaviour and were **expected red**
when written; the red set was the findings. **All five pass now** — `register-redteam.md` records what
fixed each, and which findings a client fix only half covers. A finding is confirmed when a probe names
it and a manual walk reproduces it; a probe with no manual reproduction is recorded "probe-only,
unverified by eye".

## Running the probes

They need a live node and are **not** in CI (`ci.yml` runs `npm test` and `npm run build` only).
Prefer localnet if available; otherwise the playground (15–25 min, rate-limited faucet).

```sh
npm run test:redteam
RHOGOV_NODE=https://playground.rhobot.net npm run test:redteam
npm run build && RHOGOV_NODE=… npm run test:e2e     # the normal suite stays green
```

## Pre-flight checklist (enforces the hard prohibition)

Run before **every** sequence; the recorder signs it. A sequence without a signature does not count.

1. The community's `rho:id` was installed **this run** by a key from `tests/e2e/helpers.ts:KEYS`
   — read it back from `#/community` and record it in the session log.
2. No invite used in the session came from outside the session.
3. No third-party link is opened, at all — RhoVision / `colab` included.
4. No key material appears in any record.

## Facilitator guide

*Roles.* **Facilitator** (drives the clock, holds the inject deck, never plays) · **Recorder**
(one person, one terminal: every observation into the register *during* the exercise, with
verbatim strings) · **Red team** (the four rungs, played one rung at a time or staggered) ·
optional **Blue** (defends the app's best case on paper) · **Observer** (keeps the "Corrections
forced by the run" list).

*Shapes.* Four 60-minute **rung passes** (one rung each, full scenario order) or one 150-minute
**full tabletop** (pre-brief 15, five scenarios with injects 100, hot-wash 20, triage 15).

*Inject beats.* One when the objective is first reached, one when the first "should" is not met,
one optional. The facilitator announces each so the recorder can timestamp it.

*Recording.* Observed (verbatim) · expected · the inject that produced it · rung · route ·
boundary TBn. After the session each finding is marked **probe-backed**, **probe-only** or
**manual-only**.

## Corrections forced by the run

Kept as a first-class section, as the cold-start protocol does — its most valuable paragraph was
the list of probe defects it found. Expect the same class of error here: the timing of the freeze
in RP6, the "vote vs group-create" false-pass risk in RP1, and the degenerate-scenario trap (a
one-founder group shows no roll control and no Censure button).

## Probe index

| Probe | Scenario | Node? | Finding |
|---|---|---|---|
| RP2 | T1 | none | RT-01 |
| RP8 | T12 | none | RT-12 |
| RP1 | T7 | live | RT-07 |
| RP3 | T2 | live | RT-02 |
| RP6 | T6 | live | RT-06 |
| — | T3, T4, T5, T8, T9, T10, T11 | live | no probe yet — evidence-pending issues RT-03, RT-04, RT-05, RT-08, RT-09, RT-10, RT-11 |

All twelve scenarios have a filed issue; seven of them (the row above) rest on reading rather than a
probe, and each of those carried an "Evidence-pending" marker on its issue. **Those seven are fixed
too** — they were never probed, so nothing turns green to prove them; `register-redteam.md` →
*Where these stand* names what fixed each, and the upstream halves are in
[#75](https://github.com/rhovision-org/rhogov/issues/75).

## Findings register

See [`register-redteam.md`](register-redteam.md) for the ledger, the upstream write-ups awaiting
review, and the no-finding table.
