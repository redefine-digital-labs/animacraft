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
sealed row. Recipe/render/output/receipt/Soul commitments bind that key, row
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

`CanonicalSoulV8` has `key` only. Output exposes no ordinary holder transfer.
The later Market package may add the sole Output-owned transfer path, guarded
by the concrete Market call cap and expected ownership-epoch CAS.

Physical materialization consumes Runtime's no-ability exact current-selection
witness against the live loadout, including its exact Part, Item, Style, and
Layer Track semantic keys, then exact-matches a live Complete receipt,
Canonical Soul, Root, holder, output policy row, registry records, and a unique
Soul-scoped materialization key. Those keys are included in the Output witness
commitment and exposed only through the typed `PhysicalSelectionBindingV8`.
The `PhysicalMaterializationWitnessV8` has no abilities and can only be consumed
by a caller borrowing Core's concrete Physical call cap with the catalog-frozen
Physical TypeOrigin.
