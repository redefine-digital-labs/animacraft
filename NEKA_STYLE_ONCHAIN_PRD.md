# Animacraft: Neka-Style OC Maker + On-chain Creator Economy PRD

## 1. Product Thesis

Animacraft should become a Neka/Picrew-style OC maker where anyone can use creator-made templates to make original characters, and creators can publish reusable character-making kits. The product should make the whole OC production chain on-chain from the most basic creator materials upward: source assets, template manifests, user-generated OC outputs, authorization, paid access, trading, resale, and revenue settlement. The user-facing editor must still feel like a delightful OC editor; the protocol layer should quietly enforce template ownership, material ownership, usage permissions, creator revenue, paid parts, provenance, and resale rules.

The target product is not an NFT marketplace with a character editor attached. It is an on-chain OC production system with a Neka-like editor as the entry point.

## 2. Benchmark Findings

### 2.1 Neka / Picrew Product Pattern

The core pattern is:

- A user picks an image maker/template.
- The maker exposes parts/categories such as face, hair, eyes, clothes, accessories, backgrounds.
- The user combines parts and colors to make an image.
- The output is immediately useful as an avatar, OC reference, profile image, roleplay image, fanwork image, or social-sharing asset.
- Creators upload the parts, set metadata, publish the maker, and define usage conditions.

