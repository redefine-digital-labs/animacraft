# Animacraft v8 companion interface and package budget

Status: implementation contract for the fresh `animacraft_v8` TypeOrigin.
This document describes v8 only. It does not define a migration, bridge, or
read path for `OCMaker`, `MakerRootV5`, Composition v6, Physical v7, or the old
Expansion Pack v8 TypeOrigin.

## Package layout

The default publication unit is one package and one public protocol version:

```text
animacraft_v8
  protocol_config_v8
  maker_v8
  composition_v8
  expansion_pack_v8
  complete_v8
  seal_v8
  soul_v8
  publication_v8
  physical_v8
```

`publication_v8` is the dependency-top orchestrator. `maker_v8` must not
import a companion module. Each companion imports `maker_v8`, and
`publication_v8` imports both sides, validates every registry, then calls the
package-only `maker_v8::activate_checked_v8`. This direction prevents a Move
module dependency cycle while keeping activation in one transaction.

The final measured package keeps Physical and Canonical Soul in the same
TypeOrigin. There is no split-package witness ABI in this build. Public
Physical activation requires the concrete
`animacraft_v8::physical_v8::PhysicalRegistryV8`, and Soul minting requires the
private-field, no-ability proof created by this package's `complete_v8`.

## Required core ABI

Companions require these exact core types and functions:

```move
animacraft_v8::maker_v8::MakerRootV8<phantom PaymentCoin>
animacraft_v8::maker_v8::MakerAdminCapV8
animacraft_v8::maker_v8::MakerTreasuryV8<phantom PaymentCoin>

maker_v8::root_id_v8<PaymentCoin>(&MakerRootV8<PaymentCoin>): ID
maker_v8::ownership_epoch_v8<PaymentCoin>(&MakerRootV8<PaymentCoin>): u64
maker_v8::content_commitment_v8<PaymentCoin>(
    &MakerRootV8<PaymentCoin>,
): &vector<u8>
maker_v8::admin_cap_id_v8(&MakerAdminCapV8): ID
maker_v8::assert_draft_admin_v8<PaymentCoin>(
    &MakerRootV8<PaymentCoin>,
    &MakerAdminCapV8,
)
```

The final core API must additionally do all of the following:

- compare each companion registry ID, count where applicable, and final commitment with the
  values committed by the Root;
- accept registry readiness only from `publication_v8`, while the Root is
  `DRAFT` and at the same ownership epoch;
- change `DRAFT -> ACTIVE` only after all required readiness checks succeed;
- emit `MakerV8Activated` only after that state change;
- reject a second activation and every stale-epoch registry;
- keep the Root content commitment immutable for the life of the Root.

The Root content commitment is 32 bytes. Every registry stores a copy of that
commitment alongside the Root ID and ownership epoch. Matching only the Root
ID is insufficient.

## Registry contract

Composition, Pack, Complete, Seal, Canonical Soul, and optionally Physical expose one shared per-Maker
registry, including for a zero-row category. Every registry stores:

- `version = 8`;
- `maker_root_id`;
- `ownership_epoch`;
- `root_content_commitment`;
- category-specific expected and observed counts;
- aggregate `expected_count` and `observed_count`;
- `expected_commitment` and the on-chain `rolling_commitment`;
- `sealed`.

An append must:

1. call `maker_v8::assert_draft_admin_v8`;
2. verify the exact Root ID, ownership epoch, and content commitment;
3. require `sequence == observed_count`;
4. reject duplicate canonical keys and out-of-order row kinds;
5. enforce bounded strings and vectors before storage;
6. calculate the next commitment on-chain as SHA-256 over a domain-separated
   BCS row containing version, the immutable nonrecursive Root content
   commitment, sequence, prior commitment, and all semantic row fields;
7. increment exactly one category count and the aggregate count.

