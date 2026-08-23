# Animacraft Maker v8 Release

This fresh dependency-top package is the sole public terminal orchestrator for
the unified Maker v8 graph. Core owns every `MakerRootV8` field and lifecycle
mutation. Release privately holds Core's exact Release call capability, supplies
the exact Release marker TypeOrigins, consumes all five no-ability activation
readiness values, and emits discovery or lifecycle events only after live
readback succeeds.

`resume_maker_v8` requires the Root's exact enabled `ProtocolConfigV8` snapshot.
`pause_maker_v8` and `archive_maker_v8` intentionally remain available after
protocol disablement as safety controls, and `ARCHIVED` is terminal.

The unprotected render wrapper constructs its private no-ability
`ReleaseRenderWitnessV8` from live Root/catalog/Output state. Callers provide
render material, not a witness or a pure authority tuple. Market remains only
Core's consumed `MarketReadinessV8`; this package contains no Market logic.

Publication uses three additional capability-contained wrappers. The Release
config certifies and immediately consumes Core's one-time catalog witness,
constructs license-wrapped rights for the transaction sender, and constructs a
private `ReleaseTransportWitnessV8` for each protected Base ciphertext. None of
these paths accepts a call capability, creator address, authority boolean,
package ID, Root ID, or certification commitment as caller-authored authority;
all identities are reread from the exact live config, catalog, Root, and Seal
policy objects.

## Verification

From this directory:

```sh
sui move test --warnings-are-errors
sui move build --force --disassemble --warnings-are-errors
node scripts/run_adversarial_probes.mjs
node scripts/measure_package_size.mjs
git diff --check
```

The size script implements Sui's exact `MovePackage::size()` formula, fails
above the 25,000-byte Release target, and reports headroom below the 102,400-byte
Mainnet hard maximum.
