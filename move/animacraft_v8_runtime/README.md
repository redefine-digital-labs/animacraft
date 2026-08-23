# Animacraft v8 Runtime package

`animacraft_v8_runtime` is the fresh Runtime companion for Core v8. It imports
only pinned Sui, `animacraft_v8_core`, and `animacraft_v8_seal`. It has no old Animacraft imports, compatibility
objects, package-name strings, or caller-supplied trust booleans.

## Immutable compatibility

Every definition registry, Pack registry, Pack Release, external Item product,
loadout, Pass, and proof binds the immutable tuple:

1. exact `MakerRootV8` object ID;
2. exact numeric Maker version;
3. exact Root content commitment.

Maker `control_epoch` is checked only for authorized writes. It is deliberately
absent from Pack compatibility, Passes, loadouts, and completed access proof
identity, so a Maker control transfer does not erase holder state.

## Runtime definition and Core readiness

`RuntimeDefinitionRegistryV8` stores one immutable `PartProfileV8` per Core
Part, in exact Core Part order. Each row binds the Core Part's opaque payload
commitment and the compiler-derived `wardrobeMode`, behavior, capacity,
required bit, and Maker-wide admission ceiling. Runtime never attempts to
infer `wardrobeMode` from the opaque payload.

Behavior is the frozen four-state Creator/Physical enum: `FIXED`,
`SOUL_LOCAL`, `OPEN`, or `HYBRID`. FIXED Parts require FIXED behavior; SLOT
Parts require one of the other three; required Parts reject OPEN. Only OPEN
and HYBRID accept external products. Base Item selection also requires Core's
compiler-derived INCLUDED gate; no unimplemented gate is treated as access.

`FIXED` blocks independent external Item gear only. Base Maker Styles and
official admitted Pack Styles remain selectable. `SLOT` additionally permits
external Items under the exact `DISABLED`, `CERTIFIED`, or `OPEN` Maker-wide
ceiling. Current v8 loadouts permit zero or one selection per Part, matching
the required/optional Part contract.

The mutable `PackRegistryV8` is created empty at revision zero beside its exact
`PackAdmissionAuthorityV8`. After profiles seal, Runtime issues a private,
no-ability readiness receipt only while the Pack registry still has zero Pack
and external-admission rows. `runtime_binding_v8` consumes it, rechecks all
three live registry/authority objects, and borrows Core's unique Runtime call
cap from the private field of shared `RuntimePackageConfigV8`. Core then
produces its no-ability `RuntimeActivationReadinessV8`; the old pure-tuple
readiness path is not public. No caller can submit registry IDs, companion
commitments, or policy strings beside a generic trust flag.

## Canonical loadouts

`MakerLoadoutV8` stores a bounded `vector<Option<LoadoutSelectionV8>>` whose
indices are the immutable Part-profile order. Creation requires Core's exact
non-transferable `MakerAccessPassV8`; current source proofs reread that same
Pass, so paid Maker access cannot be bypassed through Runtime. Every present
selection binds:

- Part, Item, Style, Layer Track, and exact optional channel/swatch;
- Blob locator, SHA-256, asset/content commitment, and Seal binding;
- source class, definition/Release/product ID, access subject, and source
  epoch, plus semantic Pack ID for Pack selections;
- exact Pack pricing commitment where applicable.

After every revision-CAS mutation, Runtime hashes the whole current vector.
The prior hash, operation, and revision are not commitment inputs. Two edit
histories that reach the same exact current vector therefore produce the same
loadout commitment.

Selection APIs are separate:

- base selection rereads exact sealed Core Item/Style/Track/Color rows;
- official Pack selection rereads an ACTIVE admitted Release, exact Style,
  Core Track/Color rows, current Maker and Pack Passes, and works for both
  `FIXED` and `SLOT`;
- external selection requires `SLOT`, current admission, lifecycle,
  compatibility, exact product/asset identity, and a holder-owned instance.

An equipped transferable instance gains an `EquipLockV8` bound to loadout ID,
equip revision, and selection index. Transfer is impossible while locked.
Atomic unequip clears both state copies and remains holder-available even when
the Root, product, admission, or Pack is paused, revoked, or archived.

