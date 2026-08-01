# Animacraft Composable Assets v6

## Release status

Composable Assets v6 is an additive protocol preview built on the reviewed
Commerce & Rights v5 release. It does not replace v5 and it is not enabled on
Mainnet.

```text
Production line
  v5 Maker publication, commerce, Complete and Soul handoff

Additive preview
  v6 Composable Profile, Item Products and revisioned appearance

Mainnet state
  v5 remains authoritative
  every v6 Walrus and Sui write gate is OFF
```

Local authoring, deterministic validation and test fixtures may exercise the
v6 model while the gate is closed. Publishing a v6 companion manifest,
creating a v6 chain object, selling an Item Product or changing a Soul's
appearance must fail closed until the separately reviewed release gate is
enabled.

## v5 and v6 boundary

| Area | v5 — current production contract | v6 — additive preview |
| --- | --- | --- |
| Maker graph | Immutable `Maker → Part → Item → Style → PNG` release | Does not rewrite or replace the graph |
| Rendering | One Canvas, Layer Tracks, transforms, Rules and shared Renderer | Reuses the exact Maker-local rendering contract |
| Player creation | Base, Expansion Packs, Recipe, Complete and encrypted output | Adds a validated Loadout beside the immutable v5 Recipe |
| Commerce | Base/Pack access, Complete policy, revenue, Maker resale and Soul-source royalties | Optional Item Product access and ownership only |
| Soul appearance | Immutable v5 Recipe, Complete output and Genesis image | Adds immutable Genesis Appearance plus revisioned Current Appearance |
| Third-party content | Not part of the v5 Maker graph | Official, Certified and Open Item Products |
| Release state | Current supported production path | All Mainnet write gates remain disabled |

v5 remains the commercial and publication source of truth. A v5 Maker works
without any v6 data. Adding a v6 companion never edits a released Style,
Recipe, Complete output, entitlement, fee snapshot or Soul provenance record.

## Supported v6 scope

v6 contains only these product capabilities:

1. A **Composable Profile** attached to one immutable v5 Maker release.
2. A Maker-local compatibility manifest using the existing Canvas, Layer
   Tracks, Slots, Rules and Renderer.
3. **Official**, **Certified** and **Open** Item Products.
4. An immutable Genesis Appearance and a revisioned Current Appearance.
5. Optional independently owned Item Product instances.

Rental, consumable behavior, durability, enhancement, game attributes and
Bundle Sale are not implemented in v6. They have no product controls, chain
objects, transactions or placeholder enums. The only upgrade reservation is
an opaque `extensionsHash`; v6 assigns it no behavior. Any future capability
requires a new reviewed schema and explicit release gate.

There is no body, skeleton or human-anchor model. Compatibility uses only the
Maker's existing Canvas coordinates, Layer Tracks, Slots, Rules and Renderer.

## Stable terminology

Animacraft already uses Item inside the Maker authoring hierarchy. v6 uses
**Item Product** for separately published compatible content.

| Term | Meaning |
| --- | --- |
| Maker Item | A player-selectable choice inside one immutable Maker Part. |
| Style | The smallest render unit: one PNG plus its render properties. |
| Item Product | A separately identified product that contributes one or more deterministic render components. |
| Component | One PNG-render instruction inside an Item Product; every Component uses an existing Maker Layer Track. |
| Slot | A Maker-local occupancy identity with capacity one. |
| Loadout | The exact set of Item Products equipped to the available Slots. |
| Entitlement | Chain authority permitting one account or Soul to use an Item Product. |
| Owned Item | A separately owned, transferable Item Product instance. |

A Component is not another player-facing hierarchy level. Components in one
Item Product render together; they are not variants or additional choices.

## Composable Profile

One profile belongs to one exact immutable Maker Root. Its public capability
projection is deliberately small:

```text
mode                 Fixed | Composable
loadoutMutable       false | true
thirdPartyAdmission  Disabled | Certified | Open
itemAssetization     false | true
schemaVersion        1
extensionsHash       opaque commitment or empty
```

