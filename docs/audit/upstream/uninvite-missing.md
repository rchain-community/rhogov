# Draft upstream issue — an invitation cannot be withdrawn, and the invited address is public

**Target:** quantum-os (vendored here as `src/chain/rgov-core.js`; see `CLAUDE.md:44-47`)
**Status:** **filed** — [quantum-os#246](https://github.com/rhovision-org/quantum-os/issues/246).
**Found by:** the red-team tabletop, scenario T5-adjacent (boundary TB4/TB6).

## What the contract does

`invite` (`rgov-core.js:477-487`) is admin-gated and records the address in the group's public
`invited` set:

```rholang
true => state!(s.set(gid, g.set("invited", g.getOrElse("invited", {}).set(addr, true)))) | ...
```

The set only ever shrinks when the invitee **joins** (`:460-464` deletes them from `invited`).

Grep of every verb defined in the contract — `addOption adminsOf ballotsOf cast censure
censuresOf close countIn create delegate delegationsOf dump enroll export grantRead grantSend
groupOf groups guestsOf import invite invitedOf issueOf issues issuesOf join leave load
lockersOf membersOf modeOf newLocker open optionsOf policyOf propose rate ratingsOf receive
resultsOf roll send setPolicy setRole setRoll statusOf take typesIn uncensure undelegate version
votersOf vouchersOf` — finds **no `uninvite`**. `uncensure` and `undelegate` exist; the
invitation has no counterpart.

`invitedOf` is a public read (`:615`), and the app renders it: *"Invited, not joined yet:
{addresses}"* (`src/ui/groups.tsx:252`).

## Why it matters

An admin who invites the wrong address — or whose invitee declines, loses their key, or was never
real — leaves that address published in the group's state **permanently**, unless the address
itself chooses to join. The app offers no way to remove it, and the contract has no verb for it.

The contract's own design comment defends public invitations — *"an invitation anyone can read is
one anyone can verify"* (`:474-476`) — which is a reasonable stance for the *invitee* to verify
their own invitation. It does not follow that a *declined or mistaken* invitation must remain
published forever with no remedy.

## What we would want

An `uninvite(gid, addr)` verb, admin-gated, deleting the entry from `invited` — the mirror of
`invite`, as `uncensure` mirrors `censure` and `undelegate` mirrors `delegate`.

## Client-side note

Whatever the contract does, a UI that renders a permanently-published address with no way to
withdraw it should say so at the moment of inviting. **That disclosure is now in place** (PR #66): the
invite modal says the address is written into the group's public state, cannot be withdrawn, and stays
there until they join.

It is a warning, not a remedy. The remedy is the verb this issue asks for, and until it exists a
mistaken or declined invitation stays published.
