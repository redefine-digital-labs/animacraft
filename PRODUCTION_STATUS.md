# Animacraft Production Status

## Working now

- Vite production build and Vercel SPA rewrites.
- Official Sui dApp Kit wallet selection and real connection state.
- Testnet Walrus uploads for creator PNG layers and manifests.
- One wallet-signed PTB that creates a creator profile, creates an OCMaker, registers its parts and items, publishes it, and transfers both objects to the creator.
- User-side OC image/profile upload and wallet-signed OCCharacter mint transaction for configured published makers.
- Move validation for license kinds, part kinds, item gates, non-empty blobs, and non-empty publishable makers.
- Move unit tests and browser-verified responsive layouts.

## Required before public creator onboarding

1. Publish `move/animacraft` to Sui Testnet.
2. Set the package id in `public/config.js`.
3. Publish at least one real maker and add its OCMaker object id under `featuredMakers`.
4. Run a wallet-funded end-to-end Testnet transaction with real PNGs.
5. Replace hard-coded featured discovery with Sui event or object discovery.
6. Add resumable Walrus upload state and failed-upload recovery.
7. Add moderation/reporting policy before opening public template uploads.

## Required before Mainnet

- Use the Walrus TypeScript SDK and wallet-paid Upload Relay flow.
- Add transaction size limits and batch publishing for large makers.
- Add contract tests covering full creator and OC lifecycle scenarios.
- Add package upgrade policy, multisig administration, monitoring, and incident procedures.
- Complete an independent Move security review.