| Mode | Current Appearance updates | Third-party admission | Independent Item ownership |
| --- | --- | --- | --- |
| Fixed | Rejected | Disabled | Disabled |
| Composable | Allowed after full validation | Creator chooses Disabled, Certified or Open | Creator may enable or disable it |

`Fixed` is the default when a v5 release has no v6 companion. Enabling
Composable behavior creates a new immutable companion for that exact Maker
release; it does not silently change previously minted Souls.

## Maker-local compatibility contract

Compatibility is defined entirely by the target Maker release:

- Canvas width, Canvas height, coordinate convention and pixel mode;
- Renderer version and deterministic render commitment;
- stable Layer Track identities and their back-to-front ordering;
- stable Slot identities, each with capacity one;
- file-format, mask, clip and transform-bound commitments;
- the compiled Rule commitment;
- one complete free fallback Loadout commitment;
- compatibility manifest hash and certified Walrus Blob ID.

The same Renderer contract is used by Creator preview, Player Wardrobe,
thumbnail, export and published output. An Item Product cannot introduce a
second coordinate system or a private drawing order.

### Placement invariant

Every Component commits to the full source PNG dimensions and an explicit
Maker-local transform:

```text
assetWidth, assetHeight
x, y
uniform scale
rotation
opacity
blendMode
layerTrackId
```

The Renderer uses those values exactly. Transparent bounds may be used for a
thumbnail or diagnostic, but never to reposition, crop or resize the source
art. Runtime rendering must not infer a new position or scale.

## Item Product trust model

Every Item Product has one immutable origin class. The Walrus manifest's
`originClass` is mirrored by `ItemProductV6.origin_kind` on Sui and by the
`ItemProductPublishedV6` event. The class describes endorsement, not whether
validation happened.

| Origin | Publisher relationship | Maker endorsement | Technical validation |
| --- | --- | --- | --- |
| Official | Current Maker control authority | Yes | Required |
| Certified | External Item creator | Yes | Required |
| Open | External Item creator | No | Required |

**Open means validated but not endorsed. It never means unchecked.**

Admission is Profile-scoped, but it cannot reclassify a Product. Official,
Certified and Open entry points each require the Product's immutable
`origin_kind` to match the resulting `AdmissionRecordV6.source_kind`. Open
admission may be relayed permissionlessly after validation; the relay cannot
turn a Certified-intended Product into Open because its origin is already
frozen in the Product object.

Technical validation binds the exact Maker Root, compatibility manifest,
Renderer, Canvas, Layer Tracks, Slot, content hashes and safety limits. A
missing, failed or mismatched validation receipt fails closed before
the content reaches Player rendering or publication.

| Admission policy | Allowed origins |
| --- | --- |
| Disabled | Official only |
| Certified | Official and Certified |
| Open | Official, Certified and Open |

Maker transfer changes who can administer future endorsements. It does not
rewrite an Item Product creator, treasury, origin, validation receipt or
already-issued entitlement.

An Official Item records the current Maker operator that actually publishes
that Item as both publisher and original Item creator. The Maker Root keeps
its own earlier provenance separately, so transferring a Maker never
misattributes a newly created Item to a previous operator.

### Recoverable publication order

One v6 release is deliberately split into a usable Maker-controlled base and
optional third-party admissions:

```text
certify exact companion bytes on Walrus
→ create the unsealed Profile
→ publish and validate Official base Items
→ seal the Profile
→ admit Official base Items
→ for each dependency-ordered external Item:
     publish → validate → admit
```

Official Items may require or exclude other Official Items, but cannot point
at a Certified or Open Item. The external Item must carry that relationship.
This prevents an unavailable external publisher or validator signature from
blocking the Maker-controlled base forever. Third-party Item rules must form
an acyclic dependency graph because every on-chain rule target is admitted
first.

