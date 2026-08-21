# Animacraft Maker v8 Output

Fresh v8-only Complete and Canonical Soul companion. It depends only on the
v8 Core, Seal, and Runtime packages and has no migration or legacy surface.

The shared `OutputRegistryV8` begins in DRAFT with an expected output-row count
and final commitment. `append_output_policy_v8` accepts `complete.outputs[]`
rows in strict sequence, rejects duplicate `output_key` values, verifies each
row commitment, and advances a domain-separated rolling commitment. A sealed
row freezes the output key, protected route/scope, renderer-schema commitment,
and exactly one Pack policy: `ALL_ADMITTED`, or a strictly sorted duplicate-free
allowlist of semantic Pack IDs. Player Pack selections are never frozen in the
author policy. The chain registry deliberately supports a domain-separated
zero-row seal/readiness boundary; the v8 author compiler requires at least one
output.

Every Pack counter mutation consumes a fresh Core `OutputRuntimeRequestV8`
created with the private Output call cap. A no-ability Complete session retains
Runtime authorization until finish; only then are the settled Pack lines
compared with Runtime's derived ordered unique used-Pack set. Missing,
duplicate, or reordered lines abort the PTB, atomically rolling back counters
and payments.

Every Complete explicitly chooses an `output_key` and rereads its immutable
sealed row. `CompleteOutputV8` and `CompleteReceiptV8` retain both immutable
`original_holder` and mutable current `holder`; their content commitments bind
the original holder, so later custody and sale cannot invalidate content or
the Output/Receipt-ID-based protection binding. Recipe/render/output/receipt/Soul commitments bind that key, row
commitment, per-output renderer schema, immutable Maker version/content, exact
current loadout authorization, ordered selection/pricing commitments, and
Runtime-derived used Packs. Base primary protocol share, Maker residual, every
Pack protocol/Pack split, and Core's fixed Complete fee are distinct exact
payment lines; the fixed fee always enters `ProtocolTreasuryV8`.

Protected Complete first creates no-ability pending artifacts. Release
certifies and registers the exact ciphertext instance through Seal, then
Output consumes Seal's live `CompleteDecryptProofV8` and exact-matches receipt
ID, output ID, recipe, render, output, receipt, scope key, asset key, and Seal
ID before mint authorization exists.

`CompleteOutputV8`, `CompleteReceiptV8`, and `CanonicalSoulV8` have `key` only.
Output exposes no ordinary holder transfer or public receive path. The sole
resale path is `custody_soul_bundle_for_market_v8`, followed by exact
`Receiving<T>` return or purchase. Custody atomically object-owns all three
objects under the Listing UID without changing logical ownership. The
no-copy/no-drop/no-store `SoulMarketCustodyTicketV8` is consumed in the same
PTB into a private-field `SoulMarketCustodyBindingV8`; that persistable binding
is listing data, never authority. Every hook additionally requires the exact
Market call cap, Market original/callable TypeOrigins, concrete Market
registry/treasury TypeOrigins and capability-bound IDs, and the Root-frozen
catalog/product/call-cap set.

`return_soul_bundle_from_market_v8` deliberately omits ACTIVE and live protocol
config checks, so cancel/recover remains available while the Root is PAUSED or
ARCHIVED and while protocol configuration is disabled or has drifted. It
returns the unchanged bundle to the seller recorded by Output at custody.
`purchase_soul_bundle_from_market_v8` instead requires ACTIVE plus the exact
current protocol/catalog and registries; it receives and validates all three
objects, changes all current holders, advances Soul ownership epoch exactly
once, updates Output/Soul registry records, recomputes only the Soul ownership
commitment, and transfers the complete bundle to a non-seller buyer.

Physical materialization consumes Runtime's no-ability exact current-selection
witness against the live loadout, including its exact Part, Item, Style, and
Layer Track semantic keys, then exact-matches a live Complete receipt,
Canonical Soul, Root, holder, output policy row, registry records, and a unique
Soul-scoped materialization key. Those keys are included in the Output witness
commitment and exposed only through the typed `PhysicalSelectionBindingV8`.
The `PhysicalMaterializationWitnessV8` has no abilities and can only be consumed
by a caller borrowing Core's concrete Physical call cap with the catalog-frozen
Physical TypeOrigin.

The adversarial runner includes independent compile-failure packages for
Market ticket copy/drop/store, binding/ticket forgery, external receive, and
ticket replay, in addition to the existing Output gates. The positive companion
probe compiles all custody, consume, return, purchase, and readback signatures.
