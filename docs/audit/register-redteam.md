# Red-team audit — register

The findings from the adversarial red-team tabletop. One row per finding, each backed by a probe
that fails today. The method, the personas and the scenario pack are in
[`red-team-tabletop.md`](red-team-tabletop.md).

**Probes are red on purpose.** They live in `tests/e2e/redteam/`, are excluded from
`npm run test:e2e`, and run with `npm run test:redteam`. A red probe is a finding, not a broken
test.

**Finding IDs are scenario-bound**: `RT-nn` is scenario `Tn`. The table below is sorted by
severity for reading.

## Findings

| ID | Sev | Abuse | I/X/D | Finding | Scenario | Probe | Target | Owner | Issue |
|---|---|---|---|---|---|---|---|---|---|
| RT-01 | **S1** | AS-1 | I4 X4 D1 | An invite naming an unchosen node is signed to without warning | T1 | RP2 | `src/state.ts:105-106` | client | [#30](https://github.com/rchain-community/rhogov/issues/30) |
| RT-02 | S2 | AS-2 | I3 X2 D2 | Changing the voter roll after ballots exist asks for no confirmation | T2 | RP3 | `src/ui/votes.tsx:168` | client + upstream | [#32](https://github.com/rchain-community/rhogov/issues/32) |
| RT-06 | S2 | AS-3 | I2 X1 D1 | A screen that cannot refresh keeps showing old data with no indication | T6 | RP6 | `src/ui/kit.tsx:41,44,216-217` | client | [#33](https://github.com/rchain-community/rhogov/issues/33) |
| RT-07 | S2 | AS-2 | I3 X4 D2 | Review-before-sign is kept for 2 of ~25 writes | T7 | RP1 | `src/ui/kit.tsx:175-178` | client | [#31](https://github.com/rchain-community/rhogov/issues/31) |
| RT-12 | S3 | AS-3 | I2 X4 D2 | The welcome screen promises "private inboxes"; bodies are plaintext on chain | T12 | RP8 | `src/ui/setup.tsx:225` | client | [#34](https://github.com/rchain-community/rhogov/issues/34) |

**Regrouped by root cause.** The rows in this register are unchanged and remain the durable evidence;
what changed is the tracker issue, not the finding. **A closed finding is not a fixed finding** — the
probe stays red until the code changes. See [`root-causes.md`](root-causes.md).

| Finding | Issue | Now |
|---|---|---|
| RT-07, RT-02 | #31, #32 | closed → **RC-02** ([#53](https://github.com/rchain-community/rhogov/issues/53)) |
| RT-03, RT-14, RT-16 | #21, #25, #28 | closed → **RC-03** ([#54](https://github.com/rchain-community/rhogov/issues/54)) |
| RT-13, RT-10, RT-04, RT-11 | #20, #27, #37, #40 | closed → **RC-04** ([#55](https://github.com/rchain-community/rhogov/issues/55)) |
| RT-06 | #33 | closed → **RC-05** ([#56](https://github.com/rchain-community/rhogov/issues/56)) |
| RT-09, RT-12 | #22, #34 | closed → **RC-06** ([#57](https://github.com/rchain-community/rhogov/issues/57)) |
| RT-01, RT-05, RT-08, RT-15 | #30, #38, #39, #26 | **kept** — four mechanisms that stand alone |

Each was **measured**, not argued: the probe fails on its intended assertion, and the failure
message carries the evidence. Verbatim, from the run:

- RT-01 — `an invite naming an unchosen node must say so prominently` … `element(s) not found`
- RT-07 — `the setting promises every action, not two of them` … `getByRole('dialog', { name: /^Sign:/ })` not found
- RT-02 — `changing the electorate after ballots exist must confirm first` … `Expected: true, Received: false`
- RT-06 — `a screen showing old data must say so when it cannot refresh` … received the loaded screen
- RT-12 — `not.toMatch(/private inboxes/i)` … matched `private inboxes — all on chain`

The run was on the playground, and the community in play was ours throughout
(`Redteam Alice …`) — the hard prohibition held: no third-party community was opened.

## Upstream seams — drafted, awaiting review

These are in the vendored `src/chain/rgov-core.js`, which this repo **must not edit**
(`CLAUDE.md:44-47`). They are written up as drafts and **not filed**: they name concrete defects
in someone else's contracts, so the wording should be read before it goes to quantum-os.

| Seam | Contract line | Consequence | Draft |
|---|---|---|---|
| `setRoll` replaces the electorate with no membership check, and is refused only when the issue is *closed* | `rgov-core.js:690-704` | the opener can add or remove voters after ballots are cast — the contract's own comment claims otherwise | [`upstream/setroll-electorate.md`](upstream/setroll-electorate.md) |
| `propose` is ungated | `rgov-core.js:771-779` | any member can post a competing "result" on any issue; the app hides the control but the state is public and indistinguishable | [`upstream/propose-ungated.md`](upstream/propose-ungated.md) |
| No `uninvite` verb exists (only `uncensure` and `undelegate` have mirrors) | `rgov-core.js:477-487`, `:615` | a mistaken or declined invitation leaves the invitee's address publicly listed forever, unless they join | [`upstream/uninvite-missing.md`](upstream/uninvite-missing.md) |

Two further seams were reported by reading but are **not** yet drafted, because confirming them
needs the rchain-rust native source rather than this repo: the censure threshold's
ceiling-rounding and cascading slash (`max(2, ⌈⅔·eligible⌉)`), and trust weighting activating on
any single rating (`src/chain/gov.ts:210-213`). Draft them only against verified upstream source.

## Evidence-pending findings (filed from reading)

Observed by reading source; **no probe and no completed manual walk**. They are filed so the
tracker reflects them, and each carries an "Evidence-pending" comment marking exactly that. They
are not held to the standard of the five above.

| ID | Finding | Scenario | Owner | Issue |
|---|---|---|---|---|
| RT-03 | One rating flips a whole group to weighted voting, and ratings are forward-looking | T3 | client + upstream | [#21](https://github.com/rchain-community/rhogov/issues/21) |
| RT-04 | A council's decision of record carries no compare-to-tally badge once saved | T4 | client + upstream | [#37](https://github.com/rchain-community/rhogov/issues/37) |
| RT-05 | A name earned in one community is worn unmarked in another; homoglyphs are claimable; `(2)` follows address order | T5 | client | [#38](https://github.com/rchain-community/rhogov/issues/38) |
| RT-08 | Retry advice after a timeout or an ambiguous deploy can install a second community | T8 | client | [#39](https://github.com/rchain-community/rhogov/issues/39) |
| RT-09 | The censure threshold is ceiling-rounded and the slash cascades; neither is disclosed | T9 | client + upstream (rchain-rust) | [#22](https://github.com/rchain-community/rhogov/issues/22) |
| RT-10 | Council power, the combined score and the recorded scores are browser-computed, not node-verified | T10 | client | [#27](https://github.com/rchain-community/rhogov/issues/27) |
| RT-11 | Ranked-choice bars can show a losing option as the longest, disclosed only in muted text | T11 | client | [#40](https://github.com/rchain-community/rhogov/issues/40) |
| RT-13 | A recorded result is compared to a tally that keeps moving after the vote closes | — (additional) | client | [#20](https://github.com/rchain-community/rhogov/issues/20) |
| RT-14 | Making or removing an admin silently changes vote weight; a group can strand itself with no admins | — (additional) | client | [#25](https://github.com/rchain-community/rhogov/issues/25) |
| RT-15 | A group invitation leaks the invitee's address publicly, and the message is unencrypted | — (additional) | client + upstream | [#26](https://github.com/rchain-community/rhogov/issues/26) |
| RT-16 | Delegation concentrates weight without limit; per-issue delegations are invisible to the delegate | — (additional) | client | [#28](https://github.com/rchain-community/rhogov/issues/28) |

**RT-13…RT-16 are additional findings with no scenario card** — they came out of the same
governance reading but are not among T1–T12, which is why the IDs skip. The `RT-nn = Tn` binding
holds for RT-01…RT-12 only.

**Note.** RT-09's substance is partly an **rchain-rust native** question (`max(2, ⌈⅔·eligible⌉)`
and the cascading slash are computed by the node), so any change there belongs upstream; the
disclosure half is client-fixable. RT-15's missing `uninvite` verb is likewise upstream
([`upstream/uninvite-missing.md`](upstream/uninvite-missing.md)).

### Coverage

All twelve scenarios now have a filed issue, so no documented finding is left without one. The
two-way property the tracker already had still holds: every `RT-nn` here resolves to an issue,
and every open issue links back to its row.

Filing order within the evidence-pending set reflects how the findings were reached, not their
severity — read the `Sev` column for that.

## Tracker remediation

The first pass left the tracker in a state this exercise did not intend, and it is recorded here
rather than tidied away.

A read-only exploration run opened twelve issues (#18–#29) with the `red-team` label. Five
duplicated probe-backed findings (#18, #19, #23, #24, #29 — closed as duplicates of #30, #32,
#33, #31, #34, which were kept because they carry the probe name, the verbatim failure message
and the owner split). The remaining seven were kept and **renumbered to end an ID collision**:
three onto the scenario IDs whose substance they share (RT-03, RT-09, RT-10) and four into new
IDs (RT-13…RT-16). Every one carries an "Evidence-pending" comment.

The lesson, for future agent briefs: an exploration run must be told explicitly **not** to run
`gh` or otherwise mutate shared state, and must not be given a goal that reads as "file these".

## No-finding cells

None recorded yet. The predict–observe table in the pack (`red-team-tabletop.md`) carries the
predictions; a prediction that **holds** is recorded here as an explicit no-finding, as the
cold-start register records its S4 and S7. The manual rung passes fill this table.

## Corrections forced by the run

Applying the rubric produced an indefensible result, so the rule was tightened — recorded here as
the cold-start protocol records its probe defects.

**The bump rule was too aggressive.** The pack originally read *"a finding at D1/D2 that crosses
TB2–TB6 is bumped one class."* Applying it made RT-12 (the "private inboxes" copy) an **S1
blocker**, which is absurd for a headline wording problem. D2 means *visible to someone who knows
the mechanism* — not invisible. The rule is now **D1 only**, and the pack has been corrected to
match. With the tightened rule the ladder is one S1, three S2, one S3.

Two probe hazards the cold-start run had already learned were avoided by construction here, and
are worth keeping in mind for the manual passes: reading the DOM mid-load (the shared
`visibleText` waits for "Reading the chain…" to clear), and the degenerate one-member scenario
(a one-founder group shows no roll control and no Censure button, so a probe keyed to them would
pass for the wrong reason).

## Status of the last run

Playground, 2026-10-12: **5 red, 0 green** — every probe a finding. Two need no node at all
(RP2, RP8); the three live probes need a node and a throwaway community.

```sh
npm run test:redteam
RHOGOV_NODE=https://playground.rhobot.net npm run test:redteam
```
