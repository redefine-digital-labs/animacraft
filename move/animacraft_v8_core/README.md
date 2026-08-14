# Animacraft v8 Core package

`animacraft_v8_core` is the first bounded package in the fresh split
Animacraft v8 product. It imports only the pinned Sui framework. It does not
import an old Animacraft package or any future companion package.

## Frozen product boundary

Animacraft remains one product at public version 8. A complete release will
require seven distinct package roles:

1. Core (this package)
2. Seal
3. Runtime (Composition, admission, and Pack)
4. Output (Complete and canonical Soul)
5. Physical
6. Market
7. Release orchestrator

Physical and Market are required product packages. A particular Maker may
have zero Physical policies, but it does not omit the Physical package
binding.

`ProductReleaseBindingV8` freezes, for every role, the original package ID,
the exact callable package ID, and 32-byte source, package, and ABI
commitments. The original and callable IDs are derived from Move marker type
origins. For an upgraded package, its callable marker must be introduced by
the exact callable package version. All seven original IDs and all seven
callable IDs must be distinct.

The Root starts without this binding because the Release package necessarily
depends on Core. `finalize_product_release_binding_v8` is a DRAFT-only,
AdminCap/current-owner operation and rejects replacement. Core exposes only a
readiness assertion in this phase; it does not expose an activation
transition.

## Core objects and immutable snapshots

`core_v8::new_maker_draft_v8` creates:

- one `MakerRootV8<PaymentCoin>` in `DRAFT`;
- its exact non-store `MakerAdminCapV8`;
- one `BaseDefinitionRegistryV8` for Track, Part, Item, Style, Smart Color,
  and Rule rows.

Root content freezes lineage, renderer/manifest/content identity, the exact
base-definition count and aggregate commitment, the Pack admission policy,
and immutable rights/economics snapshots. Economics includes the exact
ProtocolConfig ID/revision/commitment, payment type, access and Complete
policy, and all four protocol fee terms. Rights require explicit confirmation
and enforce 0–1,000 BPS royalties in 50-BPS steps with a 1,000-BPS combined
Soul-creator plus Maker-source cap.

The same-transaction Root/base-registry ID cycle is resolved by one internal
DRAFT-only binding. Same-transaction object IDs are fields, not inputs to the
precomputable Root content/version commitments.

## Extensible Pack contract

Base content does **not** contain a Pack release count, concrete Pack set, or
rolling Pack-registry commitment. Before activation, Core binds exactly one
Runtime-owned Pack registry ID, one admission-authority ID, and the immutable
admission-policy commitment. That binding is DRAFT-only and cannot be
replaced.

The future Runtime package owns the mutable Pack registry revision and must
admit independent Pack Releases with revision CAS plus exact Root ID, Maker
version/content, and current ownership-epoch compatibility. This Core package
does not implement or claim that admission/runtime behavior.

## Deliberate non-functionality

This bounded split does not implement activation, pause/resume/archive,
ownership transfer, Pack admission, Complete/Soul, Seal, Physical, Market,
payment, or public discovery. `ACTIVE`, `PAUSED`, and `ARCHIVED` values are
reserved for the later checked Release/lifecycle implementation; no
production function here can transition a Root out of `DRAFT`.

## Verification

From this directory:

```sh
sui move test --warnings-are-errors
sui move build --disassemble --warnings-are-errors
node scripts/measure_package_size.mjs
```

The size script implements Sui's exact `MovePackage::size` formula and fails
above the Core target of 45,000 bytes.