The empty rolling commitment is itself domain-separated and 32 bytes. An
empty registry is never represented by an empty vector or a missing object.
Neither an expected empty commitment nor any row commitment may include a
newly generated Root, registry, release, treasury, or cap object ID, nor an
ownership epoch. Those values are independently and strictly checked by the
registry's state-binding assertions. This separation makes every expected
commitment computable before the publication transaction and avoids an
object-ID derivation cycle. The Root content commitment must itself be a
nonrecursive immutable manifest commitment; it must not include a derived
registry commitment or Seal ID that already uses it as a domain separator.

Each registry module exposes public pure `empty_*_commitment_v8` and
`advance_*_commitment_v8` helpers. Append functions call those exact helpers,
so client precomputation and on-chain chaining cannot silently diverge.

Sealing checks every category count, aggregate count, and the expected final
commitment. It is irreversible. Registry readiness is package-only and returns
the exact typed registry ID, commitment, and its category counts. Pack and
Complete additionally return the protected-source count used in the exact
Seal equality. Soul returns its typed registry ID and stable commitment.

```move
public(package) fun assert_activation_ready_v8<PaymentCoin>(...)
```

Every form checks version, Root tuple, counts, commitment, and sealed/readiness
state before returning values to the orchestrator.

## Core row shape

The Root dynamic fields match the external Creator compiler:

- Track has no inferred `required` property.
- Part has no inferred Track parent.
- Style binds the exact `layer_track_key` and an optional paired
  `color_channel_key`/`default_swatch_key`. The Track is checked on append and
  activation enumerates every Style to prove any default swatch exists.
- `payload_commitment` and the immutable Root content commitment cover rich
  gradients, rules, and the remaining canonical manifest payload.

Public limit getters return 128 key bytes, 256 label bytes, and 512 Blob ID
bytes so the off-chain compiler enforces the same bounds before signing.

## Composition semantics

The immutable registry contains canonical wardrobe slots, Item identities,
and loadout rules. A slot defines behavior, capacity, and whether it is
required. An Item binds one slot and one exact content commitment. Rules are
ordered require/exclude constraints over canonical Item identities.

Runtime loadouts are separate wallet-owned objects. A loadout binds the same
Root ID/epoch/content tuple, stores a monotonic revision, and uses revision CAS
for every change. It does not claim Soul ownership from a caller-supplied ID;
a Soul integration must provide its own unforgeable owner witness.

If the Root ownership epoch changes, the old loadout is stale. Recovery is
fail-closed: remove selections one slot at a time, prove the loadout is empty,
then rebind it to the current epoch. A stale non-empty loadout is never
silently carried across ownership.

## Pack semantics

The per-Maker Pack registry commits the exact set of releases present at Root
activation. It is immutable after sealing. Adding a release later requires a
new `MakerRootV8` lineage version; mutating the registry would invalidate the
Root content commitment.

Each `ExpansionPackReleaseV8<PaymentCoin>` is independently scoped and owns:

- its own `ExpansionPackAdminCapV8` and
  `ExpansionPackTreasuryV8<PaymentCoin>`;
- the exact Root ID/epoch/content tuple;
- immutable manifest and release commitments;
- ordered Style rows and a final Style-registry commitment;
- access `FREE` with price exactly zero, `PAID` with price greater than zero,
  or `INCLUDED_WITH_MAKER` with zero Pack purchase price and a runtime check
  of the Root's current Maker entitlement;
- an independent Complete policy using one of the four Root Complete modes,
  with its own price, per-wallet free quota, and total cap;
- lifecycle `DRAFT -> SEALED -> ACTIVE <-> PAUSED -> ARCHIVED`;
- exact entitlement records and immutable wallet Passes;
- explicit Seal policy commitment and protected-asset count.

