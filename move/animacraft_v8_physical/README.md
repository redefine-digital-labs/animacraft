# Animacraft v8 Physical

Fresh Physical companion for the unified Maker v8 product. This package has no
v4-v7 dependency or compatibility path.

This first release slice owns the immutable per-Maker Physical policy registry:

- `PhysicalPackageConfigV8` privately embeds Core's concrete Physical call cap.
- Base Style policies are derived from live sealed Core Style rows while the
  Maker Root is `DRAFT`.
- Rows are sequence-checked, duplicate-safe, commitment chained, and sealed.
- Physical proof modes are exactly `NONE` for free/paid issuance and
  `CANONICAL_SOUL` for proof materialization. Complete receipts are never a
  standalone Physical proof because Output creates the Canonical Soul in the
  same PTB.
- Base policy lookup consumes Output's typed `PhysicalSelectionBindingV8` and
  binds the Runtime-derived Part, Item, Style, Layer Track, source Root, and
  asset commitment; callers cannot supply authoritative semantic keys.
- Zero policy registries use a domain-separated empty commitment.
- Activation readiness requires the immutable side to be exact and every
  future runtime counter/revision/treasury/replay lane to remain zero.

Pack policies, issuance, holder-safe custody, and Market escrow are
intentionally added only after their typed companion witness ABIs are
integrated. No placeholder or caller-supplied object-ID or semantic-key
authority is accepted here.

## Validation

```sh
sui move test --warnings-are-errors
sui move build --force --warnings-are-errors --path probes/companion_compile
node scripts/run_adversarial_probes.mjs
sui move build --force --disassemble --warnings-are-errors
node scripts/measure_package_size.mjs
```

The package-object target is 55,000 bytes, below Sui's 102,400-byte hard max.
