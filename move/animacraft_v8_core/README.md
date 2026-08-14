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

`ProductReleaseCatalogV8` can be certified only with the exact
`ProtocolAdminCapV8`. It freezes, for every role, the original package ID, the
exact callable package ID, and 32-byte source, package, and ABI commitments.
A Maker author can reference this catalog but cannot construct or certify a
production binding. Catalog certification creates six Core-defined,
non-copy/non-drop call capabilities for Seal, Runtime, Output, Physical,
Market, and Release. Each capability carries a fresh authority nonce, the
exact catalog/product/role commitments, and one committed call-cap-set tuple.
ProtocolAdmin may take each capability exactly once into the corresponding
companion's private config. The catalog cannot become shared until all six
have been installed. The Root copies the exact product and call-cap-set
snapshots.

The original and callable markers must share one package lineage, and the
callable ID is the callable marker's defining package ID. Distinct-role
collision checks cover both columns and their cross-products; original and
callable IDs may coincide only within one role on its initial publication.
The native capability mask is fixed at `127` (`0b1111111`), so Physical and
Market can never be omitted from a complete product catalog.

Move cannot inspect or hash published package bytes. Source/package/ABI
digests in the catalog are ProtocolAdmin governance commitments, not an
on-chain bytes-hash proof. Release operations must read back the published
package bytes off chain, recompute the digests, compare all IDs/digests, and
only then certify and lock the catalog.

The Root starts without this binding because the Release package necessarily
depends on Core. `ReleaseCatalogWitnessV8` and `RuntimePackReadinessV8` have no
abilities. The exact companion privately borrows its concrete role-typed call
capability only after validating live state; generic type instantiation is
never treated as authority. Core-issued proofs are destructured only inside
package-internal finalization paths. Product binding finalization is a
DRAFT-only AdminCap/current-owner operation, consumes the exact current
enabled catalog proof, and rejects replacement. Core exposes only a readiness
assertion in this phase; it does not expose an activation transition.

## Core objects and immutable snapshots

`core_v8::new_initial_maker_draft_v8` creates version 1. The separate
`core_v8::new_successor_maker_draft_v8` requires a mutable typed previous Root,
its exact current AdminCap/control-epoch CAS, and a key-only
`SuccessorAuthorityV8`. `maker_v8::issue_successor_authority_v8` may issue
exactly one authority for an archived predecessor and binds it to the exact
Root ID, Maker key/version, version commitment, control epoch, current owner,
and `ARCHIVED` lifecycle. Successful successor construction destroys that
authority and writes the successor Root ID into the predecessor, preventing
same-transaction duplication and cross-transaction replay. It derives all
predecessor fields, preserves the Maker key, and sets the version to exactly
N+1. No public constructor accepts caller-supplied predecessor fields.

Each constructor creates:

- one `MakerRootV8<PaymentCoin>` in `DRAFT`;
- its exact non-store `MakerAdminCapV8`;
- one exact shared `MakerTreasuryV8<PaymentCoin>`;
- one `BaseDefinitionRegistryV8` for Track, Part, Item, Style, Smart Color,
  and Rule rows.

Protocol initialization creates one exact shared
`ProtocolTreasuryV8<PaymentCoin>` before the protocol may be enabled. Root
economics snapshots include that Treasury ID as well as the exact
ProtocolConfig ID/revision/commitment. Root content freezes lineage,
renderer/manifest/content identity, the exact
base-definition count and aggregate commitment, the Pack admission policy,
and immutable rights/economics snapshots. Economics includes the exact
Protocol Treasury ID, payment type, access and Complete policy, and all four
protocol fee terms. `assert_current_protocol_config_v8` requires that the
config is still enabled and that its ID, revision, commitment, Treasury,
payment type, and fee terms exactly equal the Root snapshot.

