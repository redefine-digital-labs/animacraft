# Animacraft Mainnet Deployment

Animacraft is a static Vite app with direct wallet-signed Sui and Walrus writes. There is no application server, database, private signer, or secret runtime variable.

## Current Mainnet Release

- Protocol version: `4`
- Callable package: `0xc1bbfe03cc93e27903e1ffd1a712745384cd537d6edadfb0e759bf6e090e53cc`
- Original package / stable type identity: `0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea`
- v4 upgrade transaction: `92DUvaqv35eYA78zB5wP5pKpqvKa3QV6eJ4YUASEAMh6`
- v4 upgrade checkpoint: `303378234`
- Protocol-fee initialization transaction: `HpSsqqsNqzREwE6pjRws9LwfNYT5qtRFFf9qMdWJiEpt`
- Protocol-fee initialization checkpoint: `303378555`
- `ProtocolFeeConfig`: `0x60d141c7b9c5726a85a3b53dd08879d86af313cf3fe96d5e6440a8d5cb60ee32`
- `ProtocolTreasury<USDC>`: `0xf859174faa620adcdae10d2554eb356cb8a499dcbe47f15327a1347fe752af54`
- `ProtocolFeeAdminCap`: `0x28a99dfbfc37b474b4bdb3330eeb1a2ef3bb1139e0268112d91bd11a4e3fdcbd`
- Canonical Soul mint gate: `false`
- Initial protocol fee: `5000` bps
- `UpgradeCap`: `0xe7d1269532bbfbf5e448cb5c58f07fc6720ed3d22e7853e9f13b7b6282746520`
- Historical `Publisher` consumed into the AdminCap during initialization: `0xfc5a8e6f32e5d7a77492373e5b301809a2b0ca4cbec7282a43668995d7ae2ddb`
- `Display<OCMaker>`: `0xeec472b0f5eeb1a6ca07ca10d9e470a4aa1946f005d8ff29299365b0e3003877`
- Publisher address: `0xadea1910ac0e738dc020247bc5408b57b15f3701026a96098b716a35c3a6c52f`
- Source tree: `2ce7795c62e3776049e3c711fb5389cfa19320fc`
- Merged source commit: `b5af0f92e2178a32d561da6cf650f3e97b4a5de4`
- Source verification: successful at `2026-07-27T00:14:06Z` with Sui CLI `1.75.2-027e13b2c140`

The canonical machine-readable record is [`deployments/mainnet.json`](deployments/mainnet.json).
For Soulidity's Move dependency, the original package ID remains the stable
`original-id`/type identity, while `published-at` must be the separately
reviewed current callable package (v4 for this release). Do not replace
`original-id` with an upgrade ID, and do not silently advance `published-at`
to an unreviewed later upgrade.

## Recommended Origin

Use `animacraft.soulidity.ai`. It keeps Animacraft visibly related to Soulidity while preserving a standalone product and repository boundary.

## 1. Preflight

```bash
npm ci
npm run check
npm run move:test
git diff --check
git status --short
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
sui --version
sui client active-env
sui client chain-identifier
sui client active-address
sui client object 0xe7d1269532bbfbf5e448cb5c58f07fc6720ed3d22e7853e9f13b7b6282746520 --json
```

The expected Mainnet chain identifier is `35834a8a`. Confirm the deployment
wallet, active Sui environment, SUI gas, WAL balance, and the installed CLI
version before any Mainnet command. The `UpgradeCap` readback must show that it
still controls original package
`0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea`
and is held by the approved custodian or multisig. Never paste a mnemonic or
private key into this repository, Vercel, or a support conversation.

## 2. Upgrade to v4 through the existing custody procedure

The package is in `move/animacraft`. This repository deliberately does not
contain an unattended Mainnet signer. Build and dry-run the exact upgrade
candidate first:

```bash
sui client upgrade move/animacraft \
  --upgrade-capability 0xe7d1269532bbfbf5e448cb5c58f07fc6720ed3d22e7853e9f13b7b6282746520 \
  --verify-deps \
  --force \
  --dry-run \
  --json
```

Sui CLI `1.75.2` rejects `--build-env mainnet` on this upgrade path even
though the option remains visible in help. The package already pins its
Mainnet environment; use the explicit dependency verification shown above.

