# Unified Maker v8

## Product boundary

Animacraft v8 is one public protocol generation. New publications MUST NOT
create an `OCMaker`, migrate a `MakerRootV5`, or join v4/v5/v6/v7 objects at
read time. The old Mainnet objects are test history only: they remain on-chain,
but v8 authoring, public discovery, Player, export, lifecycle, and commerce do
not read or mutate them.

The public version is `8` everywhere. Internal modules may be split for Sui
package-size safety, but they MUST use fresh v8 TypeOrigins and MUST bind one
canonical `MakerRootV8`. A split package is an implementation boundary, not a
second product version or compatibility layer.

## Package boundary

The preferred layout is one fresh `animacraft_v8` package containing:

- `protocol_config_v8`: the enabled Mainnet protocol tuple and fee policy;
- `maker_v8`: Root, AdminCap, Treasury, staged publication and lifecycle;
- `publication_v8`: the only final activation orchestrator; it imports the
  Root and every required registry module, preventing circular dependencies;
- `composition_v8`: wardrobe slots, owned selections and loadout rules;
- `expansion_pack_v8`: Pack releases, style rows, Passes and lifecycle;
- `complete_v8`: exact final Recipe authorization and completion receipts;
- `seal_v8`: protected Style/Complete coverage and policy commitments.

`physical_v8` MAY be a separate fresh package only when the production build
would otherwise exceed the package-object safety budget. If split, it remains
version 8, binds the exact Root ID/ownership epoch/content commitment, and is a
required activation dependency for Makers that declare physical capability.

For a split Physical package, dependency is one-way (`physical_v8` imports
Core). The Core binding hook consumes a non-forgeable, non-copy witness whose
original TypeOrigin is pinned in ProtocolConfig and checks Root ID, ownership
epoch, content commitment, registry commitment and one-time binding. The
Physical module can construct that witness only after its typed registry is
activation-ready. Runtime and preflight additionally pin the Physical callable
package, TypeOrigin, source and package digest.

No new v8 package imports the old Animacraft package for protocol semantics.
The package-object target is at most 90,000 bytes and MUST retain at least
10,000 bytes of measured Mainnet object-size headroom.

## Canonical objects

Every publication has exactly these authoritative objects:

- shared `MakerRootV8<PaymentCoin>`;
- creator-owned `MakerAdminCapV8`;
- shared `MakerTreasuryV8<PaymentCoin>`;
- shared per-Maker composition, Pack, Complete and Seal registries, even when
  their row count is zero;
- optional physical registry only when physical capability is declared.

The Root commits to:

- protocol and package identity;
- creator, current owner, AdminCap and Treasury IDs;
- lifecycle and ownership epoch;
- immutable Maker/version lineage and renderer identity;
- Walrus manifest Blob/Quilt identity and SHA-256;
- content and final registry commitments;
- expected and observed counts for Tracks, Parts, Items, Styles, Smart Color
  channels/swatches, rules, slots, Pack releases and protected assets;
- Maker access, Complete policy, rights origin, creator/source/resale royalty,
  payment type and protocol fee policy;
- Composition, Pack, Complete, Seal and Physical capability bindings.

Published rows use canonical v8 keys and are never updated in place. A new
published version creates a new Root whose immutable lineage points to the
previous v8 Root/version commitment.

Every registry stores version, Root ID, ownership epoch, Root content
commitment, expected and observed counts, expected and rolling commitments,
and a sealed bit. Empty registries use a domain-separated empty commitment;
an empty byte vector is never treated as proof of completeness.

## Staged publication and atomic visibility

Walrus upload and certification finish before any v8 Root is created.

1. `begin_maker_v8` creates a shared `DRAFT` Root and its exact Cap, Treasury
   and empty required registries. It records manifest identity, expected
   counts, final commitments, economics and capability declarations.
2. Ordered chunk transactions append canonical rows. Each append requires the
   exact AdminCap, Root in `DRAFT`, the expected next sequence, unique keys and
   bounded vector sizes. Move computes the next category and aggregate SHA-256
   commitments from the prior commitment and canonical BCS row; it never
   trusts a caller-provided next hash.
3. Required capability bindings are created against the exact Root and current
   ownership epoch. A zero-row registry is still explicitly bound.
4. One final `publication_v8::seal_and_activate_maker_v8` transaction checks protocol enabled,
   package/config/payment identities, manifest and renderer commitments,
   every expected/observed count, exact sequence, category and aggregate
   commitments, capability registry IDs, Seal coverage, and paid-policy
   completeness. It changes `DRAFT -> ACTIVE` and emits the only public
   discovery event, `MakerV8Activated`.

Registry modules import `maker_v8` for Root/AdminCap authorization. The Root
module does not import those registries. Instead the same-package
`publication_v8` module reads every typed registry, performs the complete
cross-module check, then invokes the package-private checked activation path.

`DRAFT` objects are intentionally visible to their creator for recovery but
are never public catalog entries. Partial publication, a failed finalizer, or
a stale transaction cannot produce an activated Maker.

Recovery is forward-only and query-first. A source change may explicitly mark
a DRAFT abandoned, but cannot roll back its append chain or delete shared
registries. Abandoned DRAFTs never emit discovery events.

## Lifecycle and authority

