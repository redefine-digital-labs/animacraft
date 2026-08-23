# Animacraft v8 Seal package

`animacraft_v8_seal` is the fresh Seal role for unified Animacraft v8. It
depends only on `animacraft_v8_core` and the exact Sui framework revision
`73dd2c2ba6f9fdb21d7ffde2b50a3f2f0ac39bc1`. It imports no older Animacraft
package and accepts no package-name or package-ID strings from a Maker author.

## Security boundary

Sui Seal does not require a Move framework object to “decrypt.” Its key
servers dry-run an application policy entry function and release key shares
only when that transaction succeeds. The three real policy entry functions
in this package are:

- `seal_approve_base_v8`
- `seal_approve_pack_v8`
- `seal_approve_complete_v8`

Each consumes a same-PTB no-ability proof. It verifies the transaction sender,
exact Core Root ID/version/content, immutable Seal policy, sealed registry,
semantic scope/asset key, certified ciphertext/blob tuple, and deterministically
derived Seal ID. A DRAFT Root never approves. `ACTIVE`, `PAUSED`, and
`ARCHIVED` retain holder-safe read access so lifecycle control cannot trap a
legitimate holder's already acquired content.

No function returns plaintext or a decryption key, and no boolean or
manifest-only “encrypted” claim grants access.

## Immutable key-server policy

`new_seal_policy_config_v8` requires the exact Core `ProtocolAdminCapV8`, a
current `ProductReleaseCatalogV8`, and the one concrete
`PackageCallCapV8<SealRoleV8>` taken from that catalog. It validates and stores
that non-copyable capability inside the immutable config, and commits its exact
authority ID and the catalog's complete call-cap-set commitment alongside the
Seal original/callable type origins. It also stores a strictly sorted, duplicate-free vector
of exact key-server object IDs and weights, a valid weighted threshold, a
key-server-set commitment, and an encryption-policy commitment. The shared
`SealPolicyConfigV8` has no mutator.

Changing key servers or encryption policy means certifying a new product
release/config; it cannot silently change the policy of an existing Maker.

## Certified ciphertext identity

The exact Release callable certifies transport through
`certify_ciphertext_v8`. It must supply a private no-ability witness whose
original/defining package lineage matches Core's frozen Release binding. Seal
returns that witness unchanged with `CiphertextCertificationV8`; Release then
destructures its own witness internally. The certification has no abilities
and binds:

- catalog and full product-binding commitments;
- exact Seal config and policy commitment;
- Core Root content plus numeric Maker version;
- scope kind, stable semantic scope key, and scope commitment;
- stable semantic asset key and exact asset-content commitment;
- exact ciphertext Blob ID, ciphertext SHA-256, and certified Blob
  commitment.

The package derives both the certification commitment and Sui Seal ID from
that complete BCS tuple. Neither is caller supplied. The Seal ID deliberately
uses stable semantic/content inputs rather than an object ID created by the
same publication transaction.

Supported scopes are Base, Pack, and Complete. Pack approval additionally
matches the exact Pack content commitment. Complete approval recomputes a
domain-separated instance commitment over exact Recipe, render, output, and
receipt commitments; its receipt and output object IDs remain exact proof
fields supplied only by the catalog-frozen Release callable after reread.

## Per-Maker registry and readiness

One `SealRegistryV8` is built while the Core Root is DRAFT. Every append:

- requires the exact current `MakerAdminCapV8`;
- requires the next sequence and an available per-scope expected count;
- rejects duplicate `(scope kind, semantic scope key, semantic asset key)`;
- consumes one no-ability Release certification;
- advances the domain-separated rolling commitment on chain.

Sealing requires exact Base/Pack/Complete and total counts plus the exact final
commitment. A Maker with no protected rows still creates and explicitly seals
a registry whose commitment is the domain-separated empty commitment; absence
of an object is never treated as empty readiness. After activation, exact
Runtime and Release private witnesses can register later Pack/Complete
ciphertexts in a separate revision-CAS chain. This never rewrites the sealed
activation commitment. New registrations require `ACTIVE`; existing exact
holders retain decrypt approval while `PAUSED` or `ARCHIVED`.

`issue_seal_readiness_v8` creates a module-private intermediate witness,
destructures it inside Seal, and returns `SealReadinessV8`. The public witness
has no abilities and carries the exact Root ID/version/content, catalog/product
binding and call-cap set, registry/config IDs, the Seal authority ID, all
key-server IDs and policy commitments, sealed registry commitment, and
per-scope/total counts. Future Release must
receive readiness only through `certify_activation_readiness_v8`. That sole
production terminal path consumes and rechecks the local witness, then borrows
the policy's private `PackageCallCapV8<SealRoleV8>` to call Core's certifier
with live `SealPolicyConfigV8` and `SealRegistryV8` references. Core verifies
both object types have the exact Seal original package lineage while the
callable marker and Root call-cap set bind the current callable release. No
generic Root-ID bridge or parallel Release-authority readiness path is used.

## Entitlement and receipt adapters

Seal remains below Runtime and Output in the dependency DAG, so it cannot
import either package. Instead:

- `certify_base_entitlement_v8` and `certify_pack_entitlement_v8` require a
  Runtime-defined private no-ability witness whose original/defining lineage
  matches Core's frozen Runtime package;
- `certify_complete_receipt_v8` similarly requires a private Release witness,
  whose package can statically verify Output's receipt before calling Seal.

Each adapter returns the external witness unchanged alongside the Seal proof,
so the defining package can immediately destructure both without requiring
any generic ability. The witness constructor and adapter must remain private;
an external caller cannot manufacture the exact callable-package witness.
The returned holder-bound proofs have no copy, drop, or store ability. External
compile probes prove callers cannot forge their fields, copy them, discard
them, or wrap them in stored values. `protected_asset_snapshot_v8` separately
exposes a complete exact row readback for Runtime selection checks but grants
no decrypt authority.

## Verification

From this directory:

```sh
sui move test --warnings-are-errors
sui move build --force --disassemble --warnings-are-errors
node scripts/run_adversarial_probes.mjs
node scripts/measure_package_size.mjs
git diff --check
```

The size script implements Sui's exact `MovePackage::size` formula: sequence
number, module map, type origins, and linkage entries. It enforces a 75,000-byte
package target and independently fails unless at least 10,000 bytes remain
below the 102,400-byte Mainnet hard maximum.