Picrew describes itself as a platform with two sides: users can play with image makers, and creators can make image makers with their own illustrations. Its support docs emphasize that creator setup does not require programming knowledge, and that creators can publish a maker for many people to use. Sources: [Picrew Support top page](https://support.picrew.me/en/), [How to create an image maker](https://support.picrew.me/en/create_imagemaker).

### 2.2 Creator Tool Structure

Picrew's creator function list is a strong proxy for the needed feature set:

- register as creator
- create a new image maker
- edit maker name/description
- add parts
- configure part settings
- sort part icons
- add colors
- add layers
- sort layers
- add items
- configure item settings
- upload item images/icons
- set part rules
- set item rules
- link colors across parts
- release image maker / change publication scope

Source: [Picrew Function List](https://support.picrew.me/en/functions_top).

### 2.3 Safety, Rights, and Moderation

Picrew's public rules show that a creator platform needs built-in controls for:

- creator/material/image definitions
- sensitive content flags
- prohibited content categories
- third-party IP and derivative work handling
- watermark/signature requirements for derivative works
- AI-generated image disclosure/tagging
- commercial / non-commercial / personal-use distinctions

Sources: [Picrew Guidelines](https://support.picrew.me/en/picrewguidelines), [Picrew Terms of Use](https://support.picrew.me/en/terms).

## 3. Animacraft Product Position

Animacraft should be a standalone creator product with three layers:

1. OC maker experience: fast, pretty, playful, and understandable without Web3 context.
2. Creator studio: template publishing, layer management, asset validation, pricing, permissions, and creator onboarding.
3. Protocol layer: registers and enforces source assets, templates, OC outputs, licenses, paid access, grants, trades, and settlement through Soulidity contracts.

The product promise:

> Make OC creation as easy as Neka, but make every economically meaningful object and permission in the OC lifecycle enforceable on-chain.

### 3.1 Product Flywheel

The product loop is:

```text
Strong creators publish high-quality OC templates
  -> players use templates to make finished OCs
  -> finished OCs are used, displayed, licensed, traded, or commissioned
  -> transactions generate creator/material/platform revenue
  -> more creators publish better templates and materials
  -> the template library becomes more valuable
```

This flywheel only works if the authorization and revenue relationships survive outside a single Web2 database. That is why the protocol should record materials, template versions, OC outputs, licenses, access proofs, and trades on-chain.

## 4. Infrastructure Thesis: Why Sui + Walrus Fits

The OC creator economy needs two kinds of infrastructure at the same time:

1. Object-level ownership, rules, permissions, trading, and settlement.
2. Durable storage for large creative assets such as PNG layers, icons, manifests, rendered images, and source files.

Sui and Walrus together cover this split cleanly.

### 4.1 Sui Responsibilities

Sui should be the rule and ownership layer.

It is responsible for:

- creator identity and wallet ownership
- material asset records
- template objects and template versions
- generated OC ownership
- license proofs
- paid access entries
- commercial license purchase proofs
- listing / buying / canceling
- creator royalty and platform fee settlement
- provenance references
- grants and scoped permissions
- collection/drop rights

Why this matters:

- OC assets are not just files; they are objects with ownership, rights, and trading behavior.
- Sui's object model maps naturally to materials, templates, OCs, listings, access proofs, and grants.
- Rules can be enforced at transaction time instead of relying only on platform promises.

### 4.2 Walrus Responsibilities

Walrus should be the content layer.

It is responsible for:

- source PNG layers
- icon/thumbnail assets
- template manifests
- material manifests
- rule configs
- palette configs
- rendered OC images
- recipe JSON
- license snapshot JSON
- large creator source files when needed

Why this matters:

- Creative assets are too large and too numerous to store directly inside Move objects.
- The chain should store object ids, blob ids, hashes, versions, and permissions.
- Walrus stores the actual content while Sui enforces who can reference, trade, access, or update it.

### 4.3 Soulidity Responsibilities

Soulidity should become the OC protocol layer on top of Sui + Walrus.

It should connect:

- Sui object ownership
- Walrus content blobs
- typed content kinds
- creator royalty rules
- paid access rules
- market trading
- grants
- collection/drop flows
- provenance from material to template to generated OC

The key product insight:

> The infrastructure is already strong enough. The missing layer is the OC-specific protocol and creator tool that turns files, templates, permissions, and trades into one coherent lifecycle.

### 4.4 Resulting Architecture

```text
Animacraft Editor
  - browse templates
  - make OC
  - creator setup
  - asset pack validation

Soulidity OC Protocol
  - material registry
  - template registry
  - OC minting
  - license/access proofs
  - market/royalty settlement

Sui
  - object ownership
  - transaction enforcement
  - listings and payments
  - grants/access/royalties

Walrus
  - PNG layers
  - manifests
  - rendered images
  - source files
```

## 5. Protocol User Roles

Animacraft has normal product users, but the protocol needs more precise role definitions. One wallet can hold multiple roles.

### 5.1 Visitor

Unauthenticated user browsing templates and example works.

Can:

- browse public templates
- view public example outputs
- inspect visible license summaries
- start a local preview session if the template allows public preview

Cannot:

- register materials
- publish templates
- save chain-backed OC outputs
- buy paid access
- trade assets

Protocol state:

- no owned object required
- reads public indexed data and public content slots

### 5.2 OC Maker / Player

Wallet user who creates OC outputs from templates.

Can:

- choose public templates
- select free parts
- buy access to paid parts
- create a recipe
- mint a generated OC as `Soul`
- download allowed rendered outputs
- buy commercial license if available

Owns / receives:

- `OCRecipe` content
- generated `Soul`
- license snapshot/proof
- paid access entries
- commercial license proof if purchased

Cannot:

- edit creator source materials
- change template rules
- bypass paid parts
- mint an OC recipe that fails template rules

Protocol enforcement:

- recipe validation against template version
- paid access check for locked parts
- license snapshot attached at mint
- provenance points to template/material versions

### 5.3 Creator / Artist

Artist or template author who provides original materials and templates.

Can:

- register creator profile
- register source materials
- upload content-addressed PNG/icon/manifest blobs
- assemble templates from registered materials
- publish template versions
- configure free/paid/commercial permissions
- configure paid part packs
- receive royalties and sales revenue
- deprecate materials or publish new versions

Owns / controls:

- creator profile
- `TemplateMaterial`
- `CreatorTemplate`
- `TemplateVersion` publish authority
- license policies
- paid access configuration
- creator royalty receiver

Cannot:

- silently mutate an already-published immutable template version
- revoke a buyer's already-minted OC ownership
- remove on-chain provenance
- retroactively alter license snapshots attached to minted outputs

Protocol enforcement:

- material registration records creator address
- template version snapshots freeze material refs/rules/license
- creator royalty BPS is captured in mint/listing flows
- paid access config determines locked material access

### 5.4 Material Owner

The wallet that owns a registered source material. Usually the creator, but this may diverge if template/material rights become transferable.

Can:

- register material versions
- mark material active/deprecated
- grant usage to templates
- receive material-level revenue if configured

Owns / controls:

- `TemplateMaterial`
- material content pointer/hash
- material usage policy

Important distinction:

- creator attribution and material ownership may not always be the same. The protocol should preserve both.

### 5.5 Template Publisher

Wallet or organization authorized to publish template versions. This may be the creator, a studio, or a managed publishing account.

Can:

- assemble materials into a template
- publish immutable template versions
- set template visibility
- submit template for review
- configure template-level paid access

Owns / controls:

- template publish cap or admin authority
- publish state
- version history

Cannot:

- use materials without material-owner permission
- alter a published version in place

### 5.6 Buyer / Collector

User buying OC outputs, commercial rights, paid part access, or potentially template rights.

Can:

- buy premium part access
- buy commercial license
- buy/resell minted OC `Soul`
- buy collection/drop rights
- hold access proofs

Owns / receives:

- paid access entry
- license proof
- purchased `Soul`
- collection rights if relevant

Protocol enforcement:

- market listing/buy/cancel
- creator royalty and platform fee
- paid access validity by ownership epoch/duration
- transfer rules through Kiosk/policy

### 5.7 Commissioner / Brand Partner

User or organization commissioning exclusive or campaign-specific templates/OCs.

Can:

- fund a creator template or OC commission
- receive exclusive license proof
- receive campaign/drop rights
- co-own collection/drop revenue if supported

Owns / receives:

- commission agreement proof
- exclusive license proof
- branded collection/drop rights

Protocol needs:

- scoped grants
- collection-level royalty split
- private preview access
- campaign publish window

### 5.8 Curator / Moderator

Platform or DAO role responsible for public marketplace quality and legal/safety response.

Can:

- approve/reject public template listing
- label sensitive content
- hide/suspend public discovery
- respond to infringement reports
- maintain template plaza indexes

Cannot:

- erase immutable on-chain history
- seize user-owned OCs without explicit protocol rule

Protocol needs:

- review status on template/public index
- off-chain moderation evidence
- event logs for status changes
- emergency pause/suspension surfaces where legally necessary

### 5.9 Protocol Admin / Governance

Maintains protocol configuration.

Can:

- configure platform fee
- pause market if needed
- add/update content kind descriptors
- manage registry settings
- upgrade protocol modules under governance rules

Owns / controls:

- admin cap
- market config
- kind registry config
- fee recipient

Risks:

- must be minimized and made transparent because this role can affect economic flows.

### 5.10 Indexer / Renderer / Storage Operator

Infrastructure role that reads chain events and serves UX-critical data.

Can:

- index templates/materials/OC outputs
- render recipe images
- cache thumbnails
- mirror Walrus/blob availability
- provide search and filtering

Cannot:

- become source of truth for ownership, license, or payment state

Protocol needs:

- complete events for material registration, template publish, OC mint, access purchase, license purchase, listing, sale, and revenue settlement.

### 5.11 Role Summary Matrix

| Role | Primary goal | Owns/controls | Key protocol actions |
| --- | --- | --- | --- |
| Visitor | Discover templates | none | public reads |
| OC Maker | Create OC | OC recipe, generated Soul, license snapshot | buy access, mint OC |
| Creator / Artist | Publish and earn | materials, templates, policies | register material, publish template, configure paid access |
| Material Owner | Control source assets | material records | version/deprecate/grant material usage |
| Template Publisher | Release usable makers | template versions | assemble/publish template |
| Buyer / Collector | Buy assets/rights | access proof, license proof, Soul | buy part pack, license, OC |
| Commissioner / Brand | Fund exclusive work | commission proof, collection rights | fund, receive exclusive license/drop |
| Curator / Moderator | Keep public plaza safe | review state/index state | approve, hide, suspend discovery |
| Protocol Admin | Configure protocol | admin caps/config | fee, pause, registry config |
| Indexer / Renderer | Make chain state usable | cache/index only | render, index, search |

## 6. Core Product Modules

### 6.1 Template Plaza

Purpose: discovery, not editing.

Requirements:

- template card grid
- style category filters
- creator name
- cover image
- example works
- license badge
- part count
- usage count
- start-making CTA

Avoid:

- side detail panels
- developer JSON
- long Web3 explanations
- creator onboarding content

### 6.2 Make OC Editor

Purpose: primary Neka-like creation surface.

Requirements:

- slot/category rail: background, body, face, hair, eyes, mouth, clothes, accessories
- canvas preview
- part grid for selected slot
- color picker / palette groups
- variant support
- remove/none option where allowed
- simple save/export
- recipe capture hidden under details

Advanced Neka/Picrew-like requirements:

- part order/layer order
- color link groups
- part rules: selecting one item can hide/disable another
- item rules: item dependencies and exclusions
- randomize only if intentionally designed as a playful feature, not as a global ambiguous button
- preview examples generated from template recipes

### 6.3 Creator Setup

Purpose: creator-facing template metadata.

Requirements:

- template name
- creator name/address
- description
- tags/category
- cover image
- example works
- license preset
- commercial-use permission
- derivative-work permission
- AI-use permission
- watermark/signature requirement for derivative templates
- creator royalty BPS
- platform fee estimate
- publish state: draft / private preview / public / suspended

### 6.4 Asset Pack Manager

Purpose: material pipeline for artists.

Requirements:

- PNG upload
- transparent background validation
- canvas size validation
- filename convention validation
- slot mapping
- item mapping
- icon upload
- layer order preview
- missing slot warnings
- duplicate name warnings
- package export/import

Recommended asset model:

```json
{
  "templateId": "published-maker-id",
  "canvas": { "width": 1024, "height": 1024 },
  "slots": [
    {
      "key": "hairFront",
      "label": "Front Hair",
      "renderOrder": 40,
      "items": [
        {
          "id": "side",
          "label": "Side Bangs",
          "layers": ["hairFront_side_default.png"],
          "colorGroup": "hair",
          "rules": { "requires": [], "excludes": [] }
        }
      ]
    }
  ],
  "colorGroups": [
    { "key": "hair", "default": "#7c3aed", "linkedSlots": ["hairBack", "hairFront"] }
  ]
}
```

### 6.5 Guide / Onboarding

Purpose: help creators ship a first template.

Requirements:

- "minimum viable template" checklist
- sample PSD/PNG package
- naming rules
- layer order guide
- rights/licensing explanation
- common mistakes
- publish review checklist

### 6.6 Advanced / Export

Purpose: developer/protocol bridge.

Requirements:

- recipe JSON
- creator manifest JSON
- OC package JSON
- generated `oc.md`
- Walrus/content upload preview
- contract transaction preview later

This must not be the default surface.

## 7. On-chain Rule Mapping

Soulidity already has useful primitives:

- `soul.move`: `Soul`, `SoulState`, creator, royalty BPS, provenance, state config, ownership epoch.
- `market.move`: mint/list/buy flows, creator royalty, platform fee, Kiosk-based listing.
- `content.move`: `SoulContent`, typed content slots, versioning, read modes, active bindings, Walrus blobs.
- `paid_access.move`: per-kind paid access configs and buyer entries.
- `collection.move`: grouping and collection rights.
- `grant.move`: scoped temporary grants.
- `kind_registry.move`: content kind descriptors and rules.

### 7.1 Full On-chain Lifecycle

The desired architecture is not "local editor first, optional mint later." It is a full on-chain asset lifecycle where every meaningful creation object has a canonical chain record.

```text
Creator source material
  -> On-chain Material Asset / content blob
  -> On-chain Creator Template
  -> User OC Recipe
  -> Rendered OC Output
  -> License / access proof
  -> Trade / resale / paid access
  -> Revenue settlement and provenance
```

#### Stage A: Source Material Registration

The smallest on-chain unit should be the creator material, not only the final OC.

Examples:

- hair layer PNG
- eye layer PNG
- outfit layer PNG
- background PNG
- icon/thumbnail
- color palette config
- rule config
- layer order config

Each material should have:

- creator address
- material hash / blob object id
- material kind
- slot key
- item id
- template association
- license policy snapshot
- version
- status: draft / active / deprecated / removed

Implementation direction:

- binary assets live in Walrus blobs.
- material metadata and rules live in typed `SoulContent` or a new template/material module.
- `kind_registry` should define kinds such as `template_material`, `template_manifest`, `template_rule_config`, `template_palette`, and `template_cover`.

#### Stage B: Template Assembly

A template is an on-chain composition of registered materials and rules.

The template object should prove:

- who created it
- which materials it contains
- which material versions are active
- what slots/items/colors/rules are valid
- what licenses and prices apply
- which paid packs are required for locked items

This means the template manifest is not just a downloadable JSON file. It is the canonical rule package for later OC creation.

#### Stage C: User OC Creation

When a user creates an OC, the recipe should reference:

- template id
- template version
- selected material ids / item ids
- color values
- rule validation result
- license snapshot
- creator royalty snapshot

The rendered OC can then be minted as a `Soul` with:

- `Soul.name` / `Soul.description` / image URL
- `SoulState.creator_royalty_bps`
- `SoulContent` entries for recipe, rendered image, license snapshot, and source template reference
- `origin_ref` or equivalent provenance pointing back to the template

#### Stage D: Authorization

Authorization should be explicit and machine-readable.

Examples:

- personal-use output
- public social sharing
- commercial use for one generated OC
- commercial use for all outputs from a template
- derivative template permission
- AI usage permission
- paid premium parts access

On-chain enforcement can cover:

- who owns which OC
- who paid for which access kind
- which content can be read/downloaded
- which commercial license was purchased
- resale and royalty flows

Off-chain moderation still handles subjective infringement, illegal content, and takedowns.

#### Stage E: Trading and Settlement

Trading should support:

- template sale or subscription
- paid part pack purchase
- commercial license purchase
- OC resale
- collection sale
- creator royalty
- platform fee
- optional extra royalty for collection/brand collaborations

Soulidity already has market listing, creator royalty, platform fee, collection listing, and paid access primitives. Animacraft should map each product purchase to one of these primitives rather than inventing unrelated payment paths.

### 7.2 Proposed Chain Object Hierarchy

```text
CreatorProfile
  └─ CreatorTemplate
      ├─ TemplateMaterial[]
      ├─ TemplateManifest
      ├─ TemplateLicensePolicy
      ├─ PaidPartPack[]
      └─ TemplateVersion[]

OCSoul / GeneratedOC
  ├─ OCRecipe
  ├─ RenderedImage
  ├─ LicenseSnapshot
  ├─ SourceTemplateRef
  └─ Provenance / Parent refs
```

Recommended split:

- `CreatorTemplate`: transferable or non-transferable template root.
- `TemplateMaterial`: creator-owned registered material entry.
- `TemplateVersion`: immutable published version snapshot.
- `TemplateLicensePolicy`: machine-readable rights and restrictions.
- `OCSoul`: generated user character minted from a template.
- `PaidPartPack`: purchasable access to premium materials.

### 7.2.1 Role to Object Ownership Map

| Object | Owner/controller | Transferable? | Notes |
| --- | --- | --- | --- |
| `CreatorProfile` | Creator / Artist | usually no | Identity and payout metadata. |
| `TemplateMaterial` | Material Owner | optional | Source material rights may be transferable later. |
| `MaterialVersion` | Material Owner | no | Immutable content/hash snapshot. |
| `CreatorTemplate` | Creator or Template Publisher | configurable | Root template object; transferability is a product decision. |
| `TemplateVersion` | Template Publisher | no | Immutable published maker version. |
| `TemplateLicensePolicy` | Template Publisher / Creator | no for published version | License snapshots must not mutate after publish. |
| `PaidPartPack` | Creator / Template Publisher | no or controlled | Access config, not necessarily a transferable asset. |
| `PaidAccessEntry` | Buyer / OC Maker | no | Proof that a buyer can use/read locked material kind. |
| `CommercialLicenseProof` | Buyer / OC Maker / Commissioner | usually no | Can attach to one OC or template access. |
| `OCRecipe` | OC Maker | no after mint snapshot | Recipe should be immutable once minted. |
| `OCSoul` | OC owner | yes | Main tradable generated character. |
| `SoulListing` | Seller/market flow | no direct transfer | Listing is lifecycle object. |
| `SoulCollection` | Creator/brand/collector | yes/configurable | For drops, packs, or campaigns. |
| `SoulGrant` | Grant issuer/grantee scope | no | Temporary scoped permission. |

### 7.2.2 Permission Principles

- A material can be used in a template only if the template publisher has material-owner permission.
- A template version freezes the material versions, rules, prices, and license policy used by generated OCs.
- A user can mint an OC only if their recipe passes the frozen template version rules.
- A paid item can be selected only if the user has the required paid access proof.
- A commercial-use output requires a commercial license proof or a template license that grants commercial use by default.
- A minted OC keeps its license snapshot even if the template later changes policy.
- A resale must preserve creator royalty and platform fee rules.
- A moderator can affect discovery state but should not rewrite ownership/provenance.

### 7.3 What Must Be On-chain vs Off-chain

On-chain:

- object ownership
- creator address
- material/template/OC ids
- content hashes/blob ids
- version pointers
- license policy hashes/snapshots
- paid access records
- creator royalty BPS
- platform fee
- listing/buy/cancel
- provenance refs
- commercial license purchase proof

Off-chain but content-addressed:

- PNG files
- PSD/source files if creators choose to publish them
- rendered images
- large JSON manifests
- moderation evidence
- search indexes
- thumbnails/cache

Off-chain only:

- manual review decisions
- illegal-content response
- customer support
- creator identity verification beyond wallet ownership

### 7.4 Existing Soulidity Fit

Current Soulidity already covers many later-stage needs:

- `Soul` can represent the generated OC.
- `SoulState.creator_royalty_bps` captures creator royalty.
- `SoulContent` can store typed recipe/render/license content through Walrus blobs.
- `SoulState.config_ext` can store small config blobs such as sprite/template config.
- `Market` can mint, list, buy, cancel, and settle platform/creator fee flows.
- `PaidAccess` can represent paid premium parts or commercial-use access by kind.
- `Collection` can group OC outputs or template-derived drops.
- `Grant` can allow temporary scoped usage, collaboration, or preview access.

Gap:

- There is not yet a first-class template/material registry object specifically for reusable OC makers.
- The existing `Soul` object can represent generated OCs, but using it for every source material may be too heavy.
- Animacraft likely needs a new module or a clearly defined content-kind convention for `CreatorTemplate`, `TemplateMaterial`, and `TemplateVersion`.

### 7.5 Recommended Contract Roadmap

Phase 1: no new Move module, use conventions.

- Register template manifest as `SoulContent`.
- Mint generated OC as `Soul`.
- Store recipe/license/render as typed content.
- Use `PaidAccess` for paid packs.
- Use `Market` for OC sale/resale.

Phase 2: add template registry.

- New `template.move` module with `CreatorTemplate`, `TemplateVersion`, `TemplateMaterial`.
- Template versions become immutable snapshots.
- Materials are registered and versioned before template publish.
- OC mint validates recipe against published template version.

Phase 3: full creator economy.

- On-chain template marketplace.
- Paid material packs.
- Commercial license purchases.
- Derivative template provenance.
- Creator revenue dashboard from events.

### 7.6 Proposed Contract Concepts

Current Soulidity contracts can support minted OC packages, but Animacraft likely needs extra template-level objects.

#### CreatorTemplate

Represents a reusable image maker template.

Fields:

- template_id
- creator
- name
- description
- cover_url
- license_policy_id
- asset_manifest_content_id
- creator_royalty_bps
- publish_state
- version

Contract mapping:

- could be a new Move object or a specific `Soul`/`SoulContent` kind if staying within current architecture.
- asset manifest can live in `content.move` as a typed content kind.
- pricing for paid part packs can use `paid_access.move`.

#### TemplateLicensePolicy

Defines usage rules.

Fields:

- personal_use_allowed
- noncommercial_share_allowed
- commercial_use_allowed
- derivative_allowed
- ai_training_allowed
- ai_prompt_allowed
- watermark_required
- attribution_required
- commercial_license_price

Contract mapping:

- policy metadata stored as content/config.
- enforceable paid access and ownership states stored on-chain.
- subjective violations still need off-chain moderation and takedown process.

#### OCRecipe

Represents the user's selected parts and palette.

Fields:

- template_id
- template_version
- selected_items
- palette
- generated_image_url
- owner
- provenance_kind
- parent_oc_id optional

Contract mapping:

- minted as `Soul`.
- recipe JSON stored as `SoulContent`.
- image and asset package stored as Walrus blobs.
- derivative chain represented through `origin_ref` or an explicit parent reference.

#### PaidPartPack

Represents purchasable template content such as premium hair, outfit, backgrounds.

Contract mapping:

- `paid_access.move` per-kind configs can model paid access to template parts.
- access entries bind buyer, kind, price, duration, and owner epoch.

## 8. Data Model Requirements

### Material Asset

Required:

- schema version
- material id
- creator address
- source blob id / content hash
- slot key
- item id
- layer role: main / mask / icon / thumbnail / source
- canvas config
- license policy snapshot
- template ids allowed to use it
- status
- version

Material assets are the foundation of the on-chain system. A template should reference registered materials rather than treating uploaded PNG files as anonymous local files.

### Template Manifest

Required:

- schema version
- template id
- creator identity
- canvas config
- slots
- items
- layers
- color groups
- rules
- license policy
- pricing
- example recipes
- publish metadata
- material ids and material versions
- license policy id/snapshot
- paid access kind ids

### OC Package

Required:

- schema version
- package id
- source template id/version
- selected recipe
- rendered image URL / local export
- license snapshot
- creator royalty snapshot
- owner
- derivative/provenance refs
- material ids used
- template version id
- license proof id if commercial/paid access was purchased

### Content Kinds Needed

Add/define kind registry entries for:

- material_asset
- material_source
- material_icon
- template_manifest
- template_asset_pack
- template_material_index
- template_license_policy
- template_cover
- template_example_recipe
- oc_recipe
- oc_rendered_image
- oc_license_snapshot
- commercial_license_proof

## 9. MVP Scope

### MVP 0: Local Prototype

- template card grid
- Make OC editor
- creator setup internal page
- asset upload metadata parser
- recipe export
- creator manifest export

### MVP 1: On-chain Material Registry

- creator wallet identity
- upload real PNGs to content-addressed storage
- register material asset records
- validate canvas/layers before registration
- register material kind/slot/item metadata
- version registered materials
- mark materials active/deprecated
- index creator material library

### MVP 2: On-chain Template Registry

- assemble template from registered materials
- publish immutable template version
- store template manifest and license policy
- configure paid part packs
- publish private preview link
- public template page reads chain-backed template state
- template card grid backed by indexed on-chain events

### MVP 3: On-chain OC Minting

- user creates OC recipe from template version
- validate recipe against template manifest
- render image and store content-addressed output
- mint generated OC as `Soul`
- store recipe/render/license snapshot as typed content
- record template/material provenance
- enforce creator royalty BPS

### MVP 4: On-chain Economy

- paid template access
- paid part packs
- commercial license purchase
- resale/listing
- creator dashboard
- settlement/events indexing

## 10. Authorization and Trading Matrix

| Product action | Actor | On-chain object/proof | Payment path | Revenue receiver | Notes |
| --- | --- | --- | --- | --- | --- |
| Register material | Creator / Material Owner | `TemplateMaterial` / content kind | none | none | Establishes creator/source provenance. |
| Publish template | Creator / Publisher | `CreatorTemplate` + `TemplateVersion` | optional listing fee | platform if configured | Template references registered materials. |
| Use free template | OC Maker | recipe + license snapshot | none | none | Output can still carry license limits. |
| Use premium part | OC Maker / Buyer | `PaidAccess` entry by kind/pack | paid access purchase | creator/material owner + platform | Buyer receives access to locked material kinds. |
| Buy commercial license | Buyer / Commissioner | license proof object/content | paid access or license purchase | creator/material owner + platform | Can attach to one OC or to template access. |
| Mint generated OC | OC Maker | `Soul` + `SoulContent` | mint fee optional | platform/creator if configured | Stores recipe/render/license/provenance. |
| Resell OC | Seller / Buyer | `SoulListing` | market buy flow | seller + creator royalty + platform | Creator royalty and platform fee apply. |
| Sell template rights | Creator / Buyer | template listing/right object | market buy flow | creator + platform | Optional later feature; may be restricted. |
| Grant collaboration access | Creator / Owner | `SoulGrant`/scoped grant | none or paid | grant issuer if paid | Useful for teams, commissions, review access. |
| Collection/drop sale | Creator / Brand / Collector | `SoulCollection` | collection listing | collection owner + creators + platform | Useful for creator packs or branded drops. |

## 11. Product Decisions

### Hide Protocol Complexity, Not Protocol Existence

The editor should not ask users to understand contracts before making an OC, but the product architecture assumes that materials, templates, outputs, licenses, and trades have canonical chain records. The UI hides complexity; it does not treat on-chain registration as an optional afterthought.

### Template Page Should Not Be a Admin Detail Page

Template discovery should feel like browsing image makers. Clicking a card starts creation or opens a visually rich template page. A side detail panel makes the product feel like an internal dashboard.

### Creator Features Must Be Internal Workspaces

Creator Setup, Asset Pack, Guide, and Advanced are editor subpages. They should not compete with the main Make flow.

### JSON Is Advanced

Recipe/manifest/package JSON is necessary for protocol development but should remain hidden unless the user is in Advanced mode.

## 12. Open Questions

- Should a creator template itself be a transferable asset, or should only the published OC outputs be transferable?
- Should paid part packs be purchased per template, per creator, or as a subscription?
- Should commercial license be attached to one generated OC, or to the user's access to the template?
- How should derivative work be represented on-chain when third-party IP is involved?
- How much moderation can be on-chain versus platform policy/off-chain review?
- Should AI-training permissions be explicit on-chain flags?

## 13. Immediate Development Requirements

1. Replace the current CSS avatar demo with real layer rendering.
2. Implement material asset manifest format.
3. Implement template manifest importer.
4. Implement slot/item/layer ordering.
5. Implement linked color groups.
6. Implement part/item rules.
7. Add rendered image export.
8. Add draft persistence.
9. Add creator asset validation report.
10. Add template preview recipes.
11. Add on-chain material registration adapter spec.
12. Add template registry Move module design.
13. Add Soulidity adapter spec for minting template-derived OC packages.
14. Add paid part pack and commercial license purchase flow spec.

## 14. Source Links

- Neka: https://www.neka.cc/
- Picrew support top page: https://support.picrew.me/en/
- Picrew create image maker: https://support.picrew.me/en/create_imagemaker
- Picrew function list: https://support.picrew.me/en/functions_top
- Picrew guidelines: https://support.picrew.me/en/picrewguidelines
- Picrew terms: https://support.picrew.me/en/terms
- Local Soulidity contracts: `clawnews/move/soulidity/sources/`