Public lifecycle is `ACTIVE`, `PAUSED`, or terminal `ARCHIVED`. Only the exact
AdminCap/current owner may change it. Resume revalidates the enabled protocol,
all required registry bindings and the current ownership epoch. Archive is
irreversible for that Root; continuing publication requires a new v8 version.

Ownership transfer and resale increment the Root ownership epoch and update
the exact owner/control authority atomically. Old-epoch capability proofs are
invalid.

## Access, rights and commerce

There is no optional Commerce migration layer. These fields are part of every
Root, including a free Maker:

- Maker access: `FREE` or `PAID` with exact atomic price;
- Complete policy: free/paid, optional per-wallet quota and total cap;
- rights origin and explicit creator confirmation;
- Soul creator, Maker source and Maker resale royalties;
- payment coin, protocol fee split, collected/withdrawn balances;
- Pack access policies and entitlement counts.

Free access issues or recognizes an exact v8 Pass without a fake paid receipt.
Paid access requires a verified payment and v8 entitlement. Player and export
read these policies from the Root and never infer them from a disabled gate.

## Composition, Pack, Complete, Seal and Physical

- Composition stores the exact v8 wardrobe slots, capacity, admitted Item
  identities, owned selections and recovery-safe unlock/transfer paths.
- Pack releases bind the exact Root/version/epoch, manifest and Style rows.
  FREE and PAID Pack Passes, pause/resume/archive and revenue are native v8.
  The Maker's initial Pack registry is immutable after Root activation; adding
  a new Pack requires a new MakerRootV8 version. Each Pack has its own exact
  AdminCap/Treasury and its Pass binds Root, ownership epoch and content.
- Complete authorizes one exact rendered Recipe/content commitment and creates
  a v8 completion receipt. The final PNG is available according to the Root's
  Complete policy, not according to a v5 receipt or legacy bypass.
- Seal coverage is required for every protected paid Style/Complete payload.
  Unprotected free assets use an explicit empty policy, never an ambiguous
  missing field.
- Physical records bind exact Style content and support materialize, consume,
  transfer and recovery without referencing v7 objects.

Composition loadout updates use revision CAS. An ownership-epoch change cannot
silently reuse an old loadout; stale selections are explicitly cleared and
then rebound. Complete authorizations are non-store, non-copy and non-drop,
and bind the exact Root triple, loadout revision, Pack access, Recipe and render
commitment.

If an implementation is not ready to enforce one of these capabilities, the
v8 authoring UI MUST remove that capability. It may not expose a control that
will later be rejected by a hidden old-version gate.

## Web cutover

Production runtime has one `makerV8ReleaseEnabled` gate and one complete tuple:
callable package, TypeOrigin package, ProtocolConfig, protocol Treasury,
payment coin, required module identities, Seal identity and Soul proof.

When the v8 gate is enabled:

- all old product gates are required to be false;
- new publication uses only the v8 recovery controller;
- public discovery scans only the exact stable-TypeOrigin
  `MakerV8Activated` event and re-reads the exact `ACTIVE` Root;
- old `OCMakerPublished`, migration, v5/v6/v7 and old Pack events are ignored;
- old local cache entries and deep links return an explicit unsupported state;
- Creator, Player, cover, export and lifecycle resolve the same immutable v8
  manifest and Root;
- Player never displays internal “Commerce v5” or compatibility messages.

## Durable recovery

Every signed stage persists exact transaction bytes, digest, object refs,
epoch window, gas, signer, stage/sequence and source snapshot before broadcast.
Recovery is query-first and may replay only the identical saved signature. A
finalized failure is terminal for that exact Root version/sequence. Cross-tab
CAS permits only one pending transaction per Root.

The final activation receipt binds all prior stage digests, the activated Root,
Cap, Treasury and registry IDs, event, checkpoint, source commit/tree and
Walrus file hashes. No raw signature or transaction bytes enter public config.

## Cutover and release locks

1. Build/test fresh packages and record exact byte/object sizes.
2. Publish fresh packages and initialize protocol objects with gates off.
3. Read back TypeOrigins, ABI, config, package digests and protocol objects.
4. Publish one controlled v8 Maker and verify every stage and activation.
5. Run Player/export/wallet acceptance against the exact activated Root.
6. Commit a structured activation record and strict live preflight.
7. Deploy a production candidate with the v8 gate still false; verify it.
8. Atomically switch runtime discovery/publication to v8 and keep every old
   gate false. No dual-read or fallback window is allowed.

Any source, package, object, epoch, gas, transaction-byte, commitment, event,
Walrus or runtime drift stops before signing or promotion.

## Required acceptance

- Move negative tests cover partial/out-of-order/duplicate rows, wrong counts,
  hash/manifest/config/payment/cap/owner/epoch drift, missing capability/Seal
  coverage, invalid economics, lifecycle and replay.
- Maximum-size build and Mainnet exact simulations stay within size/gas limits.
- Web tests prove old events/objects/cache never appear and DRAFT is private.
- Publication crash tests cover every stage before/after sign/broadcast/readback
  without replacement signing.
- Player tests cover free/paid Maker, Pack and Complete flows from v8 Root only.
- Strict preflight reads every deployed identity and activated object live.
- No Mainnet signature or broadcast occurs before a separately reviewed exact
  pre-sign lock is frozen.
