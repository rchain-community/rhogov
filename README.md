# rhogov

**[User guide →](docs/user-guide.md)** · **[Open the app →](https://rchain-community.github.io/rhogov/)**

**Decide things together on RChain.** An intuitive governance app for the
[rchain-rust](https://github.com/rchain-community/rchain-rust) node: groups, liquid
democracy, a web of trust with accountability, multi-stakeholder councils, and inboxes,
all on chain.

rhogov is the successor UI to [rgov](https://github.com/rchain-community/rgov). It doesn't
run rgov's 2021 contracts. It uses the governance that rchain-rust and
[quantum-os](https://github.com/rchain-community/quantum-os) now provide:

| piece | where it comes from | what it does |
|---|---|---|
| **Inbox, Group, Issue contracts** | quantum-os [`rgov-core.js`](https://github.com/rchain-community/quantum-os/blob/main/RGov_Core.md) (vendored at [`src/chain/rgov-core.js`](src/chain/rgov-core.js)) | hold the facts: members, roles, delegations, trust ratings, censures, ballots, messages |
| **`rho:gov:trustLevels`, `:censure`, `:resolveWeights`, `:tally`** | rchain-rust native system processes ([`qucalc`](https://github.com/rchain-community/rchain-rust/tree/dev/docs/src/qucalc)) | compute policy: trust levels, discrediting, liquid-democracy weights, the winner |
| **master dictionary** | rchain-rust genesis ([issue #99](https://github.com/rchain-community/rchain-rust/issues/99)) | display names rooted in your own address (`<addr>/profile/name`) |

**State lives in contracts, computation is native, and no policy lives in a contract.**
Every number rhogov shows about standing or outcome comes from one read-only query that
the node evaluates with its own natives. Anyone can re-run that query and must get the
same answer.

## Serverless

The build is **one self-contained `index.html`** (~230 KB, ~73 KB gzipped). It needs no web
server of its own: open it from disk, IPFS, GitHub Pages or any static host. Its only
network peer is the **rnode HTTP API** you point it at, which answers CORS with `*`. There is
no backend, no relay, no database and no account:

- your **key** is generated in, and never leaves, the browser; it signs deploys locally
  (secp256k1 over blake2b256 of `DeployDataProto`, as rnode verifies);
- **reads** are `explore-deploy` against the newest block; **writes** are signed deploys whose
  answers come back through `deploy-status`;
- an **invite link** carries only the node URL and the three contract addresses.

## What you can do

- **Communities.** Start one (installs the three contracts with your key, in three blocks)
  or join one with an invite link. Every community is independent.
- **Groups.** Open or invite-only. Admins invite by address (with an inbox notification)
  and promote admins; anyone can join an open group.
- **Votes.** Approval or ranked choice (instant runoff). Re-vote any time while it's open.
  The opener closes it and records the result, and the page shows whether the recorded
  result **matches the node's tally**.
- **Liquid democracy.** Delegate your vote, for all votes or just one. It flows
  transitively, voting yourself always overrides it, and loops abstain.
- **Web of trust.** Admins start at level 5. A rating can confer at most one level below
  your own, so two strangers can't vouch each other up. Each vote weighs `1 + level`, or
  1 for everyone until anyone rates anyone.
- **Censure.** When ⅔ (and at least two) of the members at or above someone's level
  censure them, their trust drops to 0 and their vouchers are slashed by what they staked.
- **Inbox.** Anyone can message anyone; the sender is stamped on chain from the key, so it
  can't be forged. Counts are public and contents are not served by the read API.
  **Collect** consumes the messages into this browser. Messages are not encrypted.
- **Multi-stakeholder councils**: see below.
- **Review before signing.** An Account setting shows the exact rholang before each signature.

### Multi-stakeholder councils

Built from rchain-rust's
[multi-stakeholder governance](https://github.com/rchain-community/rchain-rust/blob/dev/docs/src/qucalc/multi-stakeholder-governance.md)
design:

- **Stakeholder groups.** Users, Developers, Validators, Token holders, Service providers,
  Governance stewards, or your own. Each is a full group with its own admins, trust,
  delegation and censure. People join every group that describes them.
- **Voting power** per stakeholder group is the **median of participants' estimates**
  (each estimate normalised to 100%), so a few extreme estimates can't swing it. The design
  doc's footnote [c], that validators should weigh more, is decided here by the participants.
- **A facilitated, phased process:** *Prepare* (question, background, options) →
  *Deliberate* (pros and cons per option, with endorsements, ConsiderIt-style) →
  *Decide* (approval vote) → *Record & follow up* (outcome, rationale, action items, and the
  dissent against the outcome).
- **Stakeholder-weighted tally.** Within each group, the node weighs that group's members'
  ballots with that group's trust and delegation and names the group's choice
  (`rho:gov:*`). Across groups, the score is Σ voting power × the group's weighted approval
  share. A group that didn't vote adds nothing; its power isn't handed to the others.

Councils need no extra contract. They are conventions over the same three contracts, so
any rgov-core client can read them:

| | stored as |
|---|---|
| council | Group `council-<slug>` |
| stakeholder group | Group `<councilId>.<slug>` |
| voting-power estimates | Issue `<councilId>.weights` (mode `estimate`; a ballot is `["<groupId>=<percent>", …]`; its title is the council's purpose) |
| decision | Issue in the council (mode `approval`) |
| pros and cons | Issue `<decisionId>.args` (options are `pro\|<option>\|<text>`; ballots are endorsements; its title is the background) |
| phase and decision of record | the facilitator's entry in the decision's `results` |

## Interop with quantum-os

The contracts are the ones `/gov chain` uses in a quantum-os room. Point the room at a
community's contracts (**Community → Where it lives**) with `/gov chain inbox|group|issue
<uri>`, or add a room's contracts here (**Community → Enter contract addresses by hand**).
Both then read and write the same groups, delegations, ratings and ballots.

## Networks

rhogov opens on the **Rholang playground** (`https://playground.rhobot.net`), a public
rchain-rust dev chain with a faucet. A newcomer creates a key, presses **Get test REV**,
and can start a community straight away; the newcomer test does exactly that in about
30 seconds. The public **testnet** (`https://testnet.rhobot.net`, funded keys only), a
**local node**, or any other rnode URL can be chosen instead.

The playground's genesis predates the master dictionary, so display names can't be
published there. rhogov detects that and falls back to the names people give when
joining a group; a group's creator shows as a short address.

## Run it

```sh
npm install
npm run dev          # http://localhost:5180, against any rnode
npm run build        # dist/index.html, the whole app in one file
```

You need an rnode with its HTTP API reachable from the browser: `--api-host`, port 40403.
Built and tested against **rchain-rust `dev` @ `bc80abb`**. An older build (for example
quantum-os's bundled `bin/rnode`) answers registry lookups in the pre-C18 `(uri, value)`
shape and doesn't match map patterns with a remainder, so the contracts report "no facet".

For a local chain with funded throwaway keys, use quantum-os
`scripts/localnet/run-node.sh --fresh` with `RNODE=` pointing at a current rchain-rust build.
Its keys (`alice`, `bob`, `carol`, `dave` in `pk.txt`) are funded at genesis and **worthless
anywhere else**.

## Tests

```sh
npm test                              # rgov-core selftest (91 checks) + unit tests
npm run test:chain                    # the Gov API against a live node (25 checks)
npm run build && npm run test:e2e     # the built file:// app in Chromium, 2–3 people at once
RHOGOV_NODE=https://playground.rhobot.net npm run test:e2e -- newcomer   # fresh key + faucet
```

`test:chain` and `test:e2e` need a node at `RHOGOV_NODE`
(default `http://127.0.0.1:40403`) with the localnet keys funded; the playground funds
them too (`tests/chain-check.ts --node https://playground.rhobot.net`). Behind an
intercepting proxy, set `RHOGOV_PROXY=1` for the browser tests and
`NODE_USE_ENV_PROXY=1` for the Node ones.

## Layout

```
src/chain/   keys.ts (identity, signing)   node.ts (rnode HTTP, value decoding)
             gov.ts (typed RGov API + the standing/outcome query)
             council.ts (multi-stakeholder conventions + combination)
             profile.ts (names in the master dictionary)   rgov-core.js (vendored)
src/ui/      setup, home, groups, votes, council, inbox, settings, kit (shared widgets)
tests/       chain-check.ts (live API)   unit.ts   e2e/ (Playwright)
```

## Known limits

- **Rolls are snapshots.** An issue's voter roll is fixed when it opens, and the opener
  adds newcomers with one click ("Add N new members to the roll"). That's the contract's
  deliberate design: an issue isn't bound to a live group instance.
- **A group's creator is labelled with the group's name** by the Group contract. rhogov
  shows dictionary names instead, which is why your name is published once on first use.
- **Ballots are public.** That's on purpose: it's what makes the tally verifiable.
- **The phase of a council decision is advisory.** The facilitator records it, and the Issue
  contract itself only knows open, locked and closed.
- **Reads use the newest block**, not the last finalized one, so you see your own vote
  immediately; on a multi-validator net a very recent block can still be orphaned.

## License

[Apache-2.0](LICENSE). `src/chain/rgov-core.js` is vendored from quantum-os, also under
Apache-2.0.
