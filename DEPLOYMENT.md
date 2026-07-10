# Animacraft Production Deployment

Animacraft is designed as a Vite-built, backendless app.

The production stack should be:

- Vercel for static hosting and preview deployments.
- Sui for creator profiles, OC maker objects, license policy snapshots, and OC objects.
- Walrus for PNG layers, icons, cover images, manifests, rendered OC images, and profile JSON.
- Wallet transaction blocks for all writes. No private backend signer.

## Recommended Domains

Use one of:

- `animacraft.soulidity.xyz`
- `studio.soulidity.xyz`
- `oc.soulidity.xyz`

For a standalone open-source product, `animacraft.soulidity.xyz` is the clearest.

## Vercel Setup

1. Import `redefine-digital-labs/animacraft`.
2. Framework preset: `Vite`.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Install command: `npm install`.

The repository includes `vercel.json` for static rewrites:

- `/maker/:id`
- `/oc/:id`
- `/creator/:path*`

## Runtime Config

Public runtime configuration lives in `public/config.js`; `config.example.js` documents all fields. After publishing the Move package, set its package id and the first published maker object ids, then redeploy.

Never commit private keys or admin mnemonics. Frontend config may only include public values:

- network
- RPC URL
- published package id
- Walrus aggregator URL
- Walrus upload relay URL and storage epochs
- maximum relay tip in MIST
- featured OCMaker object ids
- public app URL

## Production Path

1. Upgrade the Sui CLI to a version compatible with the current Mainnet protocol.
2. Fund the publisher wallet with SUI for gas and WAL for Walrus storage.
3. Build and test the Move package, then publish it to Sui Mainnet.
4. Set the real `packageId` in `public/config.js` and redeploy.
5. Connect a wallet through Wallet Standard.
6. Prepare creator PNGs and manifests as a Walrus quilt in the browser.
7. Register, upload through the Mainnet upload relay, and certify in separate wallet interactions.
8. Register `CreatorProfile` and `OCMaker` on Sui using QuiltPatchIDs for individual files.
9. Add published OCMaker object ids to discovery configuration until event discovery is enabled.
10. Let users render an OC, store its image and profile on Walrus, then mint an `OCCharacter` on Sui.
11. Add marketplace / Kiosk integration after creator and player loops are stable.

## Mainnet Boundary

Walrus has no unauthenticated public Mainnet publisher. Animacraft uses the Walrus TypeScript SDK and Mainnet Upload Relay, splitting registration/upload and certification into separate wallet interactions. It never embeds a private application signer.

The wallet must hold both currencies before onboarding a real creator:

- SUI pays Sui transaction gas and relay tips.
- WAL pays Walrus storage registration.

Mainnet transactions are irreversible and consume real assets. Use a dedicated deployment wallet, verify its address and balances, retain the package `UpgradeCap`, and record every transaction digest before opening public onboarding.

The current upload session is held in browser memory. Do not treat it as durable recovery yet: keep source files until certification succeeds, and retry from preparation after a refresh or interrupted upload.

## Backendless Rule

If a feature needs persistence, ask first:

- Can it be a Sui object?
- Can the file be a Walrus blob?
- Can the index be derived from events?
- Can the wallet sign the transaction directly?

Only add a backend if it is strictly an optional indexer, cache, or analytics layer.
