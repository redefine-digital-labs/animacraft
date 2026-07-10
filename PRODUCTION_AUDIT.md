# Animacraft Production Audit

Audit target: public creator onboarding, user OC creation, and Sui/Walrus Mainnet publishing without an application backend.

## Release decision

**Vercel Preview: ready. Public Mainnet production: not ready.**

The web application builds as a static deployment and the core Character Maker workflow is implemented. Mainnet publication is intentionally blocked while `public/config.js` contains a placeholder package id. Do not remove that gate until the deployed package and first end-to-end transaction are verified.

## Product workflow

1. A visitor connects a Sui wallet before My Page and creator actions become available.
2. A creator opens My Page, enters Creator Studio, and creates or opens an OC Maker.
3. Character Maker is the persistent work surface. Every Part owns its Items, Layers, Colors, and image files.
4. Composition Order only controls the final stack across Parts; it does not create a second Layer ownership model.
5. Rules and Palette Rules constrain valid combinations.
6. Preview Check validates the public maker before publication.
7. On-chain Publish uploads the manifest and image assets to Walrus, then signs the Sui publication transaction.
8. A user opens a published Maker, chooses Items, uploads the resulting OC data, and signs an OCCharacter mint transaction.

## Completed controls

- Maker edit state and local drafts are isolated by wallet and Maker id.
- Publication blocks empty Parts, missing public Item images, duplicate ids, broken rule references, invalid royalty values, and more than 750 Parts.
- Item images and icons enforce file type, byte-size, and image-dimension limits.
- Walrus quilt preparation enforces unique identifiers, file-count limits, and a total byte limit.
- User-controlled names and labels are escaped before dynamic HTML insertion in primary editor and gallery surfaces.
- Wallet signing is required for Sui state changes; private keys are not stored by the application.
- Vercel headers include a Content Security Policy and other baseline browser protections.
- GitHub pull requests run repository hygiene plus a clean production web build.

## P0 release blockers

- Publish and verify the Move package on Sui Mainnet; record the package id, transaction digest, publisher, and UpgradeCap custodian.
- Configure the verified package id and execute one complete real-asset creator publication and user mint on Mainnet.
- Replace hard-coded gallery data with chain-derived Maker discovery and Walrus manifest hydration.
- Persist resumable Walrus upload state so a refresh or relay failure cannot strand a paid upload workflow.
- Establish moderation, takedown, content reporting, and license-dispute operations for public uploads.
- Run Move tests in CI with a pinned Sui CLI and obtain an independent Move security review.

## P1 before scale

- Batch large Maker registrations to stay within transaction and gas limits.
- Add automated browser tests for wallet gating, Maker isolation, upload validation, preview, and publication recovery.
- Put the UpgradeCap under a documented multisig policy and define upgrade/incident procedures.
- Add chain/indexer health monitoring and user-facing degraded-state handling.
- Test all five locales at mobile and desktop widths with production-length creator and asset names.

## Deployment gate

Vercel may deploy the current branch as a Preview. Promote to the public production domain only when every P0 item has an owner, evidence, and a pass result. The placeholder package id must remain a hard failure, never a silent fallback.
