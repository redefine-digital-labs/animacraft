# Animacraft Production Status

## Release State

The repository is a **Maker Mainnet production candidate with a published and source-verified protocol package**. The original Animacraft package `0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea` is live, its Mainnet bytecode matches this repository's published source tree, and the editor/runtime are ready for a signed invited-creator smoke test. Canonical paid Soul minting remains blocked until the separate Soulidity adapter is reviewed and deployed.

The Template Plaza and Docs are public without a wallet. Make OC, Creator Studio, local draft ownership, Walrus writes, publication, archive, and Soulidity handoff require a connected wallet.

## Implemented

- Character Maker centered on Part-owned Items, Layers, Colors, icons, and complete `Item x Layer x Color` PNG matrices.
- One live composition surface plus a global cross-Part Layer order; preview and exported PNG use the same offsets, opacity, blend mode, and canvas scaling.
- Standard, left-right paired, and required Last Bastion Parts. Last Bastion Parts cannot be targeted by incompatibility rules.
- Local Maker, Part, Item, optional Layer, and extra Color deletion before publication.
- IndexedDB v3 persistence for Maker structure, source image Blobs, and resumable Maker/OC Walrus upload checkpoints.
- `animacraft.creator-template.v3` manifests with a generated Maker cover and Quilt Blob ID plus identifier addressing.
- Public Maker discovery from Sui publication events, Sui object hydration, and certified Walrus manifests.
- Remote manifest limits and validation before an untrusted public Maker reaches the player.
- Reusable wallet-owned `CreatorProfile` records with published Maker IDs.
- Three-object Maker publication: shared `OCMaker`, shared `MakerTreasury<PaymentCoin>`, and transferable `MakerAdminCap`.
- Cap-only administration, exact native-USDC paid authorization, Treasury accounting/withdrawal, and 0% or 1%–5% resale-royalty tiers.
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
2. Run `npm run preflight:mainnet` against the configured original package.
3. Deploy a Vercel Preview and connect the intended `animacraft.soulidity.ai` subdomain.
4. Publish one small real Maker through all four Walrus/Sui stages.
5. Publish the reviewed Soulidity adapter pinned to the Animacraft original package ID.
6. Open the Maker from a disconnected browser, connect a second wallet, complete free and paid canonical Soul mints, then withdraw the paid amount with the Cap wallet.
7. Verify Maker/Treasury/Cap discovery, Living Content import, Soulidity collection, archive rejection, restore, and transaction links.
8. Record the evidence in the release PR before promoting the domain.

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