If the process stops before sealing and no Item was admitted, the current
Maker operator can cancel the incomplete Profile and release the root's
one-profile reservation. A sealed Profile is never cancellable through this
recovery path. Every step is checkpointed against the exact Maker Root,
version, base manifest hash, companion hash and transaction readback.

### Validation and admission emergency controls

- Validator authority is bound to one exact on-chain Cap object, policy
  commitment and monotonically increasing epoch.
- Validator rotation is possible only while the v6 protocol gate is disabled.
  Rotation creates a new Cap and makes every previous Cap unable to issue a
  current attestation, even if an old Cap remains in a wallet.
- A protocol administrator may deactivate one admitted Item while either v5
  or v6 is paused. This contains a bad asset without reopening publication or
  disabling unrelated Items.
- Reactivation requires both gates to be live and a matching attestation from
  the current validator epoch. The Player hydrator rejects inactive admissions
  and stale validator epochs before rendering or offering an action.

## Item Product manifest

One immutable Item Product definition commits to:

- target Maker Root and Composable Profile;
- product ID, version, creator and immutable on-chain `origin_kind`;
- compatibility manifest hash and validation receipt;
- exactly one occupied Maker Slot;
- required and excluded Item Product IDs;
- `ONCHAIN_NATIVE` or `LICENSE_WRAPPED` rights origin;
- Rights Manifest hash;
- access and binding policy;
- exact manifest, content and thumbnail hashes plus Walrus Blob IDs;
- schema version and opaque `extensionsHash`.

Its Walrus manifest carries the deterministic player and Renderer payload:

```text
display
  name
  description
  thumbnail Blob ID + hash

components[]
  stable component ID
  source PNG Blob ID + hash
  source PNG width + height
  Layer Track ID
  explicit transform and appearance values
  optional immutable base Part / Item / Style reference
```

All Components in a product render together. A product occupies one Slot
regardless of Component count. Different player-selectable variants must be
separate Item Products or existing Maker choices, never hidden inside the
Component array.

## Access and optional independent ownership

| Form | Chain truth | Transfer behavior |
| --- | --- | --- |
| Embedded | Included in the Maker fallback or public catalog | No separate asset |
| Account licensed | Perpetual account entitlement | Does not follow a transferred Soul |
| Soul bound | Perpetual entitlement bound to one Soul | Follows that Soul |
| Owned | One separately owned Item instance | Transferable only while unequipped |

Independent Item ownership is optional at the Maker profile level. When it is
disabled, the protocol does not create or imply owned instances. Inventory is
always derived from actual entitlement or ownership objects.

An Item Product may be embedded, free to claim or sold once for perpetual
use. v5 remains authoritative for Base, Expansion Pack and Complete economics.
Item Product settlement is a separate v6 path and remains disabled while the
v6 Mainnet gate is off.

## Genesis and Current Appearance

```text
Soul
├── GenesisAppearanceV6
│   └── immutable creation Loadout commitment
└── SoulAppearanceStateV6
    ├── revision                 strictly increases by one
    ├── currentLoadoutHash
    ├── slotSchemaCommitment
    ├── extensionsHash
    └── transferSafe
```

The v5 Recipe, v5 Complete output and Genesis image remain immutable. A
Wardrobe action updates only Current Appearance. Fixed profiles use the same
companion shape but reject updates and remain at revision zero.

v6 does not add a second mutable PNG or Walrus output protocol. Chain state
binds the exact profile, Soul, revision, canonical Loadout, Slot schema,
extension commitment, authorizer and transfer-safety result. The immutable
Item Product and Maker companion manifests already bind the source assets on
Walrus, so the shared Renderer derives the same visual from those commitments.

## Wardrobe validation and atomic update

Before previewing or equipping a product, the client and protocol validate:

1. exact Maker Root and Composable Profile;
2. origin allowed by the profile's admission policy;
3. current technical validation receipt;
4. compatible Canvas, Renderer, Layer Tracks and Slot;
5. one Item Product per Slot;
6. requires and excludes over the complete Loadout;
7. an applicable embedded right, entitlement or owned instance;
8. a complete free fallback Loadout.