For a multisig or hardware-wallet ceremony, create the unsigned transaction
with the same source, capability and Mainnet environment using
`--serialize-unsigned-transaction`; then pass those bytes through the existing
custody review/sign/execute process. Do not run a bare signing command from an
unreviewed workstation. The ceremony reviewers must compare the transaction
target, upgrade capability, sender, gas budget, package digest, source commit,
source tree and toolchain with the release PR.

After the signed upgrade is final, read it back:

```bash
sui client tx-block "$ANIMACRAFT_V4_UPGRADE_TX_DIGEST" --json
sui client object 0xe7d1269532bbfbf5e448cb5c58f07fc6720ed3d22e7853e9f13b7b6282746520 --json
sui client verify-source --force --build-env mainnet --json move/animacraft
```

Record and review all of the following before initialization:

- `deployments/mainnet.json`:
  - `originalPackageId` remains the v3 ID
    `0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea`.
  - `packageId` and `callablePackageId` both become the new v4 callable ID.
  - `protocolFeePackageId` becomes that same v4 ID, because v4 is the
    TypeOrigin of the fee/canonical-authorization structs.
  - `protocolVersion` becomes `4` and `upgradeTxDigest` contains the final
    digest.
  - source commit/tree, CLI version, verification result and `UpgradeCap`
    custodian are updated from the actual ceremony evidence.
- `move/animacraft/Published.toml`:
  - `published-at` becomes the v4 callable ID.
  - `original-id` remains the v3 ID.
  - `version` becomes `2`.
  - `upgrade-capability` remains
    `0xe7d1269532bbfbf5e448cb5c58f07fc6720ed3d22e7853e9f13b7b6282746520`.

Run the Move tests again from the exact published commit. Never infer the
callable package or TypeOrigin from a UI link; take them from the final
transaction/object readback and commit the evidence-bearing record.

## 3. Initialize the v4 protocol objects once

Initialization consumes the existing package
`Publisher` (`0xfc5a8e6f32e5d7a77492373e5b301809a2b0ca4cbec7282a43668995d7ae2ddb`),
shares `ProtocolFeeConfig` and `ProtocolTreasury<USDC>`, and returns the
`ProtocolFeeAdminCap`. Use one custody-reviewed PTB so that the returned cap is
explicitly transferred to the approved admin address. With current Sui CLI PTB
syntax, the dry-run shape is:

```bash
# Fill these from the reviewed upgrade record and custody policy.
ANIMACRAFT_V4_PACKAGE=0x...
MAINNET_USDC=0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC
PROTOCOL_FEE_ADMIN_OWNER=0x...

sui client ptb \
  --move-call \
  "$ANIMACRAFT_V4_PACKAGE::animacraft::initialize_protocol_fees" \
  "<$MAINNET_USDC>" \
  "@0xfc5a8e6f32e5d7a77492373e5b301809a2b0ca4cbec7282a43668995d7ae2ddb" \
  --assign protocol_fee_admin_cap \
  --transfer-objects '[protocol_fee_admin_cap]' "$PROTOCOL_FEE_ADMIN_OWNER" \
  --dry-run \
  --json
```

Before producing bytes, compare this syntax with `sui client ptb --help` from
the recorded CLI version. The signed transaction must be generated and approved
through the same multisig/hardware-wallet boundary as the upgrade. If submission
times out, resolve the transaction digest and object changes first; never
blindly retry this one-time initializer.

After finality, record the initializer digest and the three IDs emitted by
`ProtocolFeesInitialized`, then perform independent object readback:

```bash
sui client tx-block "$PROTOCOL_FEE_INITIALIZATION_TX_DIGEST" --json
sui client object "$PROTOCOL_FEE_CONFIG_ID" --json
sui client object "$PROTOCOL_TREASURY_ID" --json
sui client object "$PROTOCOL_FEE_ADMIN_CAP_ID" --json
```

The record is accepted only when:

- `ProtocolFeeConfig` and `ProtocolTreasury<USDC>` are shared.
- `ProtocolFeeAdminCap` is address-owned by the approved admin/custodian.
- all three exact types begin with
  `$ANIMACRAFT_V4_PACKAGE::animacraft::...`; this v4 address is their stable
  TypeOrigin for later v5+ upgrades.
- all three objects report protocol version `4` and cross-reference the same
  config/treasury IDs.
