# Animacraft Production Status

## Release State

The repository is a **Mainnet production candidate**. The web and Move implementations are ready for an invited-creator pilot, but Mainnet writes remain correctly blocked until the real package id is configured and the deployment wallet completes the first signed end-to-end run.

The Template Plaza and Docs are public without a wallet. My OCs, Make OC, Creator Studio, local draft ownership, Walrus writes, publication, archive, and minting require a connected wallet.

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
- Shared published `OCMaker` objects so any user can borrow a Maker for minting while creator-only mutations still verify `ctx.sender()`.
- Immutable published versions, creator-signed archive/restore, and mint rejection for archived Makers.
- Rule-aware player choices, required Part validation, exact linked Color sets, uploaded item thumbnails, finished PNG rendering, Walrus storage, and `OCCharacter` minting.
- Move verifies registered recipe Colors, published Part order, selection/palette rules, and SHA-256 over canonical BCS recipe bytes.
- My OCs reads wallet-owned `OCCharacter` objects and links their Sui provenance and Walrus image.
- Vercel rewrites, CSP including Walrus WASM support, non-cached runtime config, and baseline security headers.
- Pull requests run eighteen web integrity tests, syntax checks, and a production build; the local Move suite currently passes twenty tests, including a shared web/Move BCS hash fixture.

## Manual Mainnet Activation

1. Fund a dedicated publisher wallet with SUI and WAL.
2. Run `npm run move:test`, publish `move/animacraft`, and record package, transaction, publisher, and `UpgradeCap` custody.
3. Replace `0xTODO_ANIMACRAFT_PACKAGE` in `public/config.js` with the verified Mainnet package id.
4. Deploy a Vercel Preview and connect the intended `animacraft.soulidity.xyz` subdomain.
5. Publish one small real Maker through all four Walrus/Sui stages.
6. Open that Maker from a disconnected browser, connect a second user wallet, make an OC, and mint it.
7. Verify event discovery, cover and layer hydration, My OCs, archive rejection, restore, and transaction links.
8. Record the evidence in the release PR before promoting the domain.

## Invited Pilot Boundary

- A single release supports up to 450 on-chain Part + public Item + Color + selection rule + palette-link records in its one-transaction publisher.
- A Maker supports up to 5,000 Walrus files including its manifest.
- Production config requests 53 Walrus Mainnet epochs, currently about two years. A renewal process is required before expiry.
- Payment collection and royalty settlement are not implemented; BPS is policy metadata only.
- Creators must retain original art and confirm they have the right to publish it.
- Establish reporting, takedown, and license-dispute contacts before accepting uninvited public uploads.

## Before Unrestricted Scale

- Add batched multi-transaction Maker registration beyond the launch transaction limit.
- Pin and run a Mainnet-compatible Sui CLI in GitHub Actions.
- Complete an independent Move security review and document upgrade/multisig procedures.
- Add production monitoring for Sui GraphQL, RPC, Walrus aggregator, and upload relay degradation.
- Add creator-facing Walrus retention status and a signed renewal action before the first production Quilt approaches expiry.
- Complete full-interface localization QA for English, Chinese, Japanese, Korean, and Vietnamese.
