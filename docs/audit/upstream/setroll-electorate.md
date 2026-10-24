# Draft upstream issue — `setRoll` can replace an issue's electorate after ballots are cast

**Target:** quantum-os (the contract is `src/chain/rgov-core.js` here, vendored; see `CLAUDE.md:44-47`)
**Status:** **filed** — [quantum-os#244](https://github.com/rhovision-org/quantum-os/issues/244).
**Found by:** the red-team tabletop, scenario T2 (`docs/audit/red-team-tabletop.md`).

## What the contract does

`setRoll` (`rgov-core.js:690-704`) is opener-only and refused only when the issue is already
**closed**:

```rholang
match [i.getOrElse("by", Nil) == me, i.getOrElse("status", "open") == "closed"] {
  [false, _] => ... "not the opener"
  [_, true]  => ... "closed"
  _ => state!(s.set(iid, i.set("voters", voters))) | ...
}
```

Three consequences:

1. **No membership check.** The addresses need not belong to the group — any address at all can
   be written into the electorate.
2. **Replacement, not addition.** `i.set("voters", voters)` overwrites the whole set, so existing
   voters can be *removed*.
3. **Allowed once ballots exist.** The guard is `status == "closed"`, so while the issue is open —
   after people have voted, before the opener closes it — the electorate can be rewritten. The
   comment above the verb says it is "refused once the issue is closed so an electorate cannot be
   edited after a vote", which is stronger than the code: a vote has happened, and the electorate
   is still editable.

The app sends the current member list, but the verb is a general write.

## Why it matters

The opener can watch the live tally — the app renders it as "Standing so far" directly beside the
roll control (`src/ui/votes.tsx:164-171`) — then add or remove voters to change the outcome. The
README tells the user the opposite: *"An issue's voter roll is fixed when it opens"*
(`README.md:172-174`), and the guide says *"Everyone who was a member when the vote opened can
vote"* (`docs/user-guide.md:120`).

## What we would want

- `setRoll` refuses once **any ballot exists** on the issue (not merely once it is closed), or
- `setRoll` accepts only *additions*, and validates each address against the group's members at
  the time of the call, or
- the roll becomes immutable at `open`, with a separate, explicit and disclosed amendment verb.

Additionally, whether the electorate may change while an issue is `locked` should be decided
explicitly; today `locked` is not consulted.

## Reproduction (client-observable)

The red-team probe `RP3` (`tests/e2e/redteam/redteam.probe.spec.ts`) asserted the client-side half:
changing who may vote while results are visible raised no confirmation, unlike closing the vote.
**That half is fixed** (PR #66) — the write now asks first, states that the change replaces who may
vote, and is keyed so it cannot be fired twice. **RP3 passes.**

None of that touches this issue: the contract still permits the replacement. It is reproducible with
any client by opening an issue, casting a ballot, and calling `setRoll` with a different address list
before closing.