- the initial fee is `5000` bps and the on-chain integration gate is `false`.
- the package `Publisher` is present inside the AdminCap and no longer exists as
  a separately spendable object.

Write the final values to `deployments/mainnet.json`
(`protocolFeeInitializationTxDigest`, all three object IDs and
`protocolFeeAdminCapOwner`) and mirror the TypeOrigin/object IDs/owner into
`public/config.js`. Keep `canonicalSoulMintEnabled: false`. Only then run:

```bash
npm run preflight:mainnet
```

## 4. Configure the Public Runtime

Edit `public/config.js`:

```js
window.ANIMACRAFT_CONFIG = {
  network: 'mainnet',
  grpcUrl: 'https://fullnode.mainnet.sui.io:443',
  graphqlUrl: 'https://graphql.mainnet.sui.io/graphql',
  packageId: '0xCURRENT_CALLABLE_PACKAGE_ID',
  callablePackageId: '0xCURRENT_CALLABLE_PACKAGE_ID',
  originalPackageId: '0xFIRST_PUBLISHED_PACKAGE_ID',
  paymentCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  paymentCoinSymbol: 'USDC',
  paymentCoinDecimals: 6,
  walrusAggregatorUrl: 'https://aggregator.walrus-mainnet.walrus.space',
  walrusUploadRelayUrl: 'https://upload-relay.mainnet.walrus.space',
  // Client-side safety ceiling (0.1 SUI), not the amount charged. The publish
  // dialog shows the relay's exact live quote before the signature request.
  walrusRelayMaxTipMist: 100000000,
  walrusEpochs: 53,
  featuredMakers: {},
  appUrl: 'https://animacraft.soulidity.ai',
  soulidityAppUrl: 'https://www.soulidity.ai',
  soulidityIntegrationPath: '/integrations/animacraft',
  soulidityPackageId: '0x60bf39455f90e2af94381f2434d2c013c4e38a12fd16873ac296a26660f92ecd',
  soulidityCallablePackageId: '0x60bf39455f90e2af94381f2434d2c013c4e38a12fd16873ac296a26660f92ecd',
  souliditySealNamespacePackageId: '0xa43cc9a94caa904a97316d97c08804369ee8fbe3335d2ddae154022d7d6e5d5d',
  soulidityTypeOriginPackageId: '0xa43cc9a94caa904a97316d97c08804369ee8fbe3335d2ddae154022d7d6e5d5d',
  compositionV6SoulOwnerProofTypeOriginPackageId: '0x60bf39455f90e2af94381f2434d2c013c4e38a12fd16873ac296a26660f92ecd',
  compositionV6SoulOwnerProofType: '',
  protocolFeePackageId: '0xV4_PROTOCOL_FEE_TYPE_ORIGIN_PACKAGE',
  protocolFeeConfigId: '',
  protocolTreasuryId: '',
  protocolFeeAdminCapId: '',
  protocolFeeAdminCapOwner: '',
  primaryProtocolFeeBps: 5000,
  canonicalSoulMintEnabled: false
};
```

`callablePackageId` is the current package version used by every Move call. `originalPackageId`
is the first published package address and remains the type and event identity after upgrades.
Keep the legacy `packageId` alias equal to `callablePackageId`; older one-field configurations
remain supported and treat that one value as both identities. After an upgrade, change only
`packageId` and `callablePackageId`. Never change `originalPackageId`, or existing
`OCMaker`, `MakerAdminCap`, `MakerTreasury`, `CreatorProfile`, and `OCMakerPublished`
records will disappear from client discovery.

`protocolFeePackageId` is a third, deliberately stable identity: the v4
upgrade package that first defines `ProtocolFeeConfig`, `ProtocolTreasury`, and
`ProtocolFeeAdminCap`. Set it to the v4 callable package when those objects are
initialized. Do not change it during a later v5+ upgrade; only
`packageId`/`callablePackageId` move forward. The strict preflight checks the
three fee objects against this TypeOrigin instead of incorrectly assuming that
new v4 types came from the original v3 package.

After the separate Soulidity package and adapter are published, set
`soulidityPackageId`. Run `npm run preflight:integration` only after the
Soulidity legacy market is paused and retired, the V2 objects are recorded and
read back, and both chain gates are intentionally enabled.