## Output proof boundary

Runtime rereads the current source and entitlement for each selected entry and
returns an individual no-ability `SelectionAccessProofV8`. The holder must
submit exactly one proof per present entry in increasing Part order.
`seal_ordered_selection_proofs_v8` rejects missing, duplicate, stale,
unrelated, reordered, paused, revoked, or unequipped sources and returns one
no-ability `RuntimeLoadoutAuthorizationV8`.

Output must consume that authorization against the same borrowed loadout. A
same-transaction mutation after proof sealing invalidates revision and current
commitment checks. Output receives ordered selection and pricing commitments;
its deduplicated used-Pack rows include exact semantic Pack ID, Release ID,
content, and pricing commitments for Output's ALL_ADMITTED/ALLOWLIST check. It
never receives a caller-authored Pack list.

## Physical proof boundary

Runtime exposes two additive Physical-only witnesses. Both values have no
abilities and both are created and consumed under Core's exact Physical call
cap plus the catalog's real Physical TypeOrigin.

- The policy witness is derived only from the live ACTIVE admitted Release,
  exact current Pack owner/Admin/control epoch, exact PackTreasury, and exact
  Style row. Physical consumes it immediately when installing a post-activation
  Pack policy.
- The access witness re-reads ACTIVE admission and Release, PackTreasury,
  holder PackPass, current loadout selection, pricing, and live Style. Physical
  compares it with an independently consumed Runtime selection or Output Soul
  materialization witness before issuing.

Neither API accepts an authoritative Pack ID, Style identity hash, treasury
ID, holder boolean, or semantic key in place of those live objects.

## Independent Pack releases

Each post-activation `PackReleaseV8` has independent content, manifest, Style
registry, creator/current owner, exact AdminCap, treasury, lifecycle, access
policy, native four-mode Complete policy, per-wallet counters, total cap, and
Passes. Admission reserves its semantic Pack ID permanently, preventing two
Release objects from impersonating one allowlist identity. Admission and
revocation mutate only `PackRegistryV8` under exact
revision CAS and current Maker AdminCap authority. Pause/resume/archive do not
rewrite old Passes or receipts.

Paid Pack access and used-Pack Complete settlement are finalized only through
Core's exact ProtocolTreasury deposit API: protocol primary-content fees go to
Core ProtocolTreasury and the residual goes to `PackTreasuryV8`. Runtime never
returns a loose protocol-fee coin. `INCLUDED_WITH_MAKER` similarly requires an
exact typed `MakerAccessPassV8`; no boolean substitutes for it. A no-ability
Pack Complete line advances native counters only after Runtime first consumes
Core's same-transaction `OutputRuntimeRequestV8`. That request is bound to the
exact active Root, catalog call-cap set, live Output registry, transaction
signer, and fresh request ID. Free lines are then consumed exactly once;
paid lines atomically settle protocol and Pack-treasury shares.

## Seal boundary

Unprotected Styles use an explicit empty Seal binding. Protected Base and Pack
registration, selection, ordered access proofs, and decrypt entitlements pass
through typed Runtime/Seal adapters. They derive semantic scope and asset keys,
reread Seal's exact protected row, bind its complete registry/policy/Root/
ciphertext/certification snapshot, and immediately consume Runtime's private
no-ability witness after Seal round-trips it. Pack decrypt additionally requires
both Core's exact `MakerAccessPassV8` and Runtime's exact live `PackPassV8`.
Runtime never trusts a caller-supplied package string, protection boolean, or
entitlement assertion.

## Verification

From this directory:

```sh
sui move test --warnings-are-errors
sui move build --force --disassemble --warnings-are-errors
node scripts/run_adversarial_probes.mjs
node scripts/measure_package_size.mjs
git diff --check
```

The package-size gate uses Sui's exact `MovePackage::size()` formula and fails
above 90,000 bytes, retaining at least 12,400 bytes below Mainnet's 102,400-byte
limit.
