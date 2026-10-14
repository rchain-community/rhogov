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
  (secp256k1 over blake2b256 of `DeployDataProto`, as rnode verifies). You can save it as
  a password-protected keystore file (Web3 Secret Storage v3, which geth and MetaMask
  read) and bring it back from one;
- **reads** are `explore-deploy` against the newest block; **writes** are signed deploys whose
  answers come back through `deploy-status`;
- an **invite link** carries only the node URL and the three contract addresses.
- **updates**: the build also publishes `version.json` (the commit). An open page checks it
  every 5 minutes and when the tab comes back into view, and offers to reload when it
  differs. A page opened from disk skips the check.

## What you can do

- **Communities.** Start one (installs the three contracts with your key, in one deploy; Start stays disabled until your balance covers its fee, about 0.02 REV)
  or join one with an invite link. Every community is independent.
  An install that hasn't confirmed is remembered, and setup offers to look for it rather than install twice.
- **Groups.** Open or invite-only. Admins invite by address (with an inbox notification)
  and promote admins; anyone can join an open group. Anyone can ask to join an
  invite-only one: the request shows as pending, and an admin approves it in one step
  (invite, plus a trust rating, plus a council's open votes).
- **A first run that says what to do.** Home opens with what rhogov is for, and a
  community with nothing in it yet offers the first group to make rather than an
  empty "all caught up". Everything happens inside a group, so that is the first step.
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
  New arrivals raise an alert, a count on Inbox and one in the tab title (one free read
  a minute).
- **Multi-stakeholder councils**: see below.
- **Help that knows where you are.** Help in the menu explains the current screen and lists
  next steps from your state (setup, funds, name, groups, votes, inbox). **Report a problem**
  opens a GitHub issue pre-filled with your version, network, community, balance, those
  suggestions and recent errors, never your key.
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
| request to join a group | membership of the open, hidden Group `~asks:<groupId>` (the asker joins it by their own key; pending = on it, not a member, not invited) |

## Interop with quantum-os

The contracts are the ones `/gov chain` uses in a quantum-os room. Point the room at a
community's contracts (**Community → Where {name} lives, and entering contracts by hand**) with
`/gov chain inbox|group|issue <uri>`, or add a room's contracts from the same place
(**Community → Enter contract addresses by hand**).
Both then read and write the same groups, delegations, ratings and ballots.

## Networks

rhogov opens on the **Rholang playground** (`https://playground.rhobot.net`), a public
rchain-rust dev chain with a faucet. A newcomer creates a key, presses **Get test REV**,
and can start a community straight away; the newcomer test does exactly that in about
30 seconds. The public **testnet** (`https://testnet.rhobot.net`) has the same faucet (it's the one
[r-wallet](https://rhowallet.org) uses), and a **local node** or any other rnode URL can be
chosen instead.

The playground's genesis predates the master dictionary, so display names can't be
published there. rhogov detects that and keeps a **name list per community** instead:
an open group (`~names`, hidden from the group lists) whose members' labels are their
names. Each label is set by its own key (`join` is a self verb); a name belongs to its key,
so signing in with a key elsewhere brings its name back. Names are case-sensitive, never
start with a digit (addresses do), and are unique
within a community (checked by the app before it signs).

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

- **Rolls are snapshots, and the opener can change them while a vote is open.** An issue isn't
  bound to a live group instance: it carries its own list of who may vote, fixed at the moment it
  opened. The opener adds newcomers with one click ("Add N new members to the vote"). **That write
  replaces the list**, and the contract permits it right up until the vote is closed — rhogov asks
  first and says what changes, but nothing on chain prevents an opener from adding or removing voters
  after ballots exist. Those who already voted keep their ballot; a newcomer's weight is counted from
  the moment they are added. See `docs/audit/register-redteam.md` RT-02 and quantum-os#244.
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