Style rows cannot change after release seal. A Pass binds release ID, Root
tuple, release content commitment, holder, payment amount, and issue time.
Root epoch drift suspends access. Re-admission at a new epoch requires both the
current Maker authority and the exact Pack authority; existing entitlements
may survive but cannot authorize access until re-admission completes.
Pack creator provenance is immutable, while current Pack control is
explicitly transferable by consuming and reissuing the exact Pack AdminCap.
The transfer path does not require a Maker cap, so after a Root transfer the
old Pack owner can hand the cap to the new Root owner, who can then satisfy
the two-authority epoch readmission without a cross-sender deadlock.

## Seal and Complete semantics

The Seal registry maps a domain (`MAKER_STYLE`, `PACK_STYLE`, or `COMPLETE`),
stable scope key, 32-byte scope commitment, asset key, and asset commitment to
a derived 32-byte Seal ID. The Seal ID and Seal row commitment contain no
object ID or ownership epoch. Pack scope keys are the canonical
`namespace + 0x00 + pack_key` encoding and use the release content commitment;
Complete uses the output key and Recipe commitment; base Maker Style uses the
constant `maker` scope and Root content commitment. Components containing the
separator byte are rejected. A protected Pack or Complete row must prove exact
registry coverage when appended. Free, unprotected content records
`protected = false` and an empty Seal ID; this is an explicit policy, not a
missing policy.

Pack and Complete registries independently accumulate their protected row
counts. Activation requires exact equality between Seal rows and the sum of
protected base Maker Styles, protected Pack Styles, and protected Complete
outputs. The publication orchestrator also enumerates every bounded protected
base Style and verifies its precise Seal row, preventing an unrelated extra
Seal row from substituting for missing coverage.

Complete output policy rows are immutable publication data. Their
`recipe_policy_commitment` and `renderer_schema_commitment` are authoring
policy/schema commitments, not a frozen player Recipe or render. After the
exact loadout and ordered Pack selections are present, sealing derives:

- canonical Recipe = SHA-256 over the v8 Recipe domain, Root content,
  authoring Recipe policy, exact loadout commitment, exact ordered Pack
  selection commitment, and output key;
- canonical render = SHA-256 over the v8 render domain, Root content, renderer
  schema, the derived canonical Recipe, and output key.

A runtime Complete authorization has no `store`, `copy`, or `drop` ability.
It binds the Root tuple, loadout object/revision/commitment, those derived
instance commitments, the exact ordered count and stable commitment of
required Pack selections, and Seal coverage. Stable Pack-selection rows bind
Pack scope, release content, Style keys/content, protection policy, and Seal
ID, but not a release object ID. Runtime proofs additionally bind and validate
the real release ID and Root epoch. Authorization sealing rejects missing,
extra, reordered, or duplicate stable Style identities. Only consuming that
one-use authorization may create an immutable `CompleteReceiptV8`.

Base Maker Complete and every registered Pack policy natively use exactly one
mode: `UNLIMITED_FREE`, `FREE_QUOTA_THEN_PAID`, `PAID_EVERY_TIME`, or
`FREE_QUOTA_THEN_BLOCK`. `CompleteRegistryV8` stores the base wallet/total and
per-Pack wallet/total counters. Authorization records the exact pre-state and
consumption rechecks every counter before incrementing all of them atomically.
The paid route requires the exact base-plus-unique-Pack content subtotal. The
protocol receives its fixed Complete fee plus the primary content BPS share;
the remainder goes to `MakerTreasuryV8`. `ExpansionPackTreasuryV8` receives
only Pack access-purchase revenue.

The immutable protocol snapshot commits and exposes all four commercial
terms: primary content fee 1,000 BPS, fixed Complete fee 0 atomic units, Maker
market fee 250 BPS, and Soul market fee 250 BPS. Market execution is outside
this package, but its Maker/Soul fee tuple is not omitted from v8 state.
Rights validation enforces each royalty at 0..1,000 BPS in 50-BPS steps and
Soul-creator plus Maker-source at no more than 1,000 BPS.

## Canonical Soul semantics

