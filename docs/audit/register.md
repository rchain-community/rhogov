# Cold-start audit — register

The findings from the adversarial cold-start audit, one row per finding, each backed by a
probe that fails today. The method and the rubric are in
[`cold-start-protocol.md`](cold-start-protocol.md).

**These probes were red on purpose; all of them pass now.** They live in `tests/e2e/audit/`, are
excluded from `npm run test:e2e`, and run with `npm run test:audit`. A red probe was a finding, not a
broken test — and a probe that starts passing *on its own* is a warning that it has gone stale, which
is why each finding below names what fixed it rather than only that something did. Behaviour that
already worked is covered by green tests in `tests/e2e/cold-start.spec.ts`, which run in the normal
suite.

## Findings

| ID | Sev | Finding | Probe | Target | Issue |
|---|---|---|---|---|---|
| CS-002 | **S1** | An empty community is told *"You're all caught up."* | P2 | `src/ui/home.tsx:39` | [#9](https://github.com/rhovision-org/rhogov/issues/9) |
| CS-007 | **S1** | An invite re-asks the network and re-asks to join the community you just joined (a stray click installs a second set of contracts, ~0.02 REV) | P7a, P7b | `src/ui/settings.tsx:137-141`, `src/ui/setup.tsx:14-15,217-219` | [#10](https://github.com/rhovision-org/rhogov/issues/10) |
| CS-001 | S3 | Home never says what rhogov is for | P1 | `src/ui/home.tsx:23-24` | [#11](https://github.com/rhovision-org/rhogov/issues/11) |
| CS-003 | S2 | The empty community's call to action is buried below a false success message | P3 | `src/ui/home.tsx:58` | [#12](https://github.com/rhovision-org/rhogov/issues/12) |
| CS-004 | S3 | Unglossed jargon on the cold-start path (`censure`, `roll`, `phlo`) | P4 | `src/ui/groups.tsx:240`, `src/ui/votes.tsx:168`, `src/ui/kit.tsx:164` | [#13](https://github.com/rhovision-org/rhogov/issues/13) |
| CS-005 | S3 | Delegation is offered only as "Delegate my vote" | P5 | `src/ui/groups.tsx:197`, `src/ui/votes.tsx:146` | [#14](https://github.com/rhovision-org/rhogov/issues/14) |
| CS-006 | S2 | A damaged invite link is a dead end with nothing to click in the page | P6 | `src/ui/settings.tsx:135`, `src/main.tsx:31,48,61` | [#15](https://github.com/rhovision-org/rhogov/issues/15) |
| CS-008 | S2 | A community that cannot be read fails without naming it or offering a way out | P8, P11 | `src/ui/kit.tsx:215-219` | [#16](https://github.com/rhovision-org/rhogov/issues/16) |

**Regrouped by root cause.** These rows are unchanged and are the durable evidence; what changed is
the tracker issue, not the finding. **A closed finding is not a fixed finding** — the probe stays red
until the code changes. See [`root-causes.md`](root-causes.md).

| Finding | Issue | Now |
|---|---|---|
| CS-001, CS-002, CS-003 | #11, #9, #12 | closed → **RC-01** ([#52](https://github.com/rhovision-org/rhogov/issues/52)) |
| CS-004, CS-005 | #13, #14 | closed → **RC-07** ([#58](https://github.com/rhovision-org/rhogov/issues/58)) |
| CS-006, CS-008 | #15, #16 | closed → **RC-05** ([#56](https://github.com/rhovision-org/rhogov/issues/56)) |
| CS-007 | #10 | **kept** — state-propagation bug, its own issue |

All eight are **measured**, not argued: the probe fails with evidence in the failure message
(e.g. CS-002 reports `Expected substring: not "You're all caught up"`).

## Failure modes this audit did not find

Recorded so the coverage is auditable, per the protocol's rule that a cell produces a finding
*or* an explicit "no finding".

| Cell | Entry state | Result |
|---|---|---|
| S4 | Stale key, no community | **No finding** — the wizard correctly opens at the community step |
| S7 | Invite to a community already joined | **No finding** — "Open {name}" works and adds no duplicate |

Both are protected by green tests in `tests/e2e/cold-start.spec.ts`.

## Probes

| Probe | File | Finding |
|---|---|---|
| P1 | `tests/e2e/audit/cold-start.probe.spec.ts` | CS-001 |
| P2 | " | CS-002 |
| P3 | " | CS-003 |
| P4 | " | CS-004 |
| P5 | " | CS-005 |
| P6 | `tests/e2e/audit/invite.probe.spec.ts` | CS-006 |
| P7a, P7b | " | CS-007 |
| P8 | " | CS-008 |
| P11 | `tests/e2e/audit/returning.probe.spec.ts` | CS-008 |

The two `setup` tests in `cold-start.probe.spec.ts` arrange the scenario (a group, a vote, and
a second person); they are not findings.

## Green guards (normal suite)

`tests/e2e/cold-start.spec.ts` — runs under `npm run test:e2e`:

- Help knows the right next step for a brand-new community
- the wizard's steps advance and "Change" returns you
- a keyed user with no community resumes at the community step *(the S4 no-finding)*
- an invite to a community you already have opens it *(the S7 no-finding)*

## Where these stand — 2026-10-12

**All eight are fixed and every probe passes.** The finding rows above are unchanged: they are the
record of what was found, and none of them was wrong.

| Finding | Fixed by | Probe, now |
|---|---|---|
| CS-001 Home never says what rhogov is for | PR #68 | P1 ✓ |
| CS-002 an empty community is told "You're all caught up" | PR #68 | P2 ✓ |
| CS-003 the first-run call to action is buried | PR #68 | P3 ✓ |
| CS-004 unglossed jargon on the cold-start path | PR #70 | P4 ✓ |
| CS-005 delegation offered only in the mechanism's own word | PR #70 | P5 ✓ |
| CS-006 a damaged invite is a dead end | `e15c476` | P6 ✓ |
| CS-007 an invite re-asks the network and the community | `c6a7182` | P7a ✓, P7b ✓ |
| CS-008 a community that cannot be read fails anonymously | `e15c476` (the way out), PR #72 (the silent half) | P8 ✓, P11 ✓ |

```sh
npm run test:audit    # 12 passed, 0 failed, against a local node at RHOGOV_NODE
```

**What the run needs**, none of which is obvious from the command: a node at `RHOGOV_NODE`
(default `http://127.0.0.1:40403`), `CHROMIUM_PATH` set if Playwright's own Chromium is not installed,
and **test keys with REV**. The probes install communities, which costs about 0.02 REV each, so a key
that has been drained by repeated runs leaves a greyed-out button and a test that times out rather
than failing on its assertion. `scratch/fund-test-keys.ts` tops them up through the node's faucet.
