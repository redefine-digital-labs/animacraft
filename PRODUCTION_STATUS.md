# Animacraft Production Status

## Release State

The repository is a **Maker Mainnet production candidate**. The editor and Maker protocol are ready for an invited-creator pilot, but writes remain blocked until the real Animacraft package id is configured. Canonical paid Soul minting remains blocked until the separate Soulidity adapter is reviewed and deployed.

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
- Pull requests run config preflight, 31 web/config integrity tests, syntax checks, and a production build; the local Move suite currently passes 25 tests.

## Manual Mainnet Activation

1. Fund a dedicated publisher wallet with SUI and WAL.
2. Run `npm run move:test`, publish `move/animacraft`, and record package, transaction, publisher, and `UpgradeCap` custody.
3. Replace `0xTODO_ANIMACRAFT_PACKAGE` in `public/config.js` with the verified Mainnet package id and run `npm run preflight:mainnet`.
4. Deploy a Vercel Preview and connect the intended `animacraft.soulidity.ai` subdomain.
5. Publish one small real Maker through all four Walrus/Sui stages.
6. Publish the reviewed Soulidity adapter pinned to the Animacraft package ID.
7. Open the Maker from a disconnected browser, connect a second wallet, complete free and paid canonical Soul mints, then withdraw the paid amount with the Cap wallet.
8. Verify Maker/Treasury/Cap discovery, Living Content import, Soulidity collection, archive rejection, restore, and transaction links.
9. Record the evidence in the release PR before promoting the domain.

## Invited Pilot Boundary

- A single release supports up to 450 on-chain Part + public Item + Color + selection rule + palette-link records in its one-transaction publisher.
- A Maker supports up to 5,000 Walrus files including its manifest.
- Production config requests 53 Walrus Mainnet epochs, currently about two years. A renewal process is required before expiry.
- Native-USDC authorization collection and Cap withdrawal are implemented. The temporary free JSON handoff does not support paid Makers; paid mint and secondary-sale settlement require the reviewed Soulidity adapter.
- Creators must retain original art and confirm they have the right to publish it.
- Establish reporting, takedown, and license-dispute contacts before accepting uninvited public uploads.

## Before Unrestricted Scale

- Add batched multi-transaction Maker registration beyond the launch transaction limit.
- Pin and run a Mainnet-compatible Sui CLI in GitHub Actions.
- Complete an independent Move security review and document upgrade/multisig procedures.
- Add production monitoring for Sui GraphQL, RPC, Walrus aggregator, and upload relay degradation.
- Add creator-facing Walrus retention status and a signed renewal action before the first production Quilt approaches expiry.
- Complete full-interface localization QA for English, Chinese, Japanese, Korean, and Vietnamese.