Canonical Soul is a required native v8 capability (`32`). Protocol required
capabilities are `47`; Physical remains the only optional bit. Every Root
precommits `soul_v8::registry_commitment_v8(root_content_commitment)` and
`begin_maker_v8` creates the concrete `SoulRegistryV8` in the same transaction.
Activation, resume, and ownership transfer validate or rebind its exact Root
ID, epoch, content commitment, registry ID, and stable commitment.

Successful `complete_v8` transfers its immutable receipt and returns a
`SoulMintAuthorizationV8` with no `store`, `copy`, or `drop` ability. Its
private fields are copied from the exact receipt: Complete registry/receipt
IDs, Root ID/epoch/content, holder, output key, Recipe, render, Complete
authorization commitment, and completion time. It therefore must be consumed
in the same PTB by `soul_v8::mint_canonical_soul_v8`.

Soul minting requires the Root to remain ACTIVE, checks that the Complete
registry is the one frozen into the Root, checks every proof field and sender,
and records the receipt ID before transferring a non-generically-transferable
`CanonicalSoulV8` to the holder. Pause, archive, epoch drift, content drift,
wrong holder, forged TypeOrigin, and receipt replay fail closed.

## Physical typed binding

Physical fits in the final core package. A declared Physical Root precommits
the exact policy count and commitment. The typed activation overload accepts
only this package's concrete `PhysicalRegistryV8`; a compile-fail probe proves
that an identically named foreign type cannot satisfy the call. No generic or
caller-supplied binding witness exists.

Maker policies bind an existing base Style. Pack policies additionally take
the exact `ExpansionPackRegistryV8` and prove the sealed release has already
been registered, preventing orphan Pack releases from entering Physical.
Runtime assets bind registry ID, Root ID, epoch, content, Style and material
commitments, supply serial, holder, and transfer policy. Materialize, transfer,
consume, and explicit epoch recovery are module-mediated.

## Recovery boundary

On-chain staging is forward-only and queryable. Recovery resumes from the
registry's exact observed sequence and rolling commitment. A commitment chain
cannot be rolled back without storing every predecessor, so v8 does not offer
an unsafe hash reset.

If the source snapshot changes or a signed stage becomes terminal, the creator
may archive the DRAFT Root. No activation/discovery event is emitted,
and a fresh Root/version must be created. Runtime loadout and Physical custody
have explicit unwind paths so external assets are never trapped by protocol
pause or epoch drift.

## Byte budget and release gate

The current Sui Mainnet hard maximum Move package size is 102,400 bytes. The
release safety target is an exact serialized package object no larger than
90,000 bytes, leaving 12,400 bytes (12.1%) of hard-limit headroom.

The legacy package at base `aac90dbc` demonstrates why compiled module bytes
alone are not enough: its six modules total 89,543 bytes, while its on-chain
package has 151 type origins and an object size of approximately 100,856 bytes
as derived from its storage rebate. Its separate Physical v7 module is 32,987
bytes.

The 2026-08-14 clean `--disassemble --warnings-are-errors` production build
measured:

| Module | Bytecode bytes | Type origins |
| --- | ---: | ---: |
| `protocol_config_v8` | 5,699 | 7 |
| `maker_v8` | 23,000 | 37 |
| `publication_v8` | 4,759 | 0 |
| `composition_v8` | 9,244 | 13 |
| `expansion_pack_v8` | 13,073 | 19 |
| `complete_v8` | 12,265 | 18 |
| `seal_v8` | 4,561 | 6 |
| `soul_v8` | 3,043 | 4 |
| `physical_v8` | 6,153 | 10 |
| Total module bytecode | 81,797 | 114 |

Using Sui's pinned `MovePackage::size` formula (module-map names and bytecode,
type-origin metadata, linkage metadata, and sequence number), the exact package
object is **89,205 bytes**. This is 795 bytes below the 90,000-byte release
target and 13,195 bytes below the 102,400-byte hard maximum, so Physical stays
in the single package. No source-count estimate or uncompressed source size
substitutes for this clean production measurement.
