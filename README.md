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

The durable WAL lives in the fresh database
`animacraft-fresh-maker-v8-recovery-v2` (schema version 1). The client never
opens or migrates the similarly named pre-release development cache: its
signature and broadcast gates were never enabled, so it is not a supported
source of signed authority.

Recovery always queries the saved digest first. It may replay only the same
signed bytes, never replacement-sign an ambiguous outcome. Success is accepted
only after Core V2 effects-certified finality, exact TransactionData, effects
and TransactionEvents BCS digests, historical input/output refs, typed events,
listing state, custody, counters, revenue and payout ownership all agree. A
verified record is atomically replaced by a durable receipt and monotonic
`CLEANED` tombstone so signed material does not remain in the active WAL.
An expired absent transaction can release its Root only after two typed
digest queries bracket an exact Mainnet checkpoint watermark and both remain
absent; transport errors and message-string matches are never absence proof.

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

The protected-content browser path has no owned rendering/key proxy and needs
no private server environment key. Runtime configuration remains public in
`public-v8/config.js`; every protected operation still attests chain policy.
The currently deployed credential-requiring Seal committee is not usable by
this no-secret path. The fresh release entry now requires the pinned Overclock
and Studio Mirai independent servers (weight 1 each, threshold 2), before prepare,
publication signatures and setup. It checks raw on-chain identity, SDK PoP,
both sites' service/POST CORS and browser-visible service version headers.
Run `node scripts/probe-browser-seal-topology.mjs` for the read-only endpoint
checks. Either provider being unavailable blocks this two-of-two topology;
there is no automatic provider/threshold fallback. A full fresh policy release
and real wallet-authorized decryption acceptance remain required; prerequisite
checks alone do not satisfy that acceptance.

Every `npm run build` checks browser source, imported application modules and
emitted assets for the retired protected APIs, Node crypto and server-only
credentials/aggregator adapter. The same guard can be rerun without building:

```bash
node scripts/browser-backend-retirement-guard.mjs --source
node scripts/browser-backend-retirement-guard.mjs --dist dist
```

The guard excludes historical documents, test fixtures and release tooling.
No live credentials or chain configuration are removed by it.

Requires Node.js 22.12+ and the approved Sui1.80.1-671ba71e69c7 CLI.

```bash
npm ci
npm run check
npm run move:release-gates -- --soulidity-root /path/to/reviewed/soulidity --sui /path/to/approved/sui
ANIMACRAFT_SUI_BINARY=/path/to/approved/sui npm run move:seal-cap:quick
```

`npm run check` runs the fresh client syntax suite, all fresh-v8 JavaScript
tests, and a Vite production build. The release command snapshots the reviewed
Animacraft/Soulidity pair once and runs all eight package suites, joint acceptance,
build, seven adversarial groups, forced disassembly, package budgets and eight-package
field limits. Component commands (move:test/build/probes/size/field-limits) use this
same paired runner and require the same explicit peer root and approved CLI arguments;
they are scoped diagnostics, not a complete release pass. No historical checkout fallback.

Core's current certified no-growth ceiling is97,740 bytes, with4,660 bytes to the
Protocol137 hard ceiling102,400. This explicitly supersedes the old64,000-byte
candidate target; it does not claim that target passed. See
docs/codex/PROTOCOL_137_SPEC.md. The independent seal-cap quick gate authenticates
the CLI and reproduces the original-address bytecode certificate. On Linux x64,
also set ANIMACRAFT_SUI_ARCHIVE to the downloaded official Ubuntu archive; the gate
verifies its pinned digest and extracted executable against the actual CLI. CI
requires exact peer commit variables and preserves both quick and graph evidence.

The exact bounded acceptance contract is
[`docs/codex/CLIENT_V8_CUTOVER_SPEC.md`](docs/codex/CLIENT_V8_CUTOVER_SPEC.md).
