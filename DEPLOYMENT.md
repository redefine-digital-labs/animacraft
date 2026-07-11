# Animacraft Mainnet Deployment

Animacraft is a static Vite app with direct wallet-signed Sui and Walrus writes. There is no application server, database, private signer, or secret runtime variable.

## Recommended Origin

Use `animacraft.soulidity.xyz`. It keeps Animacraft visibly related to Soulidity while preserving a standalone product and repository boundary.

## 1. Preflight

```bash
npm ci
npm run check
npm run move:test
git diff --check
```

Confirm the deployment wallet, active Sui environment, SUI gas, WAL balance, and the installed CLI version before any Mainnet command. Never paste a mnemonic or private key into this repository, Vercel, or a support conversation.

## 2. Publish the Move Package

The package is in `move/animacraft`. Use a Mainnet-compatible Sui CLI and the current official package-publish/PTB command shown by that CLI. Do not reuse a command copied from an older Sui release without checking `sui client ptb --help` and the official Sui CLI reference.

After signing, record:

- original package id
- publish transaction digest
- publisher address
- `UpgradeCap` object id and custodian
- CLI version and Git commit

Run `sui move test` again from the exact commit that was published.

## 3. Configure the Public Runtime

Edit `public/config.js`:

```js
window.ANIMACRAFT_CONFIG = {
  network: 'mainnet',
  grpcUrl: 'https://fullnode.mainnet.sui.io:443',
  graphqlUrl: 'https://sui-mainnet.mystenlabs.com/graphql',
  packageId: '0xVERIFIED_PACKAGE_ID',
  walrusAggregatorUrl: 'https://aggregator.walrus-mainnet.walrus.space',
  walrusUploadRelayUrl: 'https://upload-relay.mainnet.walrus.space',
  walrusRelayMaxTipMist: 1000000,
  walrusEpochs: 53,
  featuredMakers: {},
  appUrl: 'https://animacraft.soulidity.xyz'
};
```

`featuredMakers` is only a curated fallback. The public gallery discovers all `OCMakerPublished` events through Sui GraphQL and hydrates each Maker from its certified Walrus manifest.

The sample Mysten Sui endpoints are appropriate for the five-creator pilot, but the public fullnode is rate-limited. Replace `grpcUrl` and, where available, `graphqlUrl` with monitored dedicated Mainnet infrastructure before unrestricted traffic. Animacraft keeps these as public runtime values; provider credentials must never be embedded in the browser bundle.

`walrusEpochs: 53` requests the current Mainnet maximum, approximately two years at 14 days per epoch. It increases WAL cost compared with a short pilot upload. Record each Quilt Blob object and establish a renewal calendar before expiry; Walrus retention is extendable but not perpetual without renewal.

The player retries newly certified Walrus manifests and render layers with bounded exponential backoff because a CDN-backed aggregator can briefly return a cached `404` immediately after certification.

Only public values belong in this file. Vercel serves `config.js` with `no-store` so a package/config correction is not hidden behind a stale browser cache.

## 4. Deploy Vercel

1. Import `redefine-digital-labs/animacraft`.
2. Framework: `Vite`.
3. Install command: `npm ci`.
4. Build command: `npm run build`.
5. Output directory: `dist`.
6. Deploy the production-candidate branch as Preview first.

`vercel.json` supplies SPA rewrites and browser security headers. In the Preview origin, explicitly verify that wallet discovery and Walrus WASM encoding are not blocked by CSP.

## 5. Connect the Subdomain

1. Add `animacraft.soulidity.xyz` to the Vercel project.
2. Add the CNAME or provider-specific DNS record Vercel shows.
3. Wait for TLS issuance.
4. Update `appUrl` if the final origin differs, redeploy, and verify both apex navigation and deep rewrites.

## 6. Signed Mainnet Smoke Test

Use a small real Maker first:

1. Open the Template Plaza while disconnected; published Makers must remain visible.
2. Connect the creator wallet and create a 1:1 draft with two Parts and two Items.
3. Upload aligned PNGs, save, reload, and confirm IndexedDB restores every file.
4. Prepare, register/upload, certify, and publish the Maker. Interrupt once before certification and verify `Resume saved upload` works.
5. Confirm the shared `OCMaker` appears through event discovery without adding it to `featuredMakers`.
6. Connect a second wallet, make an OC, resume an interrupted OC upload, and mint it.
7. Confirm My OCs, Sui object links, Walrus image, recipe, policy snapshot, and the Move-verified SHA-256 BCS recipe hash.
8. Archive the Maker with the creator wallet, verify a new mint is rejected, restore it, and verify minting resumes.

Record all transaction digests and object ids in the release PR.

## Mainnet Cost and Recovery

- SUI pays transaction gas and upload-relay tips.
- WAL pays Walrus storage registration.
- Maker and OC upload checkpoints survive reload in the same browser profile.
- Certified Walrus data and Sui objects are not deleted when a local draft is removed.
- A published Maker is immutable; publish a new Maker version to change its art or rules.

## Rollback

If the web release is faulty, roll Vercel back to the previous deployment. If a Maker is faulty, archive it; do not attempt to erase history. If the Move package needs an upgrade, stop onboarding, publish the reviewed upgrade through the documented `UpgradeCap` policy, update runtime config only if required, and repeat the smoke test.
