# Animacraft

**The Fully onchain Character Maker & Creator.**

Animacraft is a standalone, backendless Character Maker for artists and OC users. Creators build reusable Makers from layered PNG assets; users combine those Makers into finished OCs. Walrus stores the creative files, while Sui records creator provenance, Maker rules, license snapshots, and OC ownership.

Animacraft and Soulidity are separate products and repositories. Soulidity may consume Animacraft OCs through adapters later, but Animacraft can ship, operate, and grow independently.

## Product Loop

1. Anyone can browse the public Template Plaza without a wallet.
2. A creator connects a Sui wallet, creates a local Maker draft, and defines `Part -> Item -> Layer x Color PNG` assets.
3. The browser persists draft metadata, source files, and upload checkpoints in IndexedDB.
4. The creator stores one immutable Maker quilt on Walrus and publishes a shared `OCMaker` on Sui.
5. A user connects a wallet, makes an OC, stores its rendered image and profile on Walrus, and mints an owned `OCCharacter`.
6. A published Maker cannot be silently edited. Its creator may archive or restore it; existing OCs retain their provenance and policy snapshot.

## Architecture

- **Vercel:** static Vite frontend, security headers, and route rewrites.
- **Sui Mainnet:** `CreatorProfile`, shared `OCMaker`, registered Colors, selection/palette rules, BCS recipe hashes, license policy, and owned `OCCharacter` objects.
- **Walrus Mainnet:** source PNGs, icons, Maker cover, manifest, rendered OC image, and profile JSON in quilts.
- **Sui GraphQL:** public discovery of `OCMakerPublished` events. No application database is required.
- **Wallet Standard:** every write and storage payment is signed by the creator or user. No private application signer exists.

## Local Development

Requires Node.js `20.19+` and a Mainnet-compatible Sui CLI for Move tests.

```bash
npm ci
npm run check
npm run move:test
npm run dev
```

`npm run check` runs JavaScript syntax checks, eighteen web integrity tests, and the Vite production build. `npm run move:test` currently runs 20 contract tests. Both suites pin the same canonical BCS recipe bytes and SHA-256 fixture.

## Runtime Configuration

Public configuration lives in `public/config.js`; `config.example.js` documents every field. Publishing and minting intentionally remain disabled while `packageId` contains `TODO`.

Before Mainnet activation:

1. Publish and verify `move/animacraft` on Sui Mainnet.
2. Put the `UpgradeCap` under a documented custodian or multisig policy.
3. Set the verified package id in `public/config.js`.
4. Run one real creator publication and one real user mint with a small asset set.
5. Redeploy and verify public event discovery, Walrus hydration, archive/restore, and My OCs.

## Versioned Outputs

- `animacraft.creator-template.v3`: Maker manifest and Walrus asset index.
- `animacraft.oc-package.v1`: finished OC profile, recipe, policy, and chain intent.
- Recipe JSON: exact selected Part, Item, registered Color, and published Part order. Move recomputes its SHA-256 BCS hash at mint.
- Rendered PNG: final composition stored on Walrus before mint.

## Current Boundary

Animacraft enforces Maker publication, archive state, recipe validity, required Parts, incompatible selections, provenance, ownership, and license/royalty policy snapshots. It does **not** yet execute template payments, premium-Part purchases, marketplace listings, or royalty settlement. Those remain future Soulidity or marketplace adapters and are not presented as active product features.

See [CREATOR_GUIDE.md](./CREATOR_GUIDE.md), [DEPLOYMENT.md](./DEPLOYMENT.md), [PRODUCTION_STATUS.md](./PRODUCTION_STATUS.md), and [move/animacraft/README.md](./move/animacraft/README.md).
