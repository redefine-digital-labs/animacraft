# Animacraft v8 Market

Fresh Market companion for the unified Maker v8 product. It imports only the
fresh v8 Core package and contains no compatibility, migration, or fallback
path.

This package owns the activation-safe market and fixed-price settlement path:

- `MarketPackageConfigV8` privately embeds Core's concrete Market call cap.
- Every Maker has an exact `MarketRegistryV8` and PaymentCoin-typed
  `MarketTreasuryV8` bound to the live Root, catalog, protocol economics, and
  immutable rights snapshot.
- DRAFT activation requires an explicitly sealed, domain-separated zero
  listing/escrow/revenue state. Missing Market state is never interpreted as
  readiness.
- Maker, Canonical Soul, and Physical resale quotes derive fees and royalties
  only from live Root snapshots, use `u128` intermediates, and reject any
  non-zero fee that rounds to zero.
- `MakerListingV8` owns the exact key-only `MakerAdminCapV8`; purchase rotates
  control once, while cancel/recovery returns the original control unchanged.
- `SoulListingV8` consumes Output's no-ability ticket and owns one indivisible
  CompleteOutput + CompleteReceipt + CanonicalSoul child bundle.
- `PhysicalListingV8` consumes Physical's no-ability ticket and keeps Base and
  Pack source/treasury settlement as statically separate entry points.
- Exact payment enters `MarketTreasuryV8` before settlement and its escrow is
  zero again in the same transaction. Protocol, creator, Maker/Pack source,
  and seller residual splits are recomputed from the current bound Root.
- Seller cancellation is unconditional. Soul/Physical PAUSED/ARCHIVED and all
  disabled/drifted protocol states enable permissionless recovery to the
  stored seller. A healthy PAUSED Maker sale remains seller-cancelable but is
  not third-party recoverable, preventing permissionless listing grief.

No listing API accepts a caller-supplied object ID, package name, hash, holder,
epoch, source discriminator, or boolean as custody/settlement authority.

## Validation

```sh
sui move test --warnings-are-errors
sui move build --force --warnings-are-errors --path probes/companion_compile
node scripts/run_adversarial_probes.mjs
sui move build --force --disassemble --warnings-are-errors
node scripts/measure_package_size.mjs
```

The package-object target is 55,000 bytes, below Sui's 102,400-byte hard max.
