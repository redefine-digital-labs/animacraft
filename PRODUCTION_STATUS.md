# Animacraft Production Status

## Release State

Animacraft product version `0.4.0` is a pre-v1 production candidate. Product v1 is reserved for a proven ecosystem at roughly 1,000 active creators. Move protocol numbers are tracked separately: the original protocol v3 package `0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea` is live and source-verified at the recorded deployment commit. The repository now contains a **protocol v4 upgrade candidate** that preserves existing Maker object layouts and adds non-bypassable primary protocol-fee splitting. Protocol v4 is not Mainnet-active until the UpgradeCap holder signs the upgrade and initializes the canonical Protocol Fee objects. Canonical Soul minting remains blocked until the separate Soulidity adapter is reviewed and deployed.

The Template Plaza and Docs are public without a wallet. Make OC, Creator Studio, local draft ownership, Walrus writes, publication, archive, and Soulidity handoff require a connected wallet.

Current Mainnet truth: the published package is configured, but discovery currently returns zero verified public Makers. Production therefore renders a creator-first empty state and does not expose bundled starter cards. A player session may open only from a Sui-discovered Maker restored from certified Walrus data; local creator packs remain explicit UI-test fixtures.

## Implemented

- Separate Maker v4 Creator Studio and Player Editor surfaces backed by one document model, constraint engine, and Canvas renderer; players never reposition creator-authored layers.
- Production Character starter creates a complete eight-Part graph with one Item, Variant, global LayerTrack, and direct PNG LayerBinding upload slot per Part; it no longer migrates an empty legacy shell.
- Fixed Canvas coordinates with creator drag/position confirmation, proportional scale, zoom, hide/Solo/dim inspection, explicit LayerTracks, full blend modes, and pixel rendering.
- Batch PNG import with mapping confirmation, alpha-cropped UI thumbnails without source mutation, independent thumbnails/icons, structural copy/delete/reorder, Undo/Redo, and incremental/manual save states.
- Item/Variant/LayerBinding hierarchy, explicit optional `None`, requires/excludes, parent Parts, conditional visibility, shared gradient/asset-map ColorChannels, and constraint-safe Random.
- Embedded, namespaced ExpansionPack preview/runtime support plus compatible/breaking Maker update analysis and immutable old-OC version pinning.
- `animacraft.maker.v4` and `animacraft.oc-package.v2` Walrus outputs with a deterministic compatibility projection for the existing Sui publication and RecipeSlot interfaces. Move-inexpressible rules are marked as partial coverage rather than silently dropped.
- Migration support for the previous Part-owned `Item x Layer x Color` PNG-matrix model.
- One live composition surface plus a global cross-Part Layer order; preview and exported PNG use the same offsets, opacity, blend mode, and canvas scaling.
- Standard, left-right paired, and required Last Bastion Parts. Last Bastion Parts cannot be targeted by incompatibility rules.
- Local Maker, Part, Item, optional Layer, and extra Color deletion before publication.
- Separate IndexedDB v4 stores for Maker documents, incrementally persisted source image Blobs, wallet-scoped player sessions, and resumable Maker/OC Walrus upload checkpoints; v3 drafts remain migratable.
- `animacraft.creator-template.v3` manifest compatibility alongside the generated v4 Maker cover, Quilt Blob ID, and identifier addressing.
- Public Maker discovery from Sui publication events, Sui object hydration, and certified Walrus manifests.
- Chain-only production gallery, truthful zero-Maker state, 50-event Mainnet GraphQL pagination, and guarded Player routes that cannot fall back to hidden examples.
- Remote manifest limits and validation before an untrusted public Maker reaches the player.
- Reusable wallet-owned `CreatorProfile` records with published Maker IDs.
- Three-object Maker publication: shared `OCMaker`, shared `MakerTreasury<PaymentCoin>`, and transferable `MakerAdminCap`.
- Cap-only administration, exact native-USDC paid authorization, v4 Maker/protocol Treasury splitting, Treasury accounting/withdrawal, and 0% or 1%–5% resale-royalty tiers.
- Immutable published art/rules, Cap-signed economics and archive/restore, and mint rejection for archived or closed Makers.
- Rule-aware player choices, required Part validation, exact linked Color sets, uploaded item thumbnails, finished PNG rendering, and Walrus storage.
- Living Content editor with Soulidity-compatible `soul.md`, `memory.md`, and `skills.zip` defaults embedded in Maker and OC packages.
- Non-droppable `SoulMintAuthorization` ABI; Animacraft no longer creates a duplicate finished-character token.
- Move verifies registered recipe Colors, published Part order, selection/palette rules, and SHA-256 over canonical BCS recipe bytes.
- My Souls sends users to Soulidity, which owns the canonical finished-character collection.
- Vercel rewrites, CSP including Walrus WASM support, non-cached runtime config, and baseline security headers.
- Pull requests run config preflight, the web/config integrity suite, syntax checks, and a production build; Move protocol changes also run the contract suite.

## Manual Mainnet Activation

1. Move the published `UpgradeCap`, `Publisher`, and `Display<OCMaker>` objects into the documented protocol custody arrangement.
2. Sign the reviewed v4 upgrade, then initialize the canonical native-USDC `ProtocolFeeConfig`, `ProtocolTreasury`, and `ProtocolFeeAdminCap` with the Publisher.
3. Record those IDs, run `npm run preflight:mainnet`, and deploy a Vercel Preview.
4. Publish one small real Maker through all four Walrus/Sui stages.
5. Publish the reviewed Soulidity adapter pinned to the Animacraft original package ID and verify Soulidity's secondary platform fee remains 250 bps.
6. Open the Maker from a disconnected browser, connect a second wallet, complete free and paid canonical Soul mints, then withdraw both Maker and protocol shares with their respective Caps.
7. Verify Maker/Treasury/Cap discovery, Living Content, Soulidity profile/collection, 2.5% resale settlement, archive rejection, restore, and transaction links.
8. Record the evidence in the release PR before enabling canonical mint.

Until steps 2, 4, and 5 are evidenced, this is a creator production candidate rather than a completed end-to-end Soul mint release. `canonicalSoulMintEnabled` remains `false`, paid mint controls remain fail-closed, and no UI copy should imply that an OC has already been minted.

## Invited Pilot Boundary

- A single release supports up to 450 on-chain Part + public Item + Color + selection rule + palette-link records in its one-transaction publisher.
- A Maker supports up to 5,000 Walrus files including its manifest.
- Production config requests 53 Walrus Mainnet epochs, currently about two years. A renewal process is required before expiry.
- Native-USDC authorization collection and Cap withdrawal are implemented. The temporary free Import Kit handoff does not support paid Makers; paid mint and secondary-sale settlement require the reviewed Soulidity adapter.
- Creators must retain original art and confirm they have the right to publish it.
- Establish reporting, takedown, and license-dispute contacts before accepting uninvited public uploads.

## Before Unrestricted Scale

- Add batched multi-transaction Maker registration beyond the launch transaction limit.
- Pin and run a Mainnet-compatible Sui CLI in GitHub Actions.
- Complete an independent Move security review and document upgrade/multisig procedures.
- Add production monitoring for Sui GraphQL, RPC, Walrus aggregator, and upload relay degradation.
- Add creator-facing Walrus retention status and a signed renewal action before the first production Quilt approaches expiry.
- Complete full-interface localization QA for English, Chinese, Japanese, Korean, and Vietnamese.
