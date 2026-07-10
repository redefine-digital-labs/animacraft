# Animacraft Production Status

## Working now

- Vite production build and Vercel SPA rewrites.
- Character Maker workspace with Part-owned Layers, Colors, Items, per-cell PNG uploads, live composition preview, and global layer ordering.
- Creator manifest v2 with `Part → Layers + Colors + Items → Item Images` provenance.
- Official Sui dApp Kit wallet selection and real connection state.
- Sui and Walrus Mainnet runtime configuration with publishing gated until a real package id is installed.
- Mainnet Walrus quilt preparation, wallet-paid registration, upload relay transfer, certification, and QuiltPatchID resolution.
- One wallet-signed PTB that creates a creator profile, creates an OCMaker, registers its parts and items, publishes it, and transfers both objects to the creator.
- User-side OC image/profile upload and wallet-signed OCCharacter mint transaction for configured published makers.
- Move validation for license kinds, part kinds, item gates, non-empty blobs, and non-empty publishable makers.
- Move unit tests and browser-verified responsive layouts.

## Required before public creator onboarding

1. Upgrade the local Sui CLI to match the Mainnet protocol.
2. Fund a dedicated publisher wallet with SUI and WAL.
3. Publish `move/animacraft` to Sui Mainnet and secure its `UpgradeCap`.
4. Set the real package id in `public/config.js`.
5. Publish at least one real maker and add its OCMaker object id under `featuredMakers`.
6. Run a wallet-funded end-to-end Mainnet transaction with a small real PNG asset set.
7. Replace hard-coded featured discovery with Sui event or object discovery.
8. Add durable resumable Walrus upload state and failed-upload recovery.
9. Add moderation/reporting policy before opening public template uploads.

## Required before unrestricted Mainnet scale

- Add transaction size limits and batch publishing for large makers.
- Add contract tests covering full creator and OC lifecycle scenarios.
- Add package upgrade policy, multisig administration, monitoring, and incident procedures.
- Complete an independent Move security review.
