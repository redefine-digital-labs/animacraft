# On-chain OC Creation Economy: Research Brief

## Executive Summary

Animacraft is based on a simple but powerful product loop: excellent creators make reusable OC templates, everyday users use those templates to generate finished original characters, and those finished OCs can then be used, licensed, traded, commissioned, or expanded into derivative works.

The opportunity is not merely to build another avatar maker. The larger opportunity is to turn OC creation into a rights-aware, creator-owned, on-chain production network. In this network, source materials, templates, generated characters, authorization proofs, paid access, trades, and revenue distribution can all be recorded and enforced through protocol rules.

This matters because OC creation is already an economically meaningful creative activity, but the rights relationships are usually trapped inside Web2 platforms, screenshots, informal terms, or manual settlement. Once an OC is traded, used commercially, remixed, or moved across platforms, the original creator's rights and revenue often become difficult to enforce.

Sui and Walrus make this model technically feasible: Sui provides object ownership, programmable transaction rules, royalties, access proofs, and trading logic; Walrus provides durable storage for large creative files such as PNG layers, manifests, rendered images, and source assets. Soulidity can become the OC-specific protocol layer connecting these primitives into a full creator economy.

## 1. Background: Why OC Creation Matters

Original characters are a major part of online creative culture. People create OCs for avatars, roleplay, social identity, games, comics, fan communities, AI agents, and personal storytelling. Tools like Neka and Picrew show that users want lightweight interfaces where they can choose a creator-made template, combine parts, adjust colors, and quickly produce a character image.

The key insight is that the best templates are not random asset packs. They are reusable creative systems designed by skilled artists:

- body and face bases
- hair, eyes, clothing, accessories, and backgrounds
- color palettes
- layer order
- compatibility rules
- usage rules
- example outputs

A strong template creator is effectively building an OC factory. Many users can generate distinct characters from the same artist-authored system.

## 2. The Existing Gap

Current OC maker platforms prove user demand, but they do not fully solve rights and economic coordination.

Typical problems:

- Source materials are not independently tracked as ownable assets.
- Template versions can change without a durable public record.
- Generated OC outputs may not carry a clear license snapshot.
- Commercial-use rights are often ambiguous or manually negotiated.
- Paid parts and premium packs are platform-specific.
- Resale or secondary use rarely routes revenue back to original creators.
- Cross-platform provenance is weak.
- Derivative works are hard to validate.

This is not just a UX problem. It is a coordination problem between creators, users, buyers, commissioners, platforms, and marketplaces.

## 3. Why Chain Matters

The reason to put this system on-chain is not speculation. It is enforcement.

OC creation involves many rights relationships:

- Who created this hair layer?
- Which template version used it?
- Was the user allowed to use a premium part?
- Was commercial use purchased?
- Which creator receives royalty when the generated OC is resold?
- Which license applied when the OC was minted?
- Which materials and template rules produced this finished character?

These relationships are hard to enforce if they only live in a private database. Once an asset leaves the platform, the platform's database is no longer enough.

On-chain records allow:

- durable provenance
- ownership tracking
- immutable template/version snapshots
- paid access proofs
- license proofs
- creator royalty enforcement
- market settlement
- derivative lineage
- transparent events for indexing and dashboards

The goal is not to expose blockchain complexity to users. The goal is to make creator rights and revenue rules survive beyond a single app.

## 4. Product Flywheel

The intended flywheel is:

```text
Top creators publish high-quality OC templates
  -> users generate finished OCs
  -> finished OCs are used, licensed, traded, commissioned, or collected
  -> transactions generate revenue for creators, material owners, and the platform
  -> more creators publish better materials and templates
  -> the template library becomes more valuable
```

This flywheel is strongest when the system can prove and enforce:

- who made each material
- which materials are inside each template
- which template version generated each OC
- which license applies
- who bought access or commercial rights
- how resale revenue is split

## 5. Why Sui + Walrus Fits

This product needs both programmable ownership and scalable creative storage.

### Sui

Sui is suitable for the protocol and economic layer:

- object ownership
- creator/material/template/OC objects
- programmable access rules
- paid access proofs
- license proofs
- transaction-time validation
- market listings
- royalty and platform fee settlement
- grants and scoped permissions
- collections and drops

The OC economy is object-heavy. Materials, templates, generated OCs, listings, access entries, and license proofs all map naturally to object-based design.

### Walrus

Walrus is suitable for the content layer:

- PNG layers
- thumbnails and icons
- template manifests
- rule configs
- palette configs
- rendered OC images
- recipe JSON
- license snapshots
- creator source files

Creative files should not live directly inside Move objects. The chain should store references, hashes, permissions, and versions, while Walrus stores the actual files.

### Soulidity

Soulidity can connect both layers:

- register source materials
- publish templates
- mint generated OC outputs
- store typed content and recipe records
- enforce paid access
- enforce royalties and market flows
- track provenance from material to template to OC

## 6. Proposed Asset Lifecycle

The system should start from the smallest creative unit:

```text
Source material
  -> Material asset record
  -> Template assembly
  -> Published template version
  -> User OC recipe
  -> Rendered OC image
  -> Minted OC object
  -> License/access proof
  -> Trade/resale/commission
  -> Revenue settlement
```

This is different from a normal NFT avatar project. The final OC is not the only important object. The template and source materials are also part of the economic system.

## 7. Key Roles

### Creator / Artist

Creates materials and templates. Earns from template usage, paid packs, commercial licenses, and downstream royalties.

### Material Owner

Owns specific source assets such as hair, eyes, outfit, background, icon, or rule config.

### Template Publisher

Assembles materials into a reusable OC template and publishes immutable template versions.

### OC Maker / Player

Uses templates to generate finished OCs. Can mint, save, license, or trade outputs.

### Buyer / Collector

Buys premium parts, commercial licenses, finished OCs, or collection rights.

### Commissioner / Brand Partner

Funds exclusive templates, campaign drops, or commissioned OC rights.

### Protocol / Marketplace

Enforces ownership, authorization, trading, access, royalties, grants, and provenance.

## 8. What Needs to Be Built

The product should be built in phases:

1. Neka-like editor: template plaza, make OC, parts, colors, recipe export.
2. Creator material system: upload, validate, register, and version PNG layers.
3. Template registry: assemble materials into immutable template versions.
4. OC minting: mint generated OCs with recipe, rendered image, license snapshot, and provenance.
5. Authorization and paid access: premium parts, commercial licenses, derivative permissions.
6. Trading and settlement: resale, creator royalty, platform fee, collection/drop flows.
7. Creator dashboard: usage, revenue, sales, access purchases, template performance.

## 9. Strategic Position

Animacraft should not compete as another generic avatar app. It should become the creator protocol for OC production.

The wedge is the editor: make it as easy and fun as Neka/Picrew. The moat is the protocol: make every asset, template, output, license, and trade part of a durable creator economy.

If successful, Animacraft can become:

- a template marketplace
- an OC creation tool
- a creator rights protocol
- a paid asset/access system
- an OC trading layer
- a foundation for game characters, AI agent identities, roleplay assets, and social avatars

## 10. Conclusion

The infrastructure is ready. Sui can handle object ownership and economic rules. Walrus can handle the creative asset layer. Soulidity already has primitives for souls, content, paid access, grants, listings, collections, royalties, and market settlement.

The missing product is a creator-first OC tool that turns those primitives into a coherent workflow:

```text
material -> template -> generated OC -> authorization -> trade -> settlement
```

That is the reason to build Animacraft.
