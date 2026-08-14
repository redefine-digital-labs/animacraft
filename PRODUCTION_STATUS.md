# Animacraft Production Status

## Release State

As of 2026-08-12, Expansion Pack v8 is live on Mainnet as a bounded, one-Pack,
FREE production pilot. This supersedes older statements that every later-version
gate was off or that v8 was not live.

- Release `0x8c2af3a0c7eb4bfe88bf5ed9e7b56cb407edae12f672a3331a09e41d046e071b`
  is `ACTIVE`, has FREE access, and is backed by certified Walrus Quilt
  `We3YHgglZfOpzffEyrxCB0dVNUS8ox5v8oSjJlb1QWE`.
- Activation transaction `8mw6HfPX1YHcfDwvgZbCNwawfUZHLHBMtYPQdSLcjdvv`
  succeeded at checkpoint `309818089`.
- The parent Root `0xb97ca9552c01557530f04b6302fb4b58c43f209c8371129e3400810f1576e08c`
  remains `PAUSED` at ownership epoch `1`. Claims are bound to that epoch and
  the shared Authority
  `0xc2b39910070116bc9614f4f55b6b1013377fc86ba6273630f5cee83111bd8e19`;
  the general ControlCap was retired.
- `expansionPackV8ReleaseEnabled` is the only production product gate set to
  `true`. `canonicalSoulMintEnabled`, `commerceV5ReleaseEnabled`,
  `compositionV6ReleaseEnabled`, and `physicalStyleV7ReleaseEnabled` remain
  `false`; the Complete-to-Soulidity, Complete, and physical bridge checks also
  remain `false`.
- Vercel deployment `dpl_GDrUED8AwUfFsRRsSJ9Wzdi6zfW3` is promoted at
  `https://animacraft.soulidity.ai`. The known web rollback deployment is
  `dpl_7NwkGiWLh75AbZoaWH2FvjRqbqTY`.

Animacraft product version `0.8.5` remains pre-v1. Move protocol generations are
tracked separately: the stable original package/legacy TypeOrigin is
`0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea`;
the v8 callable package is
`0x1a797e32f594c53abab3e5bc0df9368c60deb4564e7947bea42db00d32dbe9ee`
and its stable v8 TypeOrigin is
`0x4b7109b4780c91ec528cced9fd77f4ed9dad4cb462484c74f100f1ed7f309c7a`.
The initialized native-USDC protocol-fee objects remain part of the legacy core,
but canonical Soul integration stays disabled.

The Template Plaza and Docs are public without a wallet. Make OC, Creator Studio, local draft ownership, Walrus writes, publication, archive, and Soulidity handoff require a connected wallet.

Do not summarize the current production state as "zero Makers." That older
statement described the legacy `OCMakerPublished` gallery only; the certified,
on-chain v8 Release above is now independently discoverable. Legacy Maker
discovery remains a separate signal, and local creator packs remain explicit
UI-test fixtures rather than production fallbacks.

Chain activation, Walrus certification, the v8-only runtime gate, and web
promotion are complete. Browser wallet claim/render acceptance is still
pending because no controlled browser currently has both the ChatGPT control
extension and a Sui wallet. The pilot must not be described as fully
end-to-end accepted until that signed browser flow and its render evidence are
recorded in [MAINNET_SMOKE_TEST.md](./MAINNET_SMOKE_TEST.md).

## Implemented

