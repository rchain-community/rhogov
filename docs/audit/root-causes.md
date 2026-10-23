# Audit findings regrouped by root cause

Three audits filed 34 findings as 34 issues — the [cold-start UX audit](register.md) (#9–#16), the
[red-team tabletop](register-redteam.md) (#20–#40), and an unsolicited *vibes* set (#42–#51). Filed
one-per-symptom, the same defect appeared three or four times under different titles: an empty screen
was filed as "You're all caught up", again as "the CTA is buried", and again as "Home doesn't say
what rhogov is for".

This register regroups them by **root cause**. A root cause here is a *mechanism*, stated in code
terms — not a symptom class. "Both are copy problems" is a symptom class; "control labels are
literals while the gloss lives in a sibling collapsed container" is a root cause, because it names
the one thing that has to change.

**Every finding appears exactly once.** 28 findings close as superseded by one of 7 root-cause
issues; 6 stand alone and keep their issues, edited in place. Nothing is dropped.

**The probes do not know about this.** The red-by-design probes in `tests/e2e/audit/` and
`tests/e2e/redteam/` assert DOM strings, never issue numbers. **A closed finding is not a fixed
finding** — the probe stays red until the code changes. The finding rows in the two registers above
are left intact, with their IDs, probe names and verbatim failure messages, because they are the
durable evidence once the issues close.

**Finding IDs are not renumbered.** Ten files reference `CS-nn`/`RT-nn` (four docs, five probe specs,
and the three upstream drafts). Old IDs survive as aliases in each new issue's *Members* table and in
both registers.

## The map

| Finding | ID | Root cause |
|---|---|---|
| #9, #11, #12, #51 | CS-002, CS-001, CS-003, V-10 | **RC-01** empty states — [#52](https://github.com/rhovision-org/rhogov/issues/52) |
| #31, #32 | RT-07, RT-02 | **RC-02** no write gate — [#53](https://github.com/rhovision-org/rhogov/issues/53) |
| #21, #25, #28, #42, #43, #44 | RT-03, RT-14, RT-16, V-01, V-02, V-03 | **RC-03** derived weight — [#54](https://github.com/rhovision-org/rhogov/issues/54) |
| #20, #27, #37, #40, #45, #50 | RT-13, RT-10, RT-04, RT-11, V-04, V-09 | **RC-04** result provenance — [#55](https://github.com/rhovision-org/rhogov/issues/55) |
| #15, #16, #33 | CS-006, CS-008, RT-06 | **RC-05** failure and stale states — [#56](https://github.com/rhovision-org/rhogov/issues/56) |
| #22, #34, #49 | RT-09, RT-12, V-08 | **RC-06** copy vs. system — [#57](https://github.com/rhovision-org/rhogov/issues/57) |
| #13, #14, #46, #48 | CS-004, CS-005, V-05, V-07 | **RC-07** jargon in labels — [#58](https://github.com/rhovision-org/rhogov/issues/58) |
| #10 | CS-007 | singleton — [issue](https://github.com/rhovision-org/rhogov/issues/10) |
| #26 | RT-15 | singleton — [issue](https://github.com/rhovision-org/rhogov/issues/26) |
| #30 | RT-01 | singleton — [issue](https://github.com/rhovision-org/rhogov/issues/30) |
| #38 | RT-05 | singleton — [issue](https://github.com/rhovision-org/rhogov/issues/38) |
| #39 | RT-08 | singleton — [issue](https://github.com/rhovision-org/rhogov/issues/39) |
| #47 | V-06 | singleton — [issue](https://github.com/rhovision-org/rhogov/issues/47) |

28 grouped + 6 singletons = 34. The `vibes` duplicates fold into the buckets they duplicate (#48↔#13
identical targets, #49↔#34, #51↔#9, #43↔#28, #44↔#21, #45↔#27); the `vibes` label stays on them for
provenance.

## Cross-cutting: the glosses exist, but inside collapsed containers

Found while verifying RC-04 in source, and it spans four buckets, so it is recorded once here rather
than buried in each issue.

The app **does** explain the things the findings say are undisclosed. `votes.tsx:255` explains that
the bars are first preferences, `:265` explains weight and delegation, `:276` explains the node's
entire query chain, `groups.tsx:195` phrases delegation plainly, and `groups.tsx:241` explains the
censure cascade. Every one of them sits in a muted footnote, an `<Info>` block or a `<details>` that
is collapsed by default — and the audit's own `visibleText()` helper strips collapsed content, which
is why a probe reading the page sees the jargon and none of the explanation.

So the shared second-order cause is **"the explanation is parked where the reader who needs it will
not look"**, and it is why findings in RC-03, RC-04, RC-06 and RC-07 all *read* as "undisclosed" when
the text exists. A fixer working one bucket alone will miss this. The owner should decide once, at
bucket level, whether the fix is to move the gloss into the control (RC-07's approach) or to make the
collapsed glosses open on the screens that raise the question.

## The seven root causes

Each issue carries its own root cause, fix plan, design scope and open decisions. Summarised:

| RC | Issue | The mechanism | Members | Owner |
|---|---|---|---|---|
| RC-01 | [#52](https://github.com/rhovision-org/rhogov/issues/52) | Screens are written for the populated case; emptiness is one `else` that congratulates, and the first action is an inline link in the last section (`home.tsx:37,58-59,78`, `council.tsx:83`) | 4 | client |
| RC-02 | [#53](https://github.com/rhovision-org/rhogov/issues/53) | `act()` has no gate: confirmation is 7 ad-hoc `window.confirm()` calls over 5 files and review keys on an opt-in `preview` only 2 call sites pass (`kit.tsx:175-178`) | 2 | client + upstream |
| RC-03 | [#54](https://github.com/rhovision-org/rhogov/issues/54) | Weight is recomputed natively from live facts and never shown, so writes move it silently and no voter sees their own (`gov.ts:200,210-213`, `groups.tsx:216-228`) | 6 | client + upstream |
| RC-04 | [#55](https://github.com/rhovision-org/rhogov/issues/55) | Result screens recompute at render time and label the recomputation as the outcome (`votes.tsx:235,267-274`, `council.ts:104-115,160-168`, `council.tsx:599-611`) | 6 | client (+ upstream) |
| RC-05 | [#56](https://github.com/rhovision-org/rhogov/issues/56) | The read path has no failure contract: bare and dead-ended with no data, silently stale with data (`kit.tsx:45,216-219`, `settings.tsx:133-135`) | 3 | client |
| RC-06 | [#57](https://github.com/rhovision-org/rhogov/issues/57) | Strings asserting a guarantee are hand-written and never checked against the code that enforces it (`setup.tsx:225`, `groups.tsx:238,259`) | 3 | client |
| RC-07 | [#58](https://github.com/rhovision-org/rhogov/issues/58) | Labels are literals in the mechanism's vocabulary while the plain gloss sits in a collapsed sibling (`groups.tsx:243,199`, `votes.tsx:168,146`, `kit.tsx:165`) | 4 | client |

## The six singletons

Each **kept** its issue rather than being folded into a bucket, and its issue carries the root cause and
the fix plan. All six are fixed now — see "Where these stand" in the two registers for what fixed each.

| Issue | Why it stands alone |
|---|---|
| [#10](https://github.com/rhovision-org/rhogov/issues/10) CS-007 | A **state-propagation bug**: `settings.tsx:139` writes the invite's node to localStorage but never to the module-level `setupNode` signal (`setup.tsx:14-15`), and the wizard's step ignores the active community. Fix is signal sync — a different file from any bucket's. |
| [#30](https://github.com/rhovision-org/rhogov/issues/30) RT-01 | A **validation and disclosure gap**: `parseInvite` (`state.ts:105-106`) checks only a URL shape, and the host renders muted (`settings.tsx:147`). Fix is in `parseInvite`/`JoinScreen`, not in a gate. |
| [#39](https://github.com/rhovision-org/rhogov/issues/39) RT-08 | The harm is the **advice**: `node.ts:184-188,214` tells the user to retry a deploy that may already have landed. Fix is deploy-status reconciliation, not a gate. (Its missing in-flight lock folds into RC-02.) |
| [#38](https://github.com/rhovision-org/rhogov/issues/38) RT-05 | Name identity: the store is not per-community (`state.ts:140,143-144,152`) and `nameError` (`people.ts:9-15`) does no Unicode normalisation. Container is backlog #4. |
| [#26](https://github.com/rhovision-org/rhogov/issues/26) RT-15 | Two mechanisms under one title: the public `invited` set with no withdrawal verb (upstream), and plaintext bodies (shared with RC-06). Split in the body. |
| [#47](https://github.com/rhovision-org/rhogov/issues/47) V-06 | Layout and prominence only: the raw-rholang settings (`settings.tsx:59-131`) sit at the same weight as daily controls. |

## Corrections this pass forced

- **RT-09 (#22) over-stated its case.** It claims the censure threshold *and the cascade* are
  undisclosed. The cascade is disclosed, at `groups.tsx:241`. The threshold is not. Recorded in RC-06
  so a fixer does not "fix" something that is already there.
- **RT-07 (#31) under-stated it.** The issue says review covers 2 of ~25 writes. The stronger fact,
  verified in source: `act()` has *no* confirm gate at all, and the app's only confirmations are 7
  scattered calls to the browser's global `confirm()`. RC-02 is written to the stronger fact.
- **The original bucket for the invite findings was rejected.** #10 and #30 were grouped as "the
  invite's declared network is not surfaced or honoured". They are two mechanisms in two files, so by
  this register's own rule they are singletons. Kept here as the record of the rule firing.
- **A seam was found with no draft.** `setRole` and `leave` have no last-admin guard
  (`rgov-core.js:489-513`, `:515-525`, backing #25). Unlike the censure seam this needs no
  native-source verification, but it has **no draft and is not filed** — it is recorded here so it is
  not lost. Draft it before filing, as with the others.

## Upstream seams

The three reviewed drafts are filed this pass in
[`rhovision-org/quantum-os`](https://github.com/rhovision-org/quantum-os), because the fixes
live in the vendored `src/chain/rgov-core.js`, which this repo must not edit (`CLAUDE.md:44-47`).

| Seam | Contract line | Backs | Filed as | Draft |
|---|---|---|---|---|
| `setRoll` replaces the electorate with no membership check, refused only when the issue is *closed* | `rgov-core.js:690-704` | #32, RC-02 | [quantum-os#244](https://github.com/rhovision-org/quantum-os/issues/244) | [`upstream/setroll-electorate.md`](upstream/setroll-electorate.md) |
| `propose` is ungated — any member can post a competing result | `rgov-core.js:771-779` | #20, #27, #37, RC-04 | [quantum-os#245](https://github.com/rhovision-org/quantum-os/issues/245) | [`upstream/propose-ungated.md`](upstream/propose-ungated.md) |
| No `uninvite` verb exists, so a mistaken invitation stays published | `rgov-core.js:477-487`, `:615` | #26 | [quantum-os#246](https://github.com/rhovision-org/quantum-os/issues/246) | [`upstream/uninvite-missing.md`](upstream/uninvite-missing.md) |

Two further seams stay **unfiled and undrafted**, because confirming them needs the rholo
native source rather than this repo: the censure threshold's ceiling-rounding and cascading slash,
and trust weighting activating on a single rating (`src/chain/gov.ts:210-213`).

**And one more, which is neither filed nor drafted and does not need that check:** `setRole`
(`rgov-core.js:489-513`) and `leave` (`:515-525`) have no last-admin guard, so a group can be stranded
with nobody able to invite or promote. It is contract-only, so it can be written up from the vendored
file alone — it is the cheapest thing on the upstream list, and the reason it is still open is that the
audit found it and never wrote it up.

All of it is collected in [#75](https://github.com/rhovision-org/rhogov/issues/75), the handoff to
quantum-os.

## Status — 2026-10-12

**Every unit here is done, and every probe passes.** Fixed across five waves, one PR each, plus two
units another session landed ahead of them:

| Unit | Fixed in |
|---|---|
| RC-01 empty states (#52) | PR #68 |
| RC-02 the write gate (#53) | PR #66 (identity + risk), PR #73 (review where the rholang is) |
| RC-03 weight nobody could see (#54) | PR #71 |
| RC-04 result provenance (#55) | PR #71 |
| RC-05 failure and stale states (#56) | `e15c476` (the way out), PR #72 (the silent half) |
| RC-06 copy vs. facts (#57) | PR #70 |
| RC-07 jargon on the controls (#58) | PR #70 |
| #10 an invite re-asks the network and the community | `c6a7182` |
| #26 an invitation is public and cannot be withdrawn | PR #66 (the disclosure) — the real fix is upstream |
| #30 an invite naming an unchosen node | `c6a7182` |
| #38 names | `2cca707` |
| #39 retry advice | `2cca707` |
| #47 the quiet power-user corner | PR #72 |

The register's own history is intact: the 28 findings still sit in `register.md` and
`register-redteam.md` with their probes and verbatim failures, and the 3 upstream issues are still
filed in quantum-os (#244, #245, #246).

**What is not done, and is not this repo's to do:** the contract halves. `setRoll` still permits
replacing an electorate, `propose` is still ungated, and an invitation still cannot be withdrawn.
The `setRole`/`leave` last-admin guard remains **undrafted** — written up nowhere, filed nowhere.
All four are collected in [#75](https://github.com/rhovision-org/rhogov/issues/75), the handoff to
quantum-os.

The findings themselves are unchanged — that is the point of keeping them. What changed is the code
they were about: every probe that was red when this register was written passes now.
