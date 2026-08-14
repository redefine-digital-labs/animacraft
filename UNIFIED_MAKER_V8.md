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

Animacraft v8 is one product release assembled from several fresh, immutable
v8 packages. The split is mandatory: the first semantic prototype measured
89,205 bytes before the missing runtime, decrypt and market behavior was added,
leaving only 795 bytes below the internal safety ceiling. Increasing the size
ceiling or leaving those behaviors as manifest promises is not acceptable.

The dependency graph is acyclic and frozen as follows:

1. `animacraft_v8_core`: ProtocolConfig, MakerRoot, AdminCap, Treasury, base
   definition registries, immutable rights/economics and DRAFT lifecycle;
2. `animacraft_v8_seal` -> Core: ciphertext identity, key-server policy and
   entitlement-bound decrypt approvals;
3. `animacraft_v8_runtime` -> Core + Seal: canonical loadouts, external Item
   admission/ownership and Expansion Pack releases/access;
4. `animacraft_v8_output` -> Core + Seal + Runtime: Complete policies,
   instance Recipe/render authorization, receipts and Canonical Soul;
5. `animacraft_v8_physical` -> Core + Runtime + Output: proof-bound physical
   materialization and holder-safe custody/transfer/consume;
6. `animacraft_v8_market` -> the asset-defining packages: fixed-price USDC
   escrow and native protocol/creator/source/resale settlement;
7. `animacraft_v8_release` -> all required packages: the only final activation
   orchestrator and the only emitter of `MakerV8Activated`.

Core imports no companion. Each asset-defining package owns its private state
and exposes only capability-gated hooks; Market and Release cannot edit fields
through generic object access. Every dependency is bound by an immutable
`ProductReleaseBindingV8` containing original TypeOrigin, callable package,
config/treasury object IDs where applicable, source/package digest and ABI
commitment. A binding is set at most once while the Root is DRAFT. Final
activation consumes non-forgeable readiness witnesses from every required
package and verifies the complete binding tuple again.

All packages still expose public protocol version `8`. They are not separate
product versions, fallbacks or compatibility layers. No v8 package imports an
old Animacraft package for protocol semantics. Every package has its own exact
`MovePackage::size()` CI gate and must retain at least 10,000 bytes below the
102,400-byte Mainnet limit; Core and Release should remain substantially
smaller so a security fix never depends on the final few hundred bytes.

### Release-blocking implementation status

The current prototype package is **not** a releasable unified v8 merely
because its publication commitments and Move tests pass. A semantic audit of
the first 89,205-byte build found that Composition behavior/source values,
exact Style/Smart Color loadouts, equipped Pack selections, decrypt approval,
and parts of Physical/market execution were not enforced at runtime. Those
fields are release blockers, not optional follow-ups.

At 89,205 bytes the prototype also has no honest room to add the missing
runtime semantics while preserving the 90,000-byte safety budget. The next
implementation MUST either free material space first or split fresh v8
modules behind immutable TypeOrigin/config/callable bindings. It MUST NOT
compress required behavior into opaque manifest promises or raise the safety
budget merely to keep a one-package diagram. Multiple fresh v8 packages may
form one product; compatibility reads or replaceable package bindings may not.

## Canonical objects

Every publication has exactly these authoritative objects across the bound v8
packages:

- shared `MakerRootV8<PaymentCoin>`;
- creator-owned `MakerAdminCapV8`;
- shared `MakerTreasuryV8<PaymentCoin>`;
- shared per-Maker Runtime/Pack, Complete/Soul and Seal registries, even when
  their row count is zero;
- shared Physical and Market bindings/registries even when a Maker has no
  Physical policy rows or active market listings;
- immutable `ProductReleaseBindingV8` and per-package readiness records which
  bind the precise package/config/callable tuple used for this Root.

The Root commits to:

- protocol and package identity;
- creator, current owner, AdminCap and Treasury IDs;
- lifecycle and ownership epoch;
- immutable Maker/version lineage and renderer identity;
- Walrus manifest Blob/Quilt identity and SHA-256;
- content and final registry commitments;
- expected and observed counts for immutable Tracks, Parts, Items, Styles,
  Smart Color channels/swatches, rules, initial slots and protected base
  assets; mutable post-activation Pack/admission/listing state is bound by its
  own registry ID, revision CAS and event/readback history rather than frozen
  into the base content commitment;
- Maker access, Complete policy, rights origin, creator/source/resale royalty,
  payment type and protocol fee policy;
- Composition, Pack, Complete, Seal, canonical Soul, Physical and Market
  capability bindings. These are one required product tuple for every v8
  Root; an empty policy/listing registry does not disable the capability.

