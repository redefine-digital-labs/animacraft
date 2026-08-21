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

## Typed Market custody

Physical exposes Market custody and settlement without importing the Market
package. Every hook is gated by Core's exact `MarketRoleV8` call cap, the
catalog-certified Market original/callable type origins, the Root's exact
Market registry and treasury IDs, and the current product/call-cap bindings.
The caller supplies the concrete Market marker and object types, but their
certified origins and object IDs are re-derived and checked on chain.

Custody transfers the exact key-only asset directly under the listing UID and
returns a no-copy/no-drop/no-store ticket. Its readback binding records the
listing, both registry IDs, Market treasury, Root/version/content, asset,
holder/epoch, transferable flag, provenance, and the complete typed source and
source-treasury identity. Base and Pack enter through separate typed hooks:
Base binds the exact Root MakerTreasury, while Pack binds the exact
PackTreasury from the registry policy. No caller-provided ID, hash, source-kind
flag, or transferability flag is authority.

Return receives the exact listed child and restores the stored seller without
changing logical holder, epoch, source, or provenance. It remains available
while the Root is PAUSED/ARCHIVED or the protocol is disabled or drifted, so
custody cannot trap an asset. Purchase instead requires the complete
ACTIVE/current chain, rejects self-purchase, advances ownership epoch exactly
once, changes only the holder, and transfers the asset to the transaction
sender. The one-use `Receiving`, exact listing parent, bound asset tuple, and
linear ticket prevent substitution and replay.

## Validation

```sh
sui move test --warnings-are-errors
sui move build --force --warnings-are-errors --path probes/companion_compile
node scripts/run_adversarial_probes.mjs
sui move build --force --disassemble --warnings-are-errors
node scripts/measure_package_size.mjs
```

The package-object target is 55,000 bytes, below Sui's 102,400-byte hard max.
