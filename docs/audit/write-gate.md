# Client write gate: scope and review decisions

Addresses the client side of #53 and the title-keyed lock in #65. It does not change the vendored contracts or claim the upstream electorate issue is fixed.

## Risk classification proposed for review

| Risk | Operations | Gate |
|---|---|---|
| routine | Create/join groups and councils, open votes, cast/change ballots or estimates/endorsements, add options/arguments, send messages, publish names, install/resume a community | Stable reservation; actual-term review when the preference is enabled |
| consequential | Change trust, censure, delegation, admin roles, invitations, membership, voter rolls, or a council phase; forget a local community | Confirmation required; actual-term review when enabled |
| irreversible | Close voting, record-and-close a decision, collect the live Inbox, remove the browser key, deliberately forget an unresolved install | Confirmation required; every chain signature reviewed regardless of the preference |

Local actions have no signing term; their confirmation still uses the common gate. An install already resumed by signature must not submit a new deploy. Automatic name writes are held when review is required and can be explicitly resumed from Account.

## Identity and persistence

Action identity is a tuple of normalized node URL, signing address, contract, operation and logical targets. Display names, titles and values such as a new rating or ballot never determine the lock. Creation/message forms use stable per-form IDs. Bound Gov instances supply their actual node and contract; a later community switch cannot authorize the old callback under a new community's identity.

The reservation is acquired before confirm/review. Independent targets can run concurrently; review dialogs queue instead of replacing unresolved promises. The initiating control is disabled while its gate is active. Web Locks extend the reservation to other tabs where supported.

The existing deploy builder and signing algorithm are unchanged. A callable observer carries the actual term to the review gate and records the computed signature before POST. The durable record contains only action identity, title, timestamp and signature. It never stores a private key, body or deploy term. Storage failure aborts before POST.

Unknown outcomes retain the receipt. Successful execution or an observed execution failure removes it; application-level validation may still report an error afterward. A short absence poll is not terminal evidence. Account checks existing signatures, and the setup install-resume path retains its original behavior.

## Remaining boundaries

- Client storage and Web Locks do not provide chain-level exactly-once execution across devices or after deliberate storage deletion.
- Signature status is trusted to the selected node. A dishonest node is a separate verification boundary.
- setRoll still permits its upstream operation. Confirmation is disclosure and consent, not electorate enforcement.
- Stored receipts do not reproduce the original typed application's return value after a reload; checking them refreshes chain state. Setup retains its specialized install resumption.
- The latest fixes to invite handling, name normalization and install reconciliation are preserved.

## Verification

- Offline unit/transport tests exercise identity collisions, pre-review reservation, cancellation, context mismatch, reload persistence, damaged/denied storage, before-POST durability and unknown versus terminal outcomes.
- Browser tests run the exact built file with every HTTP request intercepted. They cover review/cancel, repeat clicks, independent same-title targets, queued reviews, reload/status checking, roll-change confirmation, irreversible review and failed storage.
- No public chain, faucet, production key or installed third-party community is used by these regressions.