Published rows use canonical v8 keys and are never updated in place. A new
published version creates a new Root whose immutable lineage points to the
previous v8 Root/version commitment.

Every registry stores version, Root ID, ownership epoch, Root content
commitment, expected and observed counts, expected and rolling commitments,
and a sealed bit. Empty registries use a domain-separated empty commitment;
an empty byte vector is never treated as proof of completeness.

### Creator row contract

The chain rows preserve the established outer Creator ownership model; v8 does
not invent a second editor schema:

- a Track owns draw order and has no inferred `required` flag;
- a Part owns Player menu order, required/optional state and Item membership,
  but does not own or invent a Track reference;
- an Item owns its Style membership;
- each Style binds its exact Layer Track and may bind one Smart Color channel
  together with that channel's exact default swatch. Channel and default
  swatch are either both absent or both present;
- final activation enumerates every Style and verifies its Track and optional
  channel/default-swatch dynamic fields against the sealed registries.

The author document is a chain-free semantic source, not a partially compiled
transaction manifest:

- every object is exact-shape allow-listed and unknown fields fail closed;
- authors never enter Root/object/package IDs, transaction or Blob IDs,
  ciphertext/Seal IDs, SHA/registry/payload commitments, predecessor Root
  evidence, entitlement proofs or concrete future Player Pack selections;
- all native v8 capabilities (Composition, Pack, Complete, Seal, Soul,
  Physical and Market) are derived as enabled. A Maker may declare zero
  Physical policies or protected assets, but the product capability cannot be
  switched back to an older protocol surface;
- Maker-wide composition reuses the established Creator vocabulary
  `mode: FIXED|COMPOSABLE`, `thirdPartyAdmission:
  DISABLED|CERTIFIED|OPEN`, `itemAssetization: boolean`, plus each Part's
  `wardrobeMode: FIXED|SLOT`. Runtime source/behavior enums and INCLUDED base
  Item gates are compiler-derived, never duplicate author controls;
- Expansion Packs are independent v8 author documents and are admitted after
  Maker activation. They are not embedded in the base Maker document. A
  Complete output may allow all currently admitted Packs or a canonical
  sorted list of semantic Pack namespaces/scopes, but never one player's
  concrete selection;
- the compiler accepts certified transport bytes, live predecessor readback
  and package/config bindings through a separate trusted context, derives all
  commitments itself, and proves that none were authored.

The canonical compiler binds the richer Creator payload (gradient stops,
nested visibility/combination rules, transforms, wardrobe semantics and
render metadata) in deterministic payload commitments and the immutable
manifest. On-chain index rows may not silently drop or reinterpret those
semantics.

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
   Commitment preimages contain the protocol version, immutable Root content
   commitment and stable semantic row/scope keys. They MUST NOT contain an
   object ID first created by the same transaction that records the expected
   commitment, because that would create an uncomputable fixed-point. Actual
   Root, registry, Release and scope object IDs plus ownership epoch remain
   mandatory object fields and are checked on every append, seal, resume and
   final activation; they are not replaced by semantic keys.
3. Required capability bindings, including the canonical Soul registry, are
   created against the exact Root and current ownership epoch. A zero-row
   registry is still explicitly bound.
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
- Complete policy is one exact native mode: unlimited free, free quota then
  paid, paid every time, or free quota then blocked, with per-wallet and total
  counters enforced atomically;
- rights origin and explicit creator confirmation;
- Soul creator, Maker source and Maker resale royalties;
- payment coin, protocol fee split, collected/withdrawn balances;
- Pack access is free, one-time paid, or included with Maker access. Every Pack
  also has its own native four-mode Complete policy and exact wallet/total
  counters; these are not manifest-only annotations;
- protocol terms include primary-content fee BPS, fixed Complete fee, Maker
  market fee BPS and Soul market fee BPS, all committed in ProtocolConfig.

Free access issues or recognizes an exact v8 Pass without a fake paid receipt.
Paid access requires a verified payment and v8 entitlement. Player and export
read these policies from the Root and never infer them from a disabled gate.
For one Complete, the base policy and every used Pack policy produce line
items. Their content fees are summed, the primary protocol share plus fixed
Complete fee go to ProtocolTreasury, and the remaining content amount goes to
MakerTreasury. PackTreasury receives Pack access purchases, not Complete line
items. The chain quote, wallet UI and readback must compute the same tuple.

All three royalty fields are native v8 values from 0–1,000 BPS in 50-BPS
steps, with Soul-creator plus Maker-source royalties capped at 1,000 BPS.

## Composition, Pack, Complete, Seal, Soul and Physical

