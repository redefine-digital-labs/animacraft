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
- Walrus publisher / aggregator URLs
- Walrus upload relay URL and storage epochs
- featured OCMaker object ids
- public app URL

## Production Path

1. Publish the Animacraft Move package.
2. Set `packageId` in runtime config.
3. Enable wallet connection through Sui Wallet / wallet standard.
4. On Testnet, upload creator assets through the public Walrus publisher.
5. On Mainnet, replace the public publisher path with a wallet-paid Walrus Upload Relay flow.
6. Register `CreatorProfile` and `OCMaker` on Sui.
7. Store manifest blob ids in `OCMaker`.
8. Add published maker object ids to discovery configuration until event discovery is enabled.
9. Let users mint `OCCharacter` objects from published makers.
10. Add marketplace / Kiosk integration after creator and player loops are stable.

## Mainnet Boundary

Walrus has no unauthenticated public Mainnet publisher. A production browser client must use the Walrus TypeScript SDK with an Upload Relay, splitting register and certify into separate wallet interactions. Do not point Mainnet at the Testnet publisher or add a private application signer.

## Backendless Rule

If a feature needs persistence, ask first:

- Can it be a Sui object?
- Can the file be a Walrus blob?
- Can the index be derived from events?
- Can the wallet sign the transaction directly?

Only add a backend if it is strictly an optional indexer, cache, or analytics layer.