One successful Current Appearance update must verify the current Soul owner,
ownership epoch and expected revision; reject a listed Soul; revalidate every
right and Loadout rule; update owned-Item equip locks; consume the exact
Animacraft authorization in Soulidity; advance the revision exactly once; and
commit the authorized Loadout. Any failure rolls back the complete
transaction. The existing v5 Complete output remains the immutable finished
image and provenance record.

## Transfer safety

- A listed Soul cannot change Current Appearance.
- A Soul listing must bind the current appearance revision, ownership epoch
  and Loadout hash.
- Embedded and Soul-bound rights may remain with a transferred Soul.
- Account licenses and separately owned Items do not follow the Soul.
- A Soul must return to a transfer-safe Loadout before listing when its
  current rights do not follow it.
- An equipped owned Item cannot be transferred; a successful Wardrobe update
  must release it first.
- Every valid profile commits to a complete free fallback Loadout.

## Economics boundary

Commerce & Rights v5 remains unchanged and authoritative for Maker access,
Expansion Packs, Complete charges, Maker treasury, Maker resale and
Soul-source royalties.

When the separately reviewed v6 Item sale gate is eventually enabled, one
Item Product primary sale settles exactly once:

```text
player payment
├── Animacraft protocol fee
├── optional capped Maker ecosystem fee
└── Item creator proceeds
```

The signed quote binds the definition version, product ID, price, fee snapshot,
target profile and buyer. Item revenue does not enter Soul resale settlement
merely because the Soul currently equips that Item. Maker transfer does not
transfer a third-party Item treasury.

## Upgrade rules

- A v5 Maker without a v6 companion behaves as Fixed.
- A Composable Profile is pinned to one immutable Maker Root.
- Publishing another Maker version does not mutate the previous profile,
  Item Products, Souls or entitlements.
- A later profile may stop future admission without deleting historical
  products or rights valid for an older release.
- Emergency deactivation stops new use of one admission without mutating the
  immutable Item Product; reactivation is a separately authenticated action.
- `extensionsHash` is only an opaque commitment. It is not a hidden feature
  flag and assigns no v6 behavior.
- New behavior requires a versioned schema, reviewed Move changes, explicit
  migration rules and a separate release gate.

## Mainnet gates and promotion evidence

| Capability | Current state |
| --- | --- |
| Publish Composable Profile companion to Walrus | OFF |
| Create or seal Composable Profile on Sui | OFF |
| Publish Official, Certified or Open Item Product | OFF |
| Create validation receipt or endorsement | OFF |
| Claim or purchase Item Product | OFF |
| Create Genesis/Current Appearance companion | OFF |
| Update Current Appearance | OFF |
| Create or transfer independently owned Item | OFF |

Promotion requires exact cross-package revision pins; passing JavaScript,
Move, manifest, Renderer and negative gate tests; testnet evidence for every
origin and transfer-safety path; independent security review; reviewed runtime
and deployment records; and a separately approved Mainnet gate change.

Until then, production UI must describe v6 as a preview, must not request a v6
wallet signature, and must not imply that v6 content was published, purchased
or equipped on chain.

## Creator and player checklist

### Creator

- Keep the v5 Maker complete and playable without v6.
- Define stable Maker-local Slots and a complete free fallback Loadout.
- Verify every Component against the exact Canvas, Layer Track and Renderer.
- Treat Official and Certified as endorsements only after validation succeeds.
- Label Open content as unendorsed while still requiring validation.
- Test the same committed Loadout in Creator preview, Player Wardrobe and
  export before staged publication.

### Player

- The origin badge explains endorsement, not validation status.
- Disabled content states whether admission, validation, compatibility,
  rights, Slot occupancy or Rules caused the rejection.
- Wardrobe never exposes Layer Track or transform editing to the player.
- Removing incompatible rights offers the committed free fallback.
- Genesis and Current Appearance are displayed as separate records.