FREE Maker access issues an exact `MakerAccessPassV8`; PAID access atomically
checks the immutable Root price, deposits the primary protocol share into the
exact Protocol Treasury, deposits the residual into the exact Maker Treasury,
and only then issues the Pass. A non-zero protocol BPS share that rounds to
zero aborts. Passes bind immutable Root ID, numeric Maker version, content and
holder rather than control epoch, so a later Maker ownership transfer cannot
revoke already-issued access. Runtime consumes the typed Pass assertion; it
never trusts an off-chain `hasMakerAccess` flag.

Rights enforce 0–1,000 BPS royalties in 50-BPS steps with a 1,000-BPS combined
Soul-creator plus Maker-source cap. The public native constructor derives the
creator and confirmation from `TxContext`; it accepts no confirmation flags
and commits exact empty evidence/certification fields. `LICENSE_WRAPPED`
requires a no-ability `WrappedRightsCertificationV8` minted while the exact
Release config borrows its catalog-issued call capability. That certificate binds the transaction
signer, catalog and product binding, bounded evidence locator/blob IDs,
evidence SHA-256, and terms commitment. The public snapshot constructor only
consumes this certificate; it accepts no creator-confirmed or
evidence-certified booleans. All fields are included in the rights commitment,
which is included in the Root version commitment.

Complete policy uses one invariant that web/transaction builders must mirror:
`completeTotalCap == 0` means globally unbounded; otherwise it must be greater
than or equal to `completeFreeQuotaPerWallet`. A zero total cap never means
zero Completes.

The same-transaction Root/base-registry ID cycle is resolved by one internal
DRAFT-only binding. Same-transaction object IDs are fields, not inputs to the
precomputable Root content/version commitments.

## Extensible Pack contract

Base content does **not** contain a Pack release count, concrete Pack set, or
rolling Pack-registry commitment. Before activation, Core binds exactly one
Runtime-owned Pack registry ID, one admission-authority ID, and the immutable
admission-policy commitment. That binding is DRAFT-only and cannot be
replaced.

The Runtime package validates its private registry state and borrows its
catalog-issued Runtime call capability to obtain a no-ability
`RuntimePackReadinessV8`. Core checks the
registry/authority IDs plus exact immutable Root ID, numeric Maker version,
Root content commitment, and admission-policy commitment.

`control_epoch` exists only for the AdminCap and controlled writes. Immutable
Base and Pack compatibility is the Root ID + Maker version + content
commitment tuple; it deliberately excludes control epoch. Rotating Maker
control consumes the old cap, applies epoch CAS, and issues a new cap without
invalidating sealed Base content or a Pack binding. A predecessor with an
outstanding `SuccessorAuthorityV8` cannot rotate control: owner, AdminCap, and
control epoch remain frozen until that exact authority atomically creates the
successor. Core exposes no authority revoke, discard, or transfer escape hatch.

## Deliberate non-functionality

This bounded split does not yet implement activation, pause/resume/archive,
Pack admission/runtime mutation, Complete/Soul, Seal, Physical, Market, or
public discovery. Core does implement exact Maker/Protocol revenue custody and
Maker access settlement, but those public access paths remain unreachable
until the checked Release package activates a Root. `ACTIVE`, `PAUSED`, and
`ARCHIVED` values are reserved for that Release/lifecycle implementation; no
production function here can transition a Root out of `DRAFT`.

## Verification

From this directory:

```sh
sui move test --warnings-are-errors
sui move build --force --disassemble --warnings-are-errors
sui move build --force --warnings-are-errors --path probes/companion_compile
node scripts/run_adversarial_probes.mjs
node scripts/measure_package_size.mjs
git diff --check
```

The adversarial runner requires the external ability/API attack packages to
fail compilation for the expected reasons and the cross-catalog call-cap runtime
attack to abort as expected. The size script implements Sui's exact
`MovePackage::size` formula and fails above the Core target of 60,000 bytes.
That target includes native Treasury custody and Maker access enforcement yet
still reserves more than 42 KB beneath Mainnet's 102,400-byte hard maximum;
the hard limit is never treated as the working budget.
