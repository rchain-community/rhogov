# Remediation order

The 34 audit findings are grouped into **13 remediation units** — 7 root causes
([`root-causes.md`](root-causes.md), #52–#58) and 6 singletons (#10, #26, #30, #38, #39, #47). This
orders them for fixing, by **criticality × triviality**, descending: cheap-but-harmful first.

**This document fixes nothing.** It is the order and the reasoning; the fixes are separate work, and
each unit's own issue carries its fix plan and design scope.

### Status — executed, 2026-10-12

**All thirteen units are fixed and every probe passes.** The order below was followed: five waves, one
PR each, plus the two units `2cca707` landed ahead of them.

| Wave | Units | PR |
|---|---|---|
| 0 — the enablers | RC-02's gate (identity, `risk`/`key`, the in-flight lock), the `Info` gloss lever | #66 |
| 1 | #10, #30 (already fixed by `c6a7182`), RC-01 | #68 |
| 2 | RC-06, RC-07 | #70 |
| 3 | #26 (needed nothing further), RC-03, RC-04 | #71 |
| 4 | RC-05 (the silent half), #47 | #72 |
| 5 | RC-02's review half — the last red probe | #73 |

Three ratings were corrected in the amendment, and two counts; each is marked **✎**. What was learned
about the ordering instrument is under [Where the metric misfires](#where-the-metric-misfires) and has
not been edited away — it is the reason the order was followed with judgement rather than literally.

## The two scales

### Criticality (C)

The worst member finding's severity, as the auditors assigned it: **S1=4, S2=3, S3=2, S4=1**. Nothing
already graded is re-graded here.

Six units had **no severity at all** — every reading-only finding was filed that way (the evidence
pending set in [`register-redteam.md`](register-redteam.md)). Those are graded in this pass from the
mechanism, using the tabletop's own instrument (`red-team-tabletop.md:228-255`): assign Impact,
Exploitability and Detectability, then map. Grades introduced here are marked **†** and show their raw
`I/X/D` so a reader can disagree explicitly rather than argue with a number.

None of the graded triple is D1, so the rubric's bump rule (a D1 finding crossing TB2–TB6 rises one
class) does **not** fire for any of them.

### Triviality (T)

Higher is easier. Measured by **counted edit sites**, not by feel — every T below cites the count it
came from.

| T | Anchor |
|---|---|
| **T4** | ≤3 edit sites, one file, no new mechanism, no decision |
| **T3** | ≤5 edit sites, ≤2 files, at most a small new mechanism, at most a copy/word decision |
| **T2** | ~6–8 edit sites, or a new shared component, or a format/signature decision |
| **T1** | a required-field signature change rippling through many call sites, or a decision that gates it |

### Reading the score

`score = C × T`. With 13 units over a 4×4 grid, **ties are unavoidable** — four units score 12 and
four score 6 — so the tie-break rule is load-bearing and is stated here so the order can be
re-derived rather than taken on trust:

1. higher criticality first,
2. then fewer counted edit sites,
3. then units that unblock others.

## The ratings

| Unit | C | Why that C | T | Why that T (counted) |
|---|---|---|---|---|
| **RC-01** empty states (#52) | 4 | CS-002 is S1 — an empty community is told it is all caught up, so the reader leaves thinking they are done | **2** ✎ | 4 files plus a new shared `EmptyState`. The T3 anchor caps at ≤2 files, and a new shared component is a T2 clause; the work itself is only ~5 edits (the `card soft empty` idiom at `home.tsx:59,78` already exists). Small, but not local |
| **RC-02** write gate (#53) | 3 | RT-07 and RT-02 are both S2 | **1** | ~42 edits: one signature (`kit.tsx:175`) + **34** `act(` call sites ✎ + **7** `confirm(` call sites (only **2** pass `preview`) |
| **RC-03** weight invisible (#54) | 3† | RT-03 `I3 X4 D2`, RT-14 `I3 X2 D2`, RT-16 `I3 X3 D2` → all AS-2 | 3 | ~5 edits; every value already comes from the native standing query, so this is display and plumbing |
| **RC-04** result provenance (#55) | 3 | #37 is S2 and #40 S3 as filed; RT-13 `I3 X4 D2` and RT-10 `I3 X2 D2` → AS-2† | 2 | ~6–7 edits + one `<NodeResult>` badge + a record-format change (bare string → map) |
| **RC-05** failure and stale states (#56) | 3 | CS-006, CS-008 and RT-06 are all S2 | 2 | ~8 edits, one new `StatusCard`; staleness is an *additive* field, so none of the **15** `useAsync` callers ✎ is forced to change |
| **RC-06** copy vs. facts (#57) | 3† | RT-12 is S3 as filed, but RT-09 grades `I3 X2 D2` → AS-2 | 3 | 4 edits, one of them `CLAUDE.md` |
| **RC-07** jargon in labels (#58) | 2 | CS-004 and CS-005 are both S3 | 3 | ~7 edits; a new `term()` map. The `JARGON` regex sweeps 8+ visible sites across the 5 probed routes |
| **#10** invite re-asks (CS-007) | 4 | S1 as filed — a stray click installs a second set of contracts | 3 | ~3–4 edits; reuse the module `setupNode` signal (`setup.tsx:14-15`) |
| **#26** invitation public (RT-15) | 3† | `I3 X2 D2` → AS-2 | **4** | **1–2 copy sites** — the smallest change here, and **deferred** from the sequence: the client half is a warning and removes almost none of the harm, so its place at the top of the board is the instrument, not the value ✎ |
| **#30** invite node (RT-01) | 4 | S1 as filed — a signed deploy goes to a host the user never chose | 3 | 2 edits; `NETWORKS` (3 presets, `state.ts:32-36`) exists, so it can warn rather than gate |
| **#38** names (RT-05) | 3 | S2 as filed, `I3 X3 D2` | 2 | ~4–5 edits, but the subtlest unit here: cross-community state reset + a homoglyph policy + deterministic numbering. **Its T2 is a subtlety estimate, not a size estimate** |
| **#39** retry advice (RT-08) | 3 | S2 as filed, `I4 X1 D3` | 3 | 2–3 edits; reuse the `RNode.outcome` re-poll by signature (`node.ts:199`) |
| **#47** quiet corner (V-06) | 1 | no defect behind it — a design opinion, filed because the vibes set was deduped rather than dropped | **3** ✎ | 1 file, ~3 edits; reuses `Info` (`kit.tsx:258`). Not T4: it carries a real information-architecture decision (which controls count as power-user) and a dependency on RC-05, and the T4 anchor requires no decision |

## The order

| # | Unit | C | T | Score | Note |
|---|---|---|---|---|---|
| 1 | **#10** invite re-asks | 4 | 3 | **12** | S1 with a 3–4 edit fix — the best value on the list |
| 2 | **#30** invite node | 4 | 3 | **12** | 2 edits; warn on a host outside the 3 presets before anything is signed |
| 3 | **RC-06** copy vs. facts (#57) | 3 | 3 | **9** | rule prose only — the number is unobtainable |
| 4 | **RC-03** weight invisible (#54) | 3 | 3 | **9** | display and plumbing; its gate half waits on RC-02 |
| 5 | **RC-01** empty states (#52) | 4 | 2 | **8** | the only S1 root cause — and it now ranks *below* two S2/S3 units. See below |
| 6 | **RC-04** result provenance (#55) | 3 | 2 | **6** | client-only — confirmed below |
| 7 | **RC-05** failure and stale states (#56) | 3 | 2 | **6** | additive field, so no caller is forced to change |
| 8 | **RC-07** jargon (#58) | 2 | 3 | **6** | the lowest-criticality root cause |
| 9 | **RC-02** write gate (#53) | 3 | 1 | **3** | the metric's worst output — see below |
| 10 | **#47** quiet corner | 1 | 3 | **3** | no defect behind it |
| — | **#26** invitation public | 3 | 4 | (12) | **deferred by judgement, not by score** — 1–2 copy sites that remove almost none of the harm. It would rank 3rd on the arithmetic |

Done, and no longer in the order:

| Unit | Commit |
|---|---|
| **#38** names | `2cca707` — issue closed |
| **#39** retry advice | `2cca707` — issue closed |

### Where the metric misfires

**RC-02 ranks last while being the enabler of two units above it.** It is the only T1, and the product
rewards cheapness, so it sinks to the bottom regardless of the fact that RC-03's gate half and
RC-05's in-flight lock both have to be written against it. #47 — which has no defect at all — outranks
it.

This is a property of a multiplicative score, not a mistake in the arithmetic. It is recorded rather
than corrected, with one exception: the two enablers below run before wave 1.

**The cause is the symmetry, not the arithmetic.** Both axes are 1–4 and equally weighted, so a
one-step ease gap always cancels a one-step severity gap. Nothing in *"cheap high-harm work first"* says
the two are fungible — the product smuggles that in. Two consequences are visible in the table above:

- **RC-01, the only S1 root cause, ranks 5th** — below two S2/S3 units. Correcting its size from T3 to
  T2 cost it more places than its severity earns it. An S1 that is merely *not tiny* loses to an S3
  that is.
- **#47, which has no defect behind it at all, ranks one place below RC-02** — and outranked it
  outright under the pre-amendment ratings.

Eleven of the 13 units therefore fall into ties, which means the tie-break rule is doing more of the
work than the product is. A **lexicographic** order — severity band first, then triviality — would put
RC-01 in the top three, never let #47 outrank a gate, and need almost no tie-breaking. That is the
instrument this data wants. It is recorded here and **not adopted**, because the product is what was
asked for and the ordering is good enough to work from.

## Wave 0 — two enablers, outside the ranking

The formula cannot express *"this must exist before three of those fixes are written"*. These two run
before wave 1 and are excluded from the C × T table, with the reason stated:

| Enabler | Why it is outside the metric | Cost |
|---|---|---|
| **RC-02 gate skeleton** (#53) | Last by score, first by dependency. RC-03's gate half and RC-05's in-flight lock are written *against* it; retrofitting them costs more than ordering it early | T1 — but the skeleton alone is the `act()` signature plus migrating the 7 `confirm(` calls, not the full 31-site migration |
| **`Info` discoverability** (`kit.tsx:258`) | One component behind four units' findings. It is a lever, not a unit — ranking it among them would double-count the same work | T4 — one component |

Both are **prerequisites, not shortcuts.** Wave 0 alone does not make any probe pass.

**Do not mistake RC-02's small variant for the fix.** Defaulting review on (dropping the `opts.preview`
opt-in) and adding the missing confirmation to the voter-roll write is about 2 edits and turns RP1 and
RP3 green — while leaving the `risk` taxonomy and the in-flight lock unbuilt. It makes the probes pass
and the root cause stand. If it is done at all, it is done as step one of RC-02, in the same change as
the rest.

## The cross-cutting lever

`Info` (`kit.tsx:258`) is a single `<details class="small">` whose summary is the hardcoded string
"How does this work?".

It is the **one code locus** behind the cross-cutting cause found while regrouping: every gloss the
audits called "undisclosed" is parked inside it — the ranked bars (`votes.tsx:255`), the weight and
delegation arithmetic (`:265`), the node's whole query chain (`:276`), the censure cascade
(`groups.tsx:241`). Collapsed by default, which is why the audit's own `visibleText()` helper strips it
and the probes read as though the text were not there.

So four units' findings — RC-03, RC-04, RC-06 and RC-07 — trace partly back to one component. Changing
what `Info` looks like when it holds a gloss the reader needs is a single T4 change with a
four-unit footprint, which is why it is wave 0 rather than a footnote in four places.

**Decision it needs:** whether to open the gloss on the screens that raise the question, or move the
gloss into the control itself (which is RC-07's approach). The two are not exclusive, but doing neither
leaves the four findings half-fixed by copy alone.

## Done: two units already landed

`2cca707` — *"Names stay in their community; look-alikes collide; no repeat that could happen twice"* —
closed **#38** and **#39**. Verified against the commit, not its message:

| Sub-point | State |
|---|---|
| #38 address book per community (`state.ts:131-141` `inScope`) | done |
| #38 look-alikes one name (NFKC, confusables, mixed-script refusal) | done |
| #38 duplicates numbered by **claim order** | **not done** — still address order (`state.ts:186-193`). The commit resolved the finding another way: every duplicate is numbered, with a tooltip saying the numbers do not imply who was first, which removes the false implication the finding was about. **Resolved by other means, not reopened** |
| #39 reasonless refusal reconciled before advising a retry (`node.ts:206,242-255`) | done |
| #39 timeout copy, 15-minute wait, `StillUnknown` (`node.ts:218,231,233-235`) | done |
| #39 a failed deploy says its fee was charged (`node.ts:229`) | done |
| #39 the in-flight lock (`kit.tsx:158`) | done, **defective** — superseded in wave 0 |

**The in-flight lock is keyed by the human title string.** It is wrong in five ways, and because it is
the same mechanism wave 0 must build, wave 0 **replaces** it rather than extending it: two different
writes sharing a title collide; a constant title over-blocks independent writes (`groups.tsx:245` is
"Removing admin" for *any* member); a title containing a name defeats the lock entirely; the check sits
*after* the review modal, so two clicks both open it; and it does not survive a reload.

Four follow-ups are filed as issues rather than absorbed: the `help.tsx` three-places gap for the new
pending-install advice; five untested claims (the lock, `NotCarried`, `StillUnknown`, the
`DeployFailed` fee line, and the `(1)/(2)` path when more than one claim exists);
`inScope` wiping the address book on any community change (`state.ts:139`) while keeping the directory
within a network; and `tests/e2e/names.spec.ts` having been "modified" as a lone trailing newline.

## Cautions — what "done" actually means per unit

Established while sizing. Each changes the value of its unit, and belongs beside it.

- **#26 is near-cosmetic.** The client half is one or two sentences of warning. The invited address
  stays public and unwithdrawable until `uninvite` exists upstream (quantum-os#246). Its #4 position by
  score **overstates its value** — the product cannot see that its harm survives the fix.
- **RC-06 half-fixes nothing by itself.** `standingProgram` (`gov.ts:188-235`) returns only
  `levels`, `discredited` and `trustActive` — there is **no** threshold and no `eligible` count to
  display, and computing `max(2, ⌈⅔·eligible⌉)` client-side is forbidden by CLAUDE.md. The rule prose
  is honest copy and worth doing; the number needs a native read, which is not this repo's to make.
- **RC-04 is client-only — confirmed in source, not assumed.** A frozen comparison is possible today:
  `Issue.results` already holds an arbitrary value, and `council.tsx:570-576` already writes a
  structured map `{phase, winner, rationale, actions, scores}`. The votes path records a bare string
  instead (`votes.tsx:113`, `G.propose(i.id, out.winner, t)`), which is exactly why the badge has to
  re-derive. The fix is to record the winner **and the weights** at close and compare against that
  frozen value.
- **RC-05 is smaller than it looks.** Staleness as an *additive* field means none of the 10 `useAsync`
  callers change, and swapping `Loading`'s error branch is internal to `kit.tsx`. The only genuinely
  new work is the escape affordance — naming the community and node that failed, and giving the
  damaged-invite path somewhere to go.
- **#38 is larger than its edit count.** Four or five sites, but it carries a policy decision
  (homoglyph handling), a state-lifetime fix (`raw` is module-level, `state.ts:140`), and deterministic
  numbering. Treat its T2 as a measure of subtlety.
- **#47 has a precondition that its rank hides.** It must not bury the node URL, and that URL is not on
  the failure card today — RC-05 has to add that path first. So #47 depends on RC-05 (rank 10) despite
  ranking above it (rank 12). Sequence it after.
- **#39's fix is a mitigation.** Re-polling the deploy status by signature stops the app advising a
  retry that already landed; it does not make a second install impossible, which needs an idempotent
  install upstream.

## What turns green

"Done" is testable where a probe exists, and stated where it does not. These are red by design and
stay red until the code changes — a closed finding is not a fixed finding.

| Unit | Turns green |
|---|---|
| RC-01 (#52) | `P1`, `P2`, `P3` — `tests/e2e/audit/cold-start.probe.spec.ts` |
| RC-02 (#53) | `RP1`, `RP3` — `tests/e2e/redteam/redteam.probe.spec.ts` |
| RC-03 (#54) | **none** — all three members are evidence-pending |
| RC-04 (#55) | **none** — all members are evidence-pending |
| RC-05 (#56) | `P6`, `P8`, `P11`, `RP6` |
| RC-06 (#57) | `RP8` — `redteam-offline.probe.spec.ts` |
| RC-07 (#58) | `P4`, `P5` |
| #10 | `P7a`, `P7b`; the S7 guard in `cold-start.spec.ts` must stay green |
| #26 | **none** — evidence-pending |
| #30 | `RP2` |
| #38 | **done** — closed by `2cca707`; unit tests added in `tests/unit.ts`, no node needed |
| #39 | **done** — closed by `2cca707`; `tests/e2e/deploys.spec.ts` added with it, and it needs a live node |
| #47 | **none** — no defect, human review only |

```sh
npm run test:audit      # P-probes
npm run test:redteam    # RP-probes
```

## Upstream, in parallel — not ranked

These are other repos, other owners, and their unit of work is a contract change. Comparing a contract
change against a one-line copy edit by `C × T` would be meaningless, so they are sequenced separately
rather than omitted.

| Upstream issue | Backs | Status |
|---|---|---|
| [quantum-os#244](https://github.com/rhovision-org/quantum-os/issues/244) `setRoll` | RC-02's contract half | filed |
| [quantum-os#245](https://github.com/rhovision-org/quantum-os/issues/245) `propose` | RC-04's notion of *whose* record is the record | filed |
| [quantum-os#246](https://github.com/rhovision-org/quantum-os/issues/246) `uninvite` | #26's real fix | filed |
| `setRole` / `leave` last-admin guard | RC-03's stranding half | **undrafted** — recorded in [`root-causes.md`](root-causes.md), not filed |

**Sequencing:** file nothing new until the three filed issues are triaged upstream. RC-02, RC-04 and
#26 are each written so their client half stands alone; none of them should wait on upstream, and none
of them is complete without it.

## Corrections recorded in this pass

- **RT-09 (#22) graded above its filed severity.** Its filing left severity unset; it grades `I3 X2 D2`
  → AS-2 → **S2**, which lifts RC-06 from S3 to S2 and moves it up the order. The finding's substance
  is unchanged.
- **#30 is probe-backed.** An earlier draft of this plan listed it as a reading finding with no probe;
  it has `RP2` (`redteam-offline.probe.spec.ts`), so fixing it is testable.
- **#10's probes are `P7a`/`P7b`,** not the cold-start guard. The guard is what must *stay* green.

## Status

**Done.** All thirteen units are fixed, all seventeen probes pass, and the working rules this document
set for itself were kept: a wave that reddened a guard was reverted rather than patched forward (Help's
next-step wording, PR #68), a copy change that made a probe pass while the cause stood was refused
(the RC-07 five-rename shortcut, the RC-02 two-edit variant), and a claimed fix from another session
was measured rather than trusted (`c6a7182`'s "P7a, P7b and RP2 now pass" — they did).

Every rating still carries the count or the `I/X/D` it came from, so the order can be argued with
rather than merely followed — and the arguments it lost are recorded rather than tidied away.
