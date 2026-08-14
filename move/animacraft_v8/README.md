# Animacraft v8 Move package

This is the single fresh Sui package for Animacraft v8. It depends only on the
pinned Sui framework. It has no import, migration entry point, witness, or
runtime read against Animacraft v4/v5/v6/v7.

## Modules and capabilities

The package contains `protocol_config_v8`, `maker_v8`, `composition_v8`,
`expansion_pack_v8`, `complete_v8`, `seal_v8`, `soul_v8`, `physical_v8`, and
the dependency-top `publication_v8` orchestrator.

Protocol capability bits are:

| Capability | Bit | Required |
| --- | ---: | --- |
| Composition | 1 | yes |
| Expansion Pack | 2 | yes |
| Complete | 4 | yes |
| Seal | 8 | yes |
| Physical | 16 | only when declared |
| Canonical Soul | 32 | yes |

`required_capabilities_v8()` is `47`; `supported_capabilities_v8()` is `63`.
Physical remained in this package because the exact package-object size is
below the 90,000-byte release target.

## Publication contract

`publication_v8::begin_maker_v8` creates and shares one DRAFT object graph:

- `MakerRootV8<PaymentCoin>`, `MakerTreasuryV8<PaymentCoin>`, and the exact
  owned `MakerAdminCapV8`;
- Composition, Pack, Complete, Seal, and Canonical Soul registries;
- a Physical registry exactly when the Physical bit and commitment are both
  present.

Expected commitments are computable before the transaction. Every
pre-publication hash contains version `8`, the immutable Root content
commitment, and canonical stable rows or scope keys. It never contains a Root,
registry, Release, Cap, Treasury, or other object ID allocated by that
transaction, and never contains the ownership epoch. Those concrete values
remain fields on every object and are checked during append, seal, activation,
resume, runtime use, and ownership transfer.

Track, Part, Item, Style, Smart Color, and Rule rows are immutable dynamic
fields on the Root. Appends require the exact current Cap, DRAFT lifecycle,
global sequence, category range, unique key, bounded values, and exact parent
references. The Creator-aligned row ABI is intentional:

- Track: `key`, `label`, `render_order`, `payload_commitment`; there is no
  inferred `required` field.
- Part: `key`, `label`, `kind`, `render_order`, `required`, `visible`, and
  `payload_commitment`; a Part does not invent a Track parent.
- Style: Part/Item keys plus exact `layer_track_key`, optional paired
  `color_channel_key` and `default_swatch_key`, asset identity/protection, and
  `payload_commitment`. The Track must already exist. Final activation
  enumerates every Style and verifies its optional default swatch dynamic row.
- Rich gradients, rules, and editor-specific payloads are covered by the
  canonical 32-byte payload and Root content commitments.

Client validators use the on-chain limits returned by
`max_key_bytes_v8() = 128`, `max_label_bytes_v8() = 256`, and
`max_blob_id_bytes_v8() = 512`.

The only public activation routes are:

- `seal_and_activate_maker_v8` for a non-Physical Root;
- `seal_and_activate_physical_maker_v8` with the concrete same-package
  `PhysicalRegistryV8` TypeOrigin.

Both require the concrete Soul registry and all other mandatory registries.
They derive the activation tuple on-chain, verify exact counts, commitments,
registry IDs, protected-source equality, Seal coverage, protocol/config/coin
identity, and then call the package-only Root finalizer. Only that finalizer
changes `DRAFT -> ACTIVE` and emits `MakerV8Activated`.

## Runtime guarantees

- `ACTIVE`, `PAUSED`, and terminal `ARCHIVED` are Cap/current-owner controlled.
  Resume revalidates every bound registry. Ownership transfer atomically
  rebinds every registry and increments the Root epoch.
- FREE Maker and Pack access issue real zero-payment v8 Passes. PAID access
  requires the exact coin and splits the immutable protocol fee into canonical
  protocol and creator treasuries. Pack access is exactly `FREE`,
  `ONE_TIME_PAID`, or `INCLUDED_WITH_MAKER`; the last route rechecks current
  Maker access (including a current paid Maker Pass) instead of silently
  issuing a free Pack entitlement.
- Base and per-Pack Complete policies each use one of
  `UNLIMITED_FREE`, `FREE_QUOTA_THEN_PAID`, `PAID_EVERY_TIME`, or
  `FREE_QUOTA_THEN_BLOCK`. Authorization snapshots the exact wallet and total
  counters and consumption performs compare-and-swap before incrementing
  them, so concurrent authorizations cannot cross a quota or cap. A paid
  Complete sums the base and each unique used-Pack line item; the fixed
  Complete fee plus `floor(content subtotal * primaryContentFeeBps / 10_000)`
  goes to `ProtocolTreasuryV8` and the content remainder goes to the canonical
  `MakerTreasuryV8`. Pack access purchases alone fund Pack treasuries.
- Complete authorization is one-use and has no `store`, `copy`, or `drop`
  ability. Required Pack selections are exact ordered commitments; missing,
  extra, reordered, and duplicate identities are rejected.
- An output row's `recipe_policy_commitment` and
  `renderer_schema_commitment` commit immutable authoring policy and renderer
  schema; they do not freeze one player's Recipe. Once the exact loadout and
  ordered Pack selections are known, authorization derives a canonical Recipe
  commitment and canonical render commitment from those instance values.
  Receipt and Soul bind the derived instance commitments.
- Successful `complete_v8` returns a same-PTB, no-ability
  `SoulMintAuthorizationV8`. Only `soul_v8::mint_canonical_soul_v8` can consume
  it. The resulting non-generically-transferable `CanonicalSoulV8` binds the
  exact activated Complete registry, receipt, Root ID/epoch/content, holder,
  output, Recipe, render, and Complete authorization commitment. Paused,
  archived, stale-epoch, foreign-content, wrong-holder, and receipt-replay
  attempts abort.
- Physical policies bind exact base or registered Pack Styles. Runtime assets
  bind the exact Physical registry and Root tuple, enforce supply and transfer
  policy, and require explicit holder recovery after an ownership epoch change.

Production protocol initialization records Circle Sui USDC's exact TypeName;
tests use generic SUI fixtures only. The committed/readable protocol terms are
`primaryContentFeeBps = 1_000`, `fixedCompleteFeeAtomic = 0`,
`makerMarketFeeBps = 250`, and `soulMarketFeeBps = 250`. The two market BPS
values remain available to the external market execution modules without
being dropped from the v8 config snapshot. Rights validation requires every
royalty to be 0..1,000 BPS in 50-BPS increments and additionally requires
Soul-creator plus Maker-source royalties to be at most 1,000 BPS.

## Verification

Run from this directory:

```sh
sui move test --warnings-are-errors
sui move build --disassemble --warnings-are-errors
node scripts/measure_package_size.mjs
node scripts/test_physical_type_origin_rejection.mjs
```

The compile-fail probe proves that a foreign identically named Physical type
cannot enter activation and that a forged Soul proof cannot enter minting.
The current test suite passes 75/75 tests. The final clean production build has
81,797 module-bytecode bytes and an exact `MovePackage::size` of 89,205 bytes:
795 bytes below the 90,000-byte release target and 13,195 bytes below Sui's
102,400-byte hard maximum.
