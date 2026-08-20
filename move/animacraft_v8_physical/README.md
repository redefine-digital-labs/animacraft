# Animacraft v8 Physical

Fresh Physical companion for the unified Maker v8 product. This package has no
v4-v7 dependency or compatibility path.

The package owns the complete per-Maker Physical policy and issuance surface:

- `PhysicalPackageConfigV8` privately embeds Core's concrete Physical call cap.
- Base Style policies are derived from live sealed Core Style rows while the
  Maker Root is `DRAFT`.
- Rows are sequence-checked, duplicate-safe, commitment chained, and sealed.
- Post-activation Pack policies require the current Maker Admin, current Pack
  Admin and owner, registry revision CAS, ACTIVE admission and Release, exact
  PackTreasury, and Runtime's transaction-local Physical policy witness. That
  witness carries the exact Root/registry/Release/Style/control tuple and has
  no abilities; a Pack ID or semantic key is never policy authority.
- Physical proof modes are exactly `NONE` for free/paid issuance and
  `CANONICAL_SOUL` for proof materialization. Complete receipts are never a
  standalone Physical proof because Output creates the Canonical Soul in the
  same PTB.
- `FREE_CLAIM` and `PAID_PURCHASE` consume Runtime's current no-ability
  selection witness. Pack issuance also re-reads ACTIVE admission and Release,
  the exact PackTreasury, holder Pass, current loadout row, and live Style.
- `PROOF_MATERIALIZE` consumes Output's no-ability
  `PhysicalMaterializationWitnessV8`, checks the exact current loadout, and
  records complete Output/receipt/Soul provenance. Pack materialization repeats
  the independent live Runtime Pack access proof before issuance.
- Every path uses a one-time domain-separated authorization key plus exact
  per-policy supply CAS. Free replay identity is policy+holder, purchase replay
  identity includes the exact payment Coin ID, and Soul materialization is
  policy+Soul ID+Soul commitment.
- Zero policy registries use a domain-separated empty commitment.
- Activation readiness requires the immutable side to be exact and every
  future runtime counter/revision/treasury/replay lane to remain zero.

Paid issuance atomically splits the exact Coin. Core's ProtocolTreasury receives
the protocol share; Base residual goes to the exact Root MakerTreasury and Pack
residual goes to the exact Release PackTreasury. Physical has no treasury.
Fee math uses `u128` basis-point arithmetic and rejects nonzero shares that
round to zero or leave no residual.

`PhysicalAssetV8` is `key` without `store`. It carries the full frozen source,
Style, Pack-registration, material-policy, issuance, proof, serial, and
provenance commitments plus its own holder and ownership epoch. Only
Physical's holder-checked direct transfer and terminal consume paths can move
or destroy it. Those exit paths intentionally take no Root or Pack reference,
so PAUSED or ARCHIVED source lifecycle cannot trap an issued asset; every new
issuance path still requires an ACTIVE Root and, for Pack assets, an ACTIVE
admitted Release.

## Typed Market dependency

Core already defines the Market role and concrete Market call-cap slot, but
this repository does not yet contain the exact production Market package
marker lineage or a typed Market-to-Physical escrow handshake. Physical
therefore exposes no escrow hook and does not pretend that a recipient address
is a Market authorization.

The minimal additive dependency is a published Market package with its real
original/callable markers and a transaction-local, no-ability escrow
request/return proof gated by Core's concrete Market call cap. The proof must
bind the exact Market registry, listing/order, asset ID and ownership epoch,
seller, escrow state transition, and intended custody transition. Once that
ABI exists, Physical can add cap-gated deposit/return/sale hooks that consume
the key-only asset. No placeholder marker or pure-ID hook is included here.

## Validation

```sh
sui move test --warnings-are-errors
sui move build --force --warnings-are-errors --path probes/companion_compile
node scripts/run_adversarial_probes.mjs
sui move build --force --disassemble --warnings-are-errors
node scripts/measure_package_size.mjs
```

The package-object target is 55,000 bytes, below Sui's 102,400-byte hard max.
