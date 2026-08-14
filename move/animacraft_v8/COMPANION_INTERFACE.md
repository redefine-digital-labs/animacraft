# Animacraft v8 companion interface and package budget

Status: implementation contract for the fresh `animacraft_v8` TypeOrigin.
This document describes v8 only. It does not define a migration, bridge, or
read path for `OCMaker`, `MakerRootV5`, Composition v6, Physical v7, or the old
Expansion Pack v8 TypeOrigin.

## Package split

The default publication unit is one package and one public protocol version:

```text
animacraft_v8
  protocol_config_v8
  maker_v8
  composition_v8
  expansion_pack_v8
  complete_v8
  seal_v8
  publication_v8
  physical_v8                 # only while the measured package stays safe
```

`publication_v8` is the dependency-top orchestrator. `maker_v8` must not
import a companion module. Each companion imports `maker_v8`, and
`publication_v8` imports both sides, validates every registry, then calls the
package-only `maker_v8::activate_checked_v8`. This direction prevents a Move
module dependency cycle while keeping activation in one transaction.

Physical is the only permitted package split. It becomes
`animacraft_v8_physical::physical_v8`, still reports version 8, and imports the
fresh core package only. The split is an implementation boundary, not another
public version.

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

- compare each companion registry ID, count, and final commitment with the
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

Composition, Pack, Complete, and Seal each expose one shared per-Maker
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
   BCS row containing version, Root tuple, sequence, prior commitment, and all
   semantic row fields;
7. increment exactly one category count and the aggregate count.

The empty rolling commitment is itself domain-separated and 32 bytes. An
empty registry is never represented by an empty vector or a missing object.

Sealing checks every category count, aggregate count, and the expected final
commitment. It is irreversible. Each registry exposes only this package-level
activation ABI:

```move
public(package) fun assert_activation_ready_v8<PaymentCoin>(
    registry: &RegistryV8,
    root: &MakerRootV8<PaymentCoin>,
): (ID, vector<u8>, u64)
```

It checks version, Root tuple, counts, commitment, and `sealed`, then returns
the registry ID, final commitment, and observed count for the orchestrator.

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
- access `FREE` with price exactly zero, or `PAID` with price greater than
  zero;
- lifecycle `DRAFT -> SEALED -> ACTIVE <-> PAUSED -> ARCHIVED`;
- exact entitlement records and immutable wallet Passes;
- explicit Seal policy commitment and protected-asset count.

Style rows cannot change after release seal. A Pass binds release ID, Root
tuple, release content commitment, holder, payment amount, and issue time.
Root epoch drift suspends access. Re-admission at a new epoch requires both the
current Maker authority and the exact Pack authority; existing entitlements
may survive but cannot authorize access until re-admission completes.

## Seal and Complete semantics

The Seal registry maps a domain (`STYLE` or `COMPLETE`), scope ID, asset key,
and asset commitment to a derived 32-byte Seal ID. A protected Pack or
Complete row must prove exact registry coverage before it can seal. Free,
unprotected content records `protected = false` and an empty Seal ID; this is
an explicit policy, not a missing policy.

Complete policy rows are immutable publication data. A runtime Complete
authorization has no `store`, `copy`, or `drop` ability. It binds the Root
tuple, loadout object/revision/commitment, exact Recipe and render commitment,
required Pack-access proofs, and Seal coverage. Only consuming that one-use
authorization may create an immutable `CompleteReceiptV8`.

## Physical split binding

When Physical remains in the core package, it follows the same registry ABI
and `publication_v8` validates it directly.

When Physical is split, dependency direction is only:

```text
animacraft_v8_physical -> animacraft_v8
```

The Root stores, before publication, the expected Physical commitment and the
exact original type name of
`animacraft_v8_physical::physical_v8::PhysicalBindingWitnessV8`. The core
provides a one-time DRAFT-only generic binding hook. It checks AdminCap, Root
tuple, expected commitment, and
`type_name::with_defining_ids<Witness>()` against that stored name. The
Physical module can construct its witness only after its registry is sealed
and ready; the witness fields and constructor remain private. The core records
the Physical registry ID and observed commitment, and activation requires that
record for a Root that declares Physical capability.

This avoids a cyclic package dependency and prevents a caller from claiming a
Physical binding with an arbitrary object. Runtime and deployment preflight
must separately pin the reviewed callable package and digest; TypeOrigin is
the on-chain identity check, not the entire release lock.

## Recovery boundary

On-chain staging is forward-only and queryable. Recovery resumes from the
registry's exact observed sequence and rolling commitment. A commitment chain
cannot be rolled back without storing every predecessor, so v8 does not offer
an unsafe hash reset.

If the source snapshot changes or a signed stage becomes terminal, the creator
may mark the DRAFT Root `ABANDONED`. No activation/discovery event is emitted,
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

Initial compiled-module budgets for the fresh all-in-one package are:

| Module | Budget (bytes) |
| --- | ---: |
| `protocol_config_v8` | 4,000 |
| `maker_v8` | 16,000 |
| `publication_v8` | 4,000 |
| `composition_v8` | 12,000 |
| `expansion_pack_v8` | 14,000 |
| `complete_v8` | 5,000 |
| `seal_v8` | 5,000 |
| `physical_v8` | 22,000 |
| Total module bytes | 82,000 |
| Metadata/type-origin reserve | 8,000 |
| Exact package-object target | 90,000 |

The production build records both module totals and the exact serialized
package-object size. Physical stays in `animacraft_v8` only when the exact
object is at most 90,000 bytes. If it exceeds that target, split Physical and
apply these targets:

- core package object at most 68,000 bytes;
- Physical package object at most 40,000 bytes;
- each package independently below the 102,400-byte hard maximum;
- the binding witness and exact dependency/callable package IDs covered by
  negative tests and deployment preflight.

No source-count estimate or uncompressed source size may substitute for the
production bytecode and serialized-object measurements.
