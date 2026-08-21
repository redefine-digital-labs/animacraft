# Fresh Maker v8 Client Cutover

## Phase boundary

This phase replaces the public client with one fresh-v8 product path. It does
not publish packages, deploy a site, sign or broadcast a transaction, or touch
Mainnet. All executable builders are verified against local fixtures and the
checked-in Move source.

The client recognizes only the seven-role release tuple:

1. Core
2. Seal
3. Runtime
4. Output
5. Physical
6. Market
7. Release

Each role has one stable TypeOrigin and one current callable package. The
client pins the ProductReleaseCatalog, protocol objects, role configs, payment
coin, and the exact per-Maker capability objects read from a live Root. It
never derives authority from a caller-supplied role name, source flag, object
ID, digest, or local boolean.

## Single product path

- The browser bundle, runtime config, routes, scripts, docs, and tests contain
  no v4-v7 compatibility, migration, fallback, or dual-read product path.
- A legacy object, cache record, deep link, or document is reported as
  `UNSUPPORTED_LEGACY_PRODUCT`; it is never migrated into v8.
- Initial Maker publication starts with no embedded Pack Release. Packs and
  Pack Physical policies are mutable post-activation v8 operations.
- Core remains unchanged. Its recorded size gate is 63,918 / 64,000 bytes.

## Compiler contract

`compileMakerV8Publication(document, trustedContext)` accepts an exact
chain-free author document and a separate trusted context containing certified
transport bytes and live release bindings. It:

- rejects compiler-owned IDs, package fields, commitments, signatures, and
  transaction evidence in the author document;
- projects public rows only, then revalidates references and the default
  recipe;
- recomputes certified file hashes and all locally-computable BCS commitments;
- emits the current seven-package call graph, never the retired monolithic
  `publication_v8` / `composition_v8` / `complete_v8` graph;
- creates empty mutable Pack and Market state at activation;
- emits bounded, resumable stages with exact targets, type arguments, input
  roles, counters, and readback assertions.

## Typed Market contract

There are four static lanes and fourteen callable actions:

| Lane | List | Purchase | Cancel | Recover |
| --- | --- | --- | --- | --- |
| Maker control | yes | yes | yes | yes |
| Soul bundle | yes | yes | yes | yes |
| Base Physical | yes | yes | shared typed Physical | shared typed Physical |
| Pack Physical | yes | yes | shared typed Physical | shared typed Physical |

Maker, Soul, and Physical custody uses the exact `Receiving<T>` object
reference (ID, version, digest). A Soul operation always carries all three
children. Base and Pack Physical list/purchase targets are statically distinct.

Quotes preserve u64/u128 values as `bigint` or canonical decimal strings. The
client recomputes the Market quote commitment from verified live Root terms,
shows gross/protocol/creator/source/seller amounts, and uses the Sui SDK's
live-wallet `CoinWithBalance` resolver to merge/split exactly one
`Coin<PaymentCoin>` whose value equals the listing gross. Callers cannot inject
a payment object ID or amount. It forces quote review
again after any Root, listing, wallet, revision, epoch, or commitment drift.

## Status, errors, and recovery

Visible transaction state is:

`READING -> QUOTING -> READY -> AWAITING_SIGNATURE -> SIGNED_DURABLE -> BROADCASTING -> OUTCOME_PENDING -> VERIFIED | FINALIZED_FAILURE`.

Errors retain one layer: local schema/config, stale context, eligibility,
custody/authority, quote/payment, dry-run Move abort, wallet, durable storage,
submission ambiguity, finalized execution, or readback/indexing mismatch.

Signed bytes, signature, and digest are persisted before broadcast. Reload and
retry query the digest first and may replay only those identical bytes. An
ambiguous outcome never permits replacement signing. Success needs exact
effects, event, terminal listing fields, custody ownership, and epoch readback;
RPC success alone is insufficient.

On-chain escape routes mirror Move exactly:

- a healthy PAUSED Maker listing may be purchased or seller-canceled, but not
  permissionlessly recovered;
- Maker recovery requires ARCHIVED or degraded protocol state;
- Soul and Physical recovery permits PAUSED, ARCHIVED, or degraded protocol;
- seller cancellation remains available independently of protocol health.

## Verification gates

- checked-in normalized ABI/object/event/quote fixtures;
- compiler commitment and seven-package call-plan fixtures;
- positive and adversarial tests for every Market action and recovery crash
  boundary;
- fresh-only route, import, config, and source scans;
- all seven Move test suites, adversarial runners, and bytecode size gates;
- two independent P0/P1 audits with every finding closed before commit.
