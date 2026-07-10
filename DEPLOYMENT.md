# Animacraft Production Deployment

Animacraft is designed as a static, backendless app.

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
2. Framework preset: `Other`.
3. Build command: empty.
4. Output directory: `.`.
5. Install command: empty.

The repository includes `vercel.json` for static rewrites:

- `/maker/:id`
- `/oc/:id`
- `/creator/:path*`

## Runtime Config

For the current no-build static version, copy `config.example.js` to `config.js` during deployment if you want runtime config without rebuilding.

Never commit private keys or admin mnemonics. Frontend config may only include public values:

- network
- RPC URL
- published package id
- Walrus publisher / aggregator URLs
- public app URL

## Production Path

1. Publish the Animacraft Move package.
2. Set `packageId` in runtime config.
3. Enable wallet connection through Sui Wallet / wallet standard.
4. Upload creator assets to Walrus from the browser.
5. Register `CreatorProfile` and `OCMaker` on Sui.
6. Store manifest blob ids in `OCMaker`.
7. Let users mint `OCCharacter` objects from published makers.
8. Add marketplace / Kiosk integration after creator and player loops are stable.

## Backendless Rule

If a feature needs persistence, ask first:

- Can it be a Sui object?
- Can the file be a Walrus blob?
- Can the index be derived from events?
- Can the wallet sign the transaction directly?

Only add a backend if it is strictly an optional indexer, cache, or analytics layer.