- Separate Maker v5 Creator Studio and Player Editor surfaces backed by one document model, constraint engine, and Canvas renderer; players never reposition creator-authored Styles.
- Parts & Items remains the persistent creator canvas; Layer Tracks, Smart Color, Rules, Expansion Packs, and Preflight use bounded desktop/mobile tool dialogs with close/Escape behavior, human-readable issue paths, and no horizontal overflow.
- Maker Studio navigation, nested Inspector controls, runtime status, validation, Player Editor, and primary creation controls follow the existing MyPage language setting in English, Chinese, Japanese, Korean, and Vietnamese. Unknown low-level protocol diagnostics fall back to a localized category message rather than hiding an error.
- Text edits are buffered and flushed before Save, Undo, tool switching, and review so a creator cannot lose a rename by clicking a toolbar action directly.
- Production Character starter creates an eight-Part draft graph with one empty draft Item and one global LayerTrack per Part. Creators add Styles explicitly; a new Item does not inherit stale artwork or settings.
- Fixed Canvas coordinates owned only by each Style, with creator drag/position confirmation, real position and full-Style locks, proportional scale, zoom, hide/Solo/dim inspection, explicit z-order-only LayerTracks, full blend modes, and pixel rendering.
- Batch PNG import with mapping confirmation, alpha-cropped UI thumbnails without source mutation, independent thumbnails/icons, structural copy/delete/reorder, Undo/Redo, and incremental/manual save states.
- Final `Maker → Part → Item → Style` hierarchy. Each Style has exactly one `assetId`/PNG plus its own Track, transform, opacity, blend, color, lock, and rule data; there is no nested render-unit level or Style enable toggle.
- Explicit optional `None`, requires/excludes, parent Parts, conditional visibility, shared gradient-map ColorChannels, and constraint-safe Random. A different PNG always requires a different Style.
- Embedded, namespaced ExpansionPack preview/runtime support plus compatible/breaking Maker update analysis and immutable old-OC version pinning.
- `animacraft.maker.v5` and `animacraft.oc-package.v2` Walrus outputs with a deterministic compatibility projection for the existing Sui publication and RecipeSlot interfaces. Move-inexpressible rules are marked as partial coverage rather than silently dropped.
- Maker v5 authoring rejects legacy multi-image nested render graphs instead of guessing a lossy migration.
- One live composition surface plus a global cross-Part LayerTrack order. LayerTracks never store or inherit coordinates; preview and exported PNG use each Style's same transform, opacity, blend mode, and canvas scaling.
- Standard, left-right paired, and required Last Bastion Parts. Last Bastion Parts cannot be targeted by incompatibility rules.
- Local Maker, Part, Item, Style, and extra Color deletion before publication.
- Separate IndexedDB stores for Maker v5 documents, incrementally persisted source image Blobs, wallet-scoped player sessions, and resumable Maker/OC Walrus upload checkpoints. Legacy v3/v4 drafts are not silently migrated into the v5 hierarchy.
- Legacy `animacraft.creator-template.v3` reading remains separate from the generated v5 Maker cover, Quilt Blob ID, and identifier addressing.
- Public Maker discovery from Sui publication events, Sui object hydration, and certified Walrus manifests.
- Chain-only production gallery, truthful zero-Maker state, 50-event Mainnet GraphQL pagination, and guarded Player routes that cannot fall back to hidden examples.
- Remote manifest limits and validation before an untrusted public Maker reaches the player.
- Reusable wallet-owned `CreatorProfile` records with published Maker IDs.
- Three-object Maker publication: shared `OCMaker`, shared `MakerTreasury<PaymentCoin>`, and transferable `MakerAdminCap`.
- Cap-only administration, exact native-USDC paid authorization, protocol v4 Maker/protocol Treasury splitting, Treasury accounting/withdrawal, and 0% or 1%–5% resale-royalty tiers.
- Immutable published art/rules, Cap-signed economics and archive/restore, and mint rejection for archived or closed Makers.
- Rule-aware player choices, required Part validation, exact linked Color sets, uploaded item thumbnails, finished PNG rendering, and Walrus storage.
- Living Content editor with Soulidity-compatible `soul.md`, `memory.md`, and `skills.zip` defaults embedded in Maker and OC packages.
- Non-droppable `SoulMintAuthorization` ABI; Animacraft no longer creates a duplicate finished-character token.
- Move verifies registered recipe Colors, published Part order, selection/palette rules, and SHA-256 over canonical BCS recipe bytes.
- My Souls sends users to Soulidity, which owns the canonical finished-character collection.
- Vercel rewrites, CSP including Walrus WASM support, non-cached runtime config, and baseline security headers.
- Pull requests run config preflight, the web/config integrity suite, syntax checks, and a production build; Move protocol changes also run the contract suite.
- The public Docs Center provides a searchable, responsive, five-language handbook for players, creators, artists, publishing, recovery, lifecycle management, and the exact local/Walrus/Sui/Soulidity boundary.
- Docs now separates a concise article-card home from directly linkable article detail pages and uses one browser-controlled page scroll across desktop and mobile.
- Twelve high-value Docs articles include accessible, responsive visual explanations for the Maker hierarchy, Player selection surface, full-canvas alignment, import decisions, Layer Track order, Smart Color linkage, Rules outcomes, four-step publication, and the Soul/chain boundary. Existing AI-assisted fixture art is labeled as a technical alignment example rather than an aesthetic reference.

## Composable Assets v6 Preview

v6 is additive to the v5 production contract. Its supported scope is limited to
a Composable Profile; Maker-local Canvas, Layer Track, Slot, Rule and Renderer
compatibility; technically validated Official, Certified and Open Item
Products; immutable Genesis and revisioned Current Appearance; and optional
independent Item ownership.

Open content has no Maker endorsement but must pass the same exact technical
validation as Official and Certified content. Rental, consumables, durability,
enhancement, game attributes and Bundle Sale are not implemented and have no
placeholder protocol enum. Only an opaque `extensionsHash` reserves a future
versioned upgrade point.

The `compositionV6ReleaseEnabled` product gate is off. The v6 authoring and
validation model may be tested locally, but production must not publish a v6
companion, admit or sell Item Products, create appearance companions, update a
Soul appearance or transfer an owned Item. This does not disable the independent
FREE v8 pilot described above. The exact v6 boundary and promotion evidence are
documented in
[COMPOSABLE_ASSETS_V6.md](./COMPOSABLE_ASSETS_V6.md).

## Remaining Legacy Full-Product Activation

This retained checklist concerns the broader Maker, canonical Soul, Commerce,
Composition, and Physical product surfaces. It does not describe or gate the
already-active v8 one-Pack pilot. The older v4 runtime-deployment step is
complete and is retained here only as release history.

1. Keep the live `UpgradeCap`, `ProtocolFeeAdminCap`, and `Display<OCMaker>` under the documented protocol custody arrangement. The one-time Publisher is now sealed inside the AdminCap.
2. Preserve the deployed evidence-bearing core runtime configuration and do not conflate it with the independently enabled v8 gate.
3. Publish one small real Maker through all four Walrus/Sui stages.
4. Publish the reviewed Soulidity adapter pinned to the v4 release record and verify Soulidity's secondary platform fee remains 250 bps.
5. Open the Maker from a disconnected browser, connect a second wallet, complete free and paid canonical Soul mints, then withdraw both Maker and protocol shares with their respective Caps.
6. Verify Maker/Treasury/Cap discovery, Living Content, Soulidity profile/collection, 2.5% resale settlement, archive rejection, restore, and transaction links.
7. Record the evidence in the release PR before enabling canonical mint.

Until the real Maker smoke and Soulidity migration are evidenced, the broader
product remains a creator production candidate rather than a completed
end-to-end Soul mint release. `canonicalSoulMintEnabled` remains `false`, paid
mint controls remain fail-closed, and no UI copy should imply that an OC has
already been minted. Separately, the v8 pilot is chain/storage/web live but is
not fully end-to-end accepted until its pending wallet claim/render test passes.

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
