# Animacraft Mainnet Deployment

Animacraft is a static Vite app with direct wallet-signed Sui and Walrus writes. There is no application server, database, private signer, or secret runtime variable.

## Recommended Origin

Use `animacraft.soulidity.ai`. It keeps Animacraft visibly related to Soulidity while preserving a standalone product and repository boundary.

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
  paymentCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  paymentCoinSymbol: 'USDC',
  paymentCoinDecimals: 6,
  walrusAggregatorUrl: 'https://aggregator.walrus-mainnet.walrus.space',
  walrusUploadRelayUrl: 'https://upload-relay.mainnet.walrus.space',
  walrusRelayMaxTipMist: 1000000,
  walrusEpochs: 53,
  featuredMakers: {},
  appUrl: 'https://animacraft.soulidity.ai',
  soulidityAppUrl: 'https://www.soulidity.ai',
  soulidityPackageId: '0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0'
};
```

Run the strict read-only check after setting the Animacraft package:

```bash
npm run preflight:mainnet
```

After the separate Soulidity package and adapter are published, set `soulidityPackageId` and run `npm run preflight:integration`.

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

After promoting the reviewed deployment, verify the live runtime configuration, security headers, and direct SPA routes against the Git checkout:

```bash
npm run preflight:integration
node scripts/production-smoke.mjs
```

For a protected Preview, pass its reachable URL directly after disabling protection for the acceptance window or using an approved Vercel access mechanism:

```bash
node scripts/production-smoke.mjs --url=https://your-preview.vercel.app
```

## 5. Connect the Subdomain

1. Add `animacraft.soulidity.ai` to the Vercel project.
2. Add the CNAME or provider-specific DNS record Vercel shows.
3. Wait for TLS issuance.
4. Update `appUrl` if the final origin differs, redeploy, and verify both apex navigation and deep rewrites.

## 6. Signed Mainnet Smoke Test

Use a small real Maker first:

1. Open the Template Plaza while disconnected; published Makers must remain visible.
2. Connect the creator wallet and create a 1:1 draft with two Parts and two Items.
3. Upload aligned PNGs, save, reload, and confirm IndexedDB restores every file.
4. Prepare, register/upload, certify, and publish the Maker. Interrupt once before certification and verify `Resume saved upload` works.
5. Confirm the shared `OCMaker`, shared `MakerTreasury<USDC>`, and wallet-owned `MakerAdminCap` are linked and the Maker appears through event discovery.
6. Archive the Maker with the Cap wallet, verify a new authorization is rejected, restore it, and verify authorization resumes.
7. Confirm a disconnected visitor can open the new Maker through its direct `/maker/:id` URL.

The Maker-only invited pilot stops here. Keep paid mint controls and canonical Soul claims disabled.

After the separate Soulidity adapter has been reviewed and deployed:

8. Connect a second wallet, make an OC, resume an interrupted OC upload, and complete one free canonical Soul mint in one PTB.
9. Enable a small USDC price with the Cap wallet, complete one paid canonical Soul mint, and verify the exact amount reaches the linked Treasury.
10. Withdraw that amount with the Cap wallet and verify the recipient balance and withdrawal event.
11. Confirm the Soulidity handoff, Living Content files, Walrus image, recipe, policy/payment snapshots, and the Move-verified SHA-256 BCS recipe hash.

Record all transaction digests and object ids in the release PR.

## Mainnet Cost and Recovery

- SUI pays transaction gas and upload-relay tips.
- WAL pays Walrus storage registration.
- Maker and OC upload checkpoints survive reload in the same browser profile.
- Certified Walrus data and Sui objects are not deleted when a local draft is removed.
- A published Maker's art and composition rules are immutable; publish a new version to change them. Its Cap owner may change future mint economics and archive state.

## Separate Soulidity Deployment

Do not combine the two packages into one publish transaction. Publish Animacraft first, pin its original package ID as a dependency of the Soulidity adapter, review that diff with the Soulidity developers, then publish Soulidity with its own `UpgradeCap`. Animacraft and Soulidity must have separate multisig custody records and release tags.

## Rollback

If the web release is faulty, roll Vercel back to the previous deployment. If a Maker is faulty, archive it; do not attempt to erase history. If the Move package needs an upgrade, stop onboarding, publish the reviewed upgrade through the documented `UpgradeCap` policy, update runtime config only if required, and repeat the smoke test.