- Composition stores the exact v8 wardrobe slots, capacity, admitted Item
  identities, owned selections and recovery-safe unlock/transfer paths.
  A current loadout is a canonical ordered state, not a mutation-history hash.
  Every selection identifies the exact slot, Part, Item, Style, optional Smart
  Color channel/swatch, asset/content commitment, source/product identity and
  access subject. Equal final selections reached through different edit
  histories MUST have the same commitment.
- A Part's established Creator `wardrobeMode` remains `FIXED` or `SLOT`.
  `FIXED` means the Part cannot accept independent third-party gear; it does
  **not** mean the Player is stuck on one Style. The Player may still choose
  among the Maker's base Items/Styles and officially admitted Maker Pack
  Styles for that Part. `SLOT` additionally admits external Item products
  according to the Maker-wide `thirdPartyAdmission` ceiling. The runtime may
  encode internal source classes such as Soul-local/certified/open, but those
  are compiler-derived enforcement values, not a second set of Creator UI
  controls. Certified/open labels without an attestation, admission state,
  ownership/access proof and exact asset binding are invalid.
  Post-activation Item products and their admission/revocation state are
  separate from the sealed Maker definition registry.
- Pack releases bind the exact Root/version/epoch, manifest and Style rows.
  FREE and PAID Pack Passes, pause/resume/archive and revenue are native v8.
  A Pack is a real post-activation extension: the Maker's bound Pack registry
  remains mutable under revision CAS and exact admission authority, so an
  independent Pack can be published later without rewriting immutable base
  content or creating a new Maker version. Each Release has its own immutable
  content commitment, exact AdminCap/Treasury and lifecycle; admission binds
  the current Root/version/ownership epoch and the registry records every
  revision. Removing or archiving a Pack never rewrites old receipts.
- A Pack Style becomes part of the canonical loadout before Complete. Its
  transaction-local access proof binds the exact loadout ID, revision and slot
  in addition to the Release/Style/holder tuple. Complete accepts exactly one
  current proof for each equipped Pack selection and rejects proofs for
  unequipped Styles. Used-Pack fees are derived from that loadout, never from
  an unrelated caller-supplied list.
- Complete authorizes one exact rendered Recipe/content commitment and returns
  a non-store, non-copy, non-drop `SoulMintAuthorizationV8`. In the same PTB,
  `soul_v8` alone consumes that proof, records its one-time receipt and creates
  the canonical `CanonicalSoulV8`. The proof binds the exact Root, ownership
  epoch, content commitment, holder, Complete output, Recipe, render and
  authorization commitment. It cannot be replayed, persisted, substituted or
  used while the Root is paused or archived. The final PNG is available
  according to the Root's Complete policy, not according to a v5 receipt or
  legacy bypass.
- A Complete output commits an allowed Recipe policy and allowed Pack scopes;
  it does not freeze one future player's concrete Pack selection. The runtime
  derives the exact base/Pack/Smart Color selection vector and charges from the
  current canonical loadout.
- Seal coverage is required for every protected paid Style/Complete payload
  and binds certified ciphertext/blob identity plus an immutable key-server
  policy. Approval verifies the exact Maker/Pack entitlement or Complete/Soul
  ownership. A protected Complete must bind its dynamic Recipe/render instance
  (or a family policy that verifies that exact receipt); a static renderer
  schema hash is not decrypt authorization. Unprotected free assets use an
  explicit empty policy, never an ambiguous missing field.
- Physical records bind exact Style content and support proof-bound claim or
  materialization, consume, transfer and recovery without referencing v7
  objects. Pack-backed materialization revalidates the current Release and
  access. `ACTIVE` may gate new mint/equip, but PAUSED/ARCHIVED cannot trap a
  holder: policy-authorized withdraw, transfer or consume remains available.

Root Item gates, rights and market fee fields are executable protocol rules,
not display metadata. Until native Item entitlement exists, only INCLUDED is
valid. Maker/Soul/eligible product resale must route through a pinned fresh-v8
market executor that enforces the exact protocol and creator/source/resale
splits; if that executor is split, its TypeOrigin, config, treasury and
callables are immutable activation dependencies.

Canonical Soul is a required native v8 capability, not an old-package proof or
optional compatibility bridge. Its registry is rebound and revalidated on
ownership-epoch changes alongside every other required registry.

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
the immutable `ProductReleaseBindingV8`, Core/Seal/Runtime/Output/Physical/
Market/Release original and callable package identities, ProtocolConfig,
protocol and market treasuries, payment coin, ABI/source/package commitments,
key-server policy and canonical Soul TypeOrigin/registry identity.

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
