# Animacraft v8 Market

Fresh Market companion for the unified Maker v8 product. It imports only the
fresh v8 Core package and contains no compatibility, migration, or fallback
path.

This package currently owns the activation-safe market foundation:

- `MarketPackageConfigV8` privately embeds Core's concrete Market call cap.
- Every Maker has an exact `MarketRegistryV8` and PaymentCoin-typed
  `MarketTreasuryV8` bound to the live Root, catalog, protocol economics, and
  immutable rights snapshot.
- DRAFT activation requires an explicitly sealed, domain-separated zero
  listing/escrow/revenue state. Missing Market state is never interpreted as
  readiness.
- Maker and Canonical Soul resale quotes derive protocol fees and royalties
  only from live Root snapshots, use `u128` intermediates, and reject any
  non-zero fee that rounds to zero.

Listing and settlement are intentionally not exposed until Output and Physical
provide concrete, no-ability custody tickets. This package does not accept a
caller-supplied object ID, string package name, or boolean as custody proof.

## Validation

```sh
sui move test --warnings-are-errors
sui move build --force --warnings-are-errors --path probes/companion_compile
node scripts/run_adversarial_probes.mjs
sui move build --force --disassemble --warnings-are-errors
node scripts/measure_package_size.mjs
```

The package-object target is 55,000 bytes, below Sui's 102,400-byte hard max.