`featuredMakers` is only a curated fallback. The public gallery discovers all `OCMakerPublished` events through Sui GraphQL and hydrates each Maker from its certified Walrus manifest.

Keep `canonicalSoulMintEnabled: false` until the Animacraft v4 and Soulidity adapter upgrades are both source-verified. The one-time initializer consumes the package `Publisher`, creates the native-USDC `ProtocolFeeConfig` and `ProtocolTreasury` with the integration gate disabled, and seals that Publisher inside `ProtocolFeeAdminCap`; do not retry initialization after an RPC timeout until the first transaction digest has been resolved. Record all three object IDs and the expected AdminCap owner. Set the chain gate and `canonicalSoulMintEnabled` to `true` only after the objects cross-reference one another, the AdminCap owner is verified, the dedicated `/integrations/animacraft` route has passed the signed recovery test, and the Mainnet smoke evidence is attached. The strict preflight verifies these invariants and switches its expected Soulidity function when this gate changes.

The sample Mysten Sui endpoints are appropriate for the five-creator pilot, but the public fullnode is rate-limited. Replace `grpcUrl` and, where available, `graphqlUrl` with monitored dedicated Mainnet infrastructure before unrestricted traffic. Animacraft keeps these as public runtime values; provider credentials must never be embedded in the browser bundle.

`walrusEpochs: 53` requests the current Mainnet maximum, approximately two years at 14 days per epoch. It increases WAL cost compared with a short pilot upload. Record each Quilt Blob object and establish a renewal calendar before expiry; Walrus retention is extendable but not perpetual without renewal.

The player retries newly certified Walrus manifests and render layers with bounded exponential backoff because a CDN-backed aggregator can briefly return a cached `404` immediately after certification.

Only public values belong in this file. Vercel serves `config.js` with `no-store` so a package/config correction is not hidden behind a stale browser cache.

## 5. Deploy Vercel

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

## 6. Connect the Subdomain

1. Add `animacraft.soulidity.ai` to the Vercel project.
2. Add the CNAME or provider-specific DNS record Vercel shows.
3. Wait for TLS issuance.
4. Update `appUrl` if the final origin differs, redeploy, and verify both apex navigation and deep rewrites.

## 7. Signed Mainnet Smoke Test

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
9. Enable a small USDC price with the Cap wallet, complete one paid canonical Soul mint, and verify the protocol receives floor(50%) while the linked Maker Treasury receives the exact remainder.
10. Withdraw the Maker share with the Cap wallet and verify the recipient balance and withdrawal event.
11. Confirm the dedicated Soulidity handoff, Living Content files, Walrus image, recipe, policy/payment snapshots, and the Move-verified SHA-256 BCS recipe hash.
12. List and buy that Soul from a third wallet. Verify Soulidity receives 2.5% and the immutable 0%-5% Maker royalty reaches the matching Maker Treasury once; generic listing and purchase entries must both reject the same Soul.
13. Interrupt projection sync after one successful mint transaction, reload the integration page, and verify `Resume Soulidity sync` does not request another mint signature.

Record all transaction digests and object ids in the release PR.

## Mainnet Cost and Recovery

- SUI pays transaction gas and upload-relay tips.
- WAL pays Walrus storage registration.
- Maker and OC upload checkpoints survive reload in the same browser profile.
- Certified Walrus data and Sui objects are not deleted when a local draft is removed.
- A published Maker's art and composition rules are immutable; publish a new version to change them. Its Cap owner may change future mint economics and archive state.

## Separate Soulidity Deployment

Do not combine the two packages into one publish transaction. Publish the
Animacraft upgrade first. In Soulidity's dependency replacement, keep the
Animacraft original package as `original-id` and set `published-at` to the
reviewed Animacraft v4 callable package so the v4 authorization ABI is actually
available. Review that exact pair with the Soulidity developers, then publish
Soulidity with its own `UpgradeCap`. Animacraft and Soulidity must have separate
multisig custody records and release tags.

## Rollback

If the web release is faulty, roll Vercel back to the previous deployment. If a Maker is faulty, archive it; do not attempt to erase history. If the Move package needs an upgrade, stop onboarding, publish the reviewed upgrade through the documented `UpgradeCap` policy, update runtime config only if required, and repeat the smoke test.
