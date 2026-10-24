# Draft upstream issue — `propose` is ungated, so any member can post a result on any issue

**Target:** quantum-os (vendored here as `src/chain/rgov-core.js`; see `CLAUDE.md:44-47`)
**Status:** **filed** — [quantum-os#245](https://github.com/rhovision-org/quantum-os/issues/245).
**Found by:** the red-team tabletop, scenario T4 (`docs/audit/red-team-tabletop.md`).

## What the contract does

`propose` (`rgov-core.js:771-779`) writes whatever it is given into `results[caller]` with no
gate beyond the issue existing:

```rholang
["propose", [iid, result]] => {
  match s.getOrElse(iid, Nil) {
    Nil => ... "no such issue"
    i => state!(s.set(iid, i.set("results", i.getOrElse("results", {}).set(me, result)))) | ...
  }
}
```

There is no opener check, no member check, and no check on the value. Contrast `close`
(`:793-803`) and `setRoll` (`:690-704`), which are both opener-gated.

## Why it matters

The app treats the *opener's* entry as the record of the vote: `closeAndRecord`
(`src/ui/votes.tsx:110-114`) closes and then proposes the winner under the opener's name, and the
screen renders a "matches the node's tally" badge against recorded values (`votes.tsx:267-274`).
Council decisions use the same mechanism — `recordOf` reads the opener's entry
(`src/chain/council.ts:44-49`).

Because `propose` is ungated, any member can add a second `results` entry on any issue. The app
hides this by only offering the control to the opener, but the state is public and the entries
are indistinguishable in shape: a reader of chain state sees several "results", and nothing
records which one is authoritative. On council decisions the facilitator's record is trusted
purely by convention.

## What we would want

- `propose` gated to the issue's opener (matching `close` and `setRoll`), **or**
- a first-class notion of *whose* proposal is the record — e.g. the contract records a single
  `result` (not a map), settable only by the opener, with dissent expressed through a separate,
  explicitly non-authoritative verb.

## Note on the app's side

The client half is registered separately and **is now done** (PR #71): a council's recorded decision
carries its provenance rather than a bare winner, and a vote's record keeps the node's answer *together
with the weights it was taken over*, so a reader can see what it was taken from instead of comparing it
against a tally that keeps moving.

That changes what a reader can check. It does not change what this issue is about: **whose** proposal is
the record is still convention, and nothing on chain marks one as authoritative.
