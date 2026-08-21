# Animacraft · Fresh Maker v8

Animacraft is the browser client and seven-package Sui contract suite for the
fresh Maker v8 product. This checkout has one product model and one chain path:

1. Core
2. Seal
3. Runtime
4. Output
5. Physical
6. Market
7. Release

Every stable object and event type is read through its role's original
TypeOrigin package. Every transaction calls that role's currently attested
callable package. The client also pins the ProductReleaseCatalog, all companion
configs and treasuries, native Mainnet USDC, per-Maker bindings, and the exact
wallet/RPC Mainnet identity before it can build a transaction.

## Browser product

The production browser exposes only fresh-v8 routes:

- `/market` — disconnected public discovery of verified `MakerV8Activated`
  Roots and typed Market listings;
- `/market/:listingId` — one exact live listing and its permitted action;
- `/maker/:rootId` — one verified Root, owned inventory, and Maker/Soul/Base
  Physical/Pack Physical actions;
- `/maker/new` — chain-attested Maker v8 document compilation and staged
  publication review.

The Market surface has fourteen typed actions: Maker and Soul
list/purchase/cancel/recover, Base and Pack Physical list/purchase, and the two
typed shared Physical cancel/recover calls. Quotes and payment use canonical
integer arithmetic. Purchases build exactly one live-wallet
`Coin<PaymentCoin>` for the stored gross amount. Receiving inputs always carry
the exact child ID, version, and digest.

The publication compiler accepts a chain-free author document and a separately
attested live context. It recomputes commitments and builds four real Sui
Transaction stages for the seven-package release. Caller-authored IDs, package
claims, hashes, or authority booleans are not trusted inputs.

## Durable execution and recovery

Before every signature, the browser refetches the wallet, Mainnet identifier,
runtime attestation, Root/listing/object refs, quote, gas, and epoch; rebuilds
the exact TransactionData with the pinned Sui SDK; and consumes a new one-shot
dry-run proof. Signed bytes, digest, signature, plan, and source fingerprint are
persisted in IndexedDB before broadcast.

Recovery always queries the saved digest first. It may replay only the same
signed bytes, never replacement-sign an ambiguous outcome. Success is accepted
only after Core V2 effects-certified finality, exact TransactionData, effects
and TransactionEvents BCS digests, historical input/output refs, typed events,
listing state, custody, counters, revenue and payout ownership all agree. A
verified record is atomically replaced by a durable receipt and monotonic
`CLEANED` tombstone so signed material does not remain in the active WAL.

Effects-certified finality is not a claim of checkpoint inclusion. A future
release may add independently bound checkpoint receipts as an auditability
enhancement.

## Safe release lock

This client-cutover phase does not deploy, publish packages, sign, broadcast,
push, or touch Mainnet. The checked-in runtime uses placeholder identities and
keeps release/signature/broadcast policy disabled. A later, separately audited
release phase must replace every placeholder with chain readback evidence,
verify the seven package digests and configs, and only then enable execution.

## Local verification

Requires Node.js 22.12+ and a compatible Sui CLI.

```bash
npm ci
npm run check
npm run move:test
npm run move:build
npm run move:probes
npm run move:size
```

`npm run check` runs the fresh client syntax suite, all fresh-v8 JavaScript
tests, and a Vite production build. The Move commands cover all seven packages,
adversarial compile probes, and bytecode size gates. Core remains at 63,918 of
the self-imposed 64,000-byte production target (82 bytes headroom).

The exact bounded acceptance contract is
[`docs/codex/CLIENT_V8_CUTOVER_SPEC.md`](docs/codex/CLIENT_V8_CUTOVER_SPEC.md).
