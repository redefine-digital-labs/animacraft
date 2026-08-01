import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const runtimeSource = await readFile(new URL('../chain-runtime.js', import.meta.url), 'utf8');

test('Player workspace exposes verified v5 state and real purchase callbacks', () => {
  assert.match(appSource, /getPlayerCommerceState\(\{ document \}\)/);
  assert.match(appSource, /onPurchaseMakerAccess\(payload\)/);
  assert.match(appSource, /onPurchaseExpansionPack\(payload\)/);
  assert.match(appSource, /buildPurchaseMakerAccessV5\(\{/);
  assert.match(appSource, /buildPurchasePackV5\(\{/);
  assert.match(appSource, /signExecuteAndWait\(transaction,\s*\{\s*expectedWallet:/);
  assert.match(appSource, /queryOwnedCommerceV5State\(client,/);
  assert.match(appSource, /queryPackRecordsV5\(client, chain\.root\)/);
  assert.match(appSource, /assertCommerceV5TypeOrigins\(chain\)/);
});

test('FREE Packs use verified root policy without creating a claim transaction', () => {
  const freeBranch = appSource.match(
    /if \(pack\.accessKind === COMMERCE_V5_ACCESS\.FREE\) \{([\s\S]*?)\n  \}/,
  )?.[1] || '';
  assert.match(freeBranch, /ownedPackIds:/);
  assert.match(freeBranch, /freeAccess: true/);
  assert.doesNotMatch(freeBranch, /signExecuteAndWait|buildClaimFreePackV5|confirmed: true/);
});

test('Complete hashes exact Style selections and hands certified inputs to the atomic Soulidity adapter', () => {
  assert.match(appSource, /simulateCompleteQuoteV5\(getSuiClient\(\),/);
  assert.match(appSource, /hashCompleteSelectionV5\(\s*chainRecipe,\s*v4Bundle\.styleSelections,/);
  assert.match(appSource, /requirePlayerCommerceV5\(state\.makerDocumentV4,\s*\{\s*force: true,/);
  assert.match(appSource, /commerce\.binding\?*\.rootObjectId[\s\S]*commerce\.chain\.root\.objectId/);
  assert.match(appSource, /commerce\.binding\?*\.makerTreasuryObjectId[\s\S]*commerce\.chain\.makerTreasury\.objectId/);
  assert.doesNotMatch(appSource, /COMMERCE_V5_ATOMIC_SOUL_ADAPTER_REQUIRED/);
  assert.doesNotMatch(appSource, /requireCommerceV5AtomicSoulAdapter/);
  assert.doesNotMatch(appSource, /appendCompleteAuthorizationV5/);
});

test('Composable v6 Complete is gate-closed and binds its immutable Appearance companion to upload recovery', () => {
  const prepare = appSource.slice(
    appSource.indexOf('async function prepareOcUpload'),
    appSource.indexOf('\nasync function registerOcUpload'),
  );
  const restore = appSource.slice(
    appSource.indexOf('async function restoreOcUploadRecovery'),
    appSource.indexOf('\nasync function resumeMakerUploadRecovery'),
  );
  assert.match(prepare, /runtimeConfig\.compositionV6ReleaseEnabled !== true/);
  assert.match(prepare, /COMPOSABLE_V6_RELEASE_DISABLED/);
  assert.match(prepare, /buildComposableV6OcAppearanceCompanion\(\{/);
  assert.match(prepare, /composableAppearance,/);
  assert.match(appSource, /attachComposableV6OcAppearanceCompanion\(bundle, composableAppearance\)/);
  assert.match(restore, /verifyComposableV6OcAppearanceCompanion\(\{/);
  assert.ok(
    restore.indexOf('verifyComposableV6OcAppearanceCompanion({')
      < restore.indexOf('state.playerCompletionSnapshotV4 = createPlayerCompletionSnapshot({'),
    'recovery must verify the exact v6 Appearance before restoring the completion snapshot',
  );
});

test('the Soulidity v5 handoff never downgrades a migrated Maker to plaintext', () => {
  const handoff = appSource.slice(
    appSource.indexOf('async function mintCurrentOc'),
    appSource.indexOf('\nasync function restoreMakerDraft'),
  );
  assert.match(
    handoff,
    /oc\?\.completeOutput[\s\S]*oc\?\.commerce\?\.chainBinding[\s\S]*activeChainMakerRequiresCommerceV5Complete/,
  );
  assert.match(handoff, /requirePlayerCommerceV5\(state\.makerDocumentV4,\s*\{\s*force: true,/);
  assert.match(handoff, /!commerce\.binding\?\.rootObjectId/);
  assert.match(handoff, /!commerce\.binding\?\.makerTreasuryObjectId/);
  assert.match(handoff, /COMMERCE_V5_HANDOFF_BINDING_MISSING/);
  assert.match(handoff, /commerceRoot:\s*commerce\.chain\.root\.objectId/);
  assert.match(handoff, /commerceTreasury:\s*commerce\.chain\.makerTreasury\.objectId/);
  assert.doesNotMatch(handoff, /commercialTreasury/);
});

test('v5 Complete protects the exact final PNG and exposes only a separate preview before receipt verification', () => {
  const prepare = appSource.slice(
    appSource.indexOf('async function prepareOcUpload'),
    appSource.indexOf('\nasync function registerOcUpload'),
  );
  const handoff = appSource.slice(
    appSource.indexOf('async function mintCurrentOc'),
    appSource.indexOf('\nasync function restoreMakerDraft'),
  );
  assert.match(prepare, /const image = useV4 \? completion\.imageBlob : await renderOcImageBlob\(\)/);
  assert.match(prepare, /encryptMakerCompleteOutputV5\(\{[\s\S]*?outputBlob:\s*image/);
  assert.match(prepare, /sealPackageId:\s*runtimeConfig\.soulidityPackageId/);
  assert.match(prepare, /createOcOutputPreviewBlobV5\(image\)/);
  assert.match(prepare, /pendingOcEncryptedImageBlob = encryptedOutput\.blob/);
  assert.match(prepare, /ciphertextIdentifier:\s*'animacraft-oc-output\.seal'/);
  assert.match(prepare, /publicPreviewIdentifier:\s*'animacraft-oc-preview\.png'/);
  assert.match(handoff, /imagePreviewBlob:\s*state\.ocPreviewPatchId/);
  assert.match(handoff, /outputSealId:\s*state\.pendingOcOutputDescriptor\.outputSealId/);
  assert.match(handoff, /outputNonce:\s*state\.pendingOcOutputDescriptor\.outputNonce/);
  assert.match(handoff, /outputDigest:\s*state\.pendingOcOutputDescriptor\.outputDigest/);
  assert.match(handoff, /const imageUrl = commerceV5HandoffRequired\s*\?\s*walrusFileUrl\(state\.ocPreviewPatchId\)/);
  assert.match(
    handoff,
    /if \(commerceV5HandoffRequired\) \{[\s\S]*?soulidityCompletionWindow = opened;[\s\S]*?\} else \{[\s\S]*?createSoulidityImportBundle/,
  );
});

test('v5 completion callbacks and restored receipts fail closed against stale windows, contexts and local PNGs', () => {
  const callback = appSource.slice(
    appSource.indexOf('async function handleSoulidityCompletionMessage'),
    appSource.indexOf('\nwindow.addEventListener'),
  );
  const restore = appSource.slice(
    appSource.indexOf('async function restoreOcUploadRecovery'),
    appSource.indexOf('\nasync function resumeMakerUploadRecovery'),
  );
  assert.match(callback, /event\.origin !== expectedOrigin/);
  assert.match(callback, /event\.source !== sourceWindow/);
  assert.match(callback, /soulidityCompletionReceiptPending/);
  assert.match(callback, /verifyPendingOcCompleteOutputPlaintextV5\(\{\s*requireBound:\s*true/);
  assert.match(callback, /uploadSessionId:\s*state\.ocUploadSession\?\.uploadSessionId/);
  assert.match(callback, /outputDescriptorJson:\s*JSON\.stringify\(descriptor\)/);
  assert.match(callback, /verifySoulidityCompletionReceiptV5\(\{/);
  assert.match(callback, /state\.pendingOcCompletionReceipt = receipt;[\s\S]*?persistOcUploadRecovery\(\)/);
  assert.match(restore, /const protectedOutputRequired = Boolean\(/);
  assert.match(restore, /const protectedOutputEvidence = Boolean\(/);
  assert.match(restore, /protectedOutputRequired \|\| protectedOutputEvidence/);
  assert.match(restore, /await recovery\.profileBlob\.text\(\) !== JSON\.stringify\(recovery\.ocPackage\)/);
  assert.match(restore, /verifyMakerCompleteOutputCiphertextV5\(\{/);
  assert.ok(
    restore.indexOf('verifyMakerCompleteOutputCiphertextV5({')
      < restore.indexOf('resumeWalrusUpload(recoveryEntries, recovery)'),
    'recovered Complete ciphertext must be verified before resumeWalrusUpload',
  );
  assert.match(restore, /verifyPendingOcCompleteOutputPlaintextV5\(\{\s*requireBound:\s*false/);
  assert.match(restore, /A persisted receipt is evidence to re-check, never authority by itself/);
  assert.match(restore, /verifySoulidityCompletionReceiptV5\(\{/);
  assert.match(restore, /if \(state\.pendingOcCompletionReceipt\?\.confirmed\) \{\s*state\.mintStatus = t\('soulHandoffVerified'\)/);
});

test('register verifies the exact Complete ciphertext before any Walrus write', () => {
  const register = appSource.slice(
    appSource.indexOf('async function registerOcUpload'),
    appSource.indexOf('\nasync function certifyOcUpload'),
  );
  assert.match(register, /verifyPendingOcCompleteOutputCiphertextBeforeUploadV5\(\)/);
  assert.ok(
    register.indexOf('verifyPendingOcCompleteOutputCiphertextBeforeUploadV5()')
      < register.indexOf('registerAndUploadWalrus(session,'),
    'Complete ciphertext verification must precede registerAndUploadWalrus',
  );
});

test('v5 binding fields and runtime reads survive reload while the release gate remains additive', () => {
  [
    'commerceV5RootObjectId',
    'commerceV5MakerTreasuryObjectId',
    'commerceV5ControlCapObjectId',
    'commerceV5ControlVaultObjectId',
    'commerceV5ListingObjectId',
  ].forEach((field) => {
    assert.ok(appSource.split(field).length > 5, `${field} must be wired through app persistence`);
  });
  assert.match(appSource, /runtimeConfig\.commerceV5ReleaseEnabled !== true/);
  assert.match(runtimeSource, /export function getSuiClient\(\)/);
  assert.match(runtimeSource, /export async function signExecuteAndWait\(/);
  assert.match(runtimeSource, /export async function findCommerceV5MigrationByLegacyMaker\(/);
  assert.match(runtimeSource, /LegacyMakerMigratedToV5/);
});

test('Complete protection is derived from durable migration evidence, not only the release switch', () => {
  const requirement = appSource.slice(
    appSource.indexOf('async function activeChainMakerRequiresCommerceV5Complete'),
    appSource.indexOf('\nfunction applyActiveCommerceV5Binding'),
  );
  const prepare = appSource.slice(
    appSource.indexOf('async function prepareOcUpload'),
    appSource.indexOf('\nasync function registerOcUpload'),
  );
  assert.match(
    requirement,
    /binding\.rootObjectId \|\| binding\.makerTreasuryObjectId/,
  );
  assert.match(
    requirement,
    /getMakerObjects\(\s*\[\s*binding\.legacyMakerId\s*\][\s\S]*expectedStructName:\s*'OCMaker'/,
  );
  assert.match(
    requirement,
    /legacyPublished[\s\S]*legacyMintingEnabled[\s\S]*legacyArchivedIsKnown[\s\S]*!legacyArchived/,
  );
  assert.match(
    requirement,
    /findCommerceV5MigrationByLegacyMaker\(\s*binding\.legacyMakerId/,
  );
  assert.doesNotMatch(requirement, /\bcatch\s*\(/);
  assert.match(requirement, /return true;\s*\n}/);
  assert.match(
    prepare,
    /await activeChainMakerRequiresCommerceV5Complete\(/,
  );
  assert.doesNotMatch(
    prepare,
    /const commerceV5CompleteRequired = Boolean\(\s*runtimeConfig\.commerceV5ReleaseEnabled/,
  );
});

test('paid Maker publication and recovery never downgrade a protected bundle to source PNGs', () => {
  const restore = appSource.slice(
    appSource.indexOf('async function restoreMakerUploadRecovery'),
    appSource.indexOf('\nasync function restoreOcUploadRecovery'),
  );
  const publish = appSource.slice(
    appSource.indexOf('async function publishCurrentMaker'),
    appSource.indexOf('\nasync function reviewPendingMakerPublication'),
  );
  assert.match(
    restore,
    /sourceRequiresSeal\s*!==\s*Boolean\(recovery\.sealRecovery\)/,
  );
  assert.match(
    restore,
    /sourceRequiresSeal[\s\S]*restoreMakerSealPublicationBundleV5/,
  );
  assert.doesNotMatch(
    restore,
    /recovery\.sealRecovery\s*\?\s*await restoreMakerSealPublicationBundleV5/,
  );
  assert.match(
    publish,
    /expectedSourceManifestJson[\s\S]*creatorUploadManifest/,
  );
  assert.match(
    publish,
    /pendingProtectedManifestJson\s*!==\s*state\.pendingMakerManifestJson/,
  );
  assert.match(
    publish,
    /makerSealRecoveryPayloadV5\(pendingBundle\)[\s\S]*verifyMakerSealRecoveryPayloadV5/,
  );
});

test('canonical logical rows are protocol-bound before every Maker Walrus write', () => {
  const protocolRead = appSource.slice(
    appSource.indexOf('async function queryCanonicalCommerceV5LogicalAuxiliaryBlobId'),
    appSource.indexOf('\nasync function queryMakerCommerceV5Publication'),
  );
  const prepare = appSource.slice(
    appSource.indexOf('async function prepareMakerUpload'),
    appSource.indexOf('\nasync function registerMakerUpload'),
  );
  const restore = appSource.slice(
    appSource.indexOf('async function restoreMakerUploadRecovery'),
    appSource.indexOf('\nasync function restoreOcUploadRecovery'),
  );
  const publish = appSource.slice(
    appSource.indexOf('async function publishCurrentMaker'),
    appSource.indexOf('\nasync function reviewPendingMakerPublication'),
  );
  assert.match(protocolRead, /queryMakerCommerceV5Protocol\(\{/);
  assert.match(protocolRead, /protocol\.logicalAuxiliaryBlobId/);
  assert.match(protocolRead, /runtimeConfig\.commerceV5LogicalAuxiliaryBlobId/);
  assert.match(protocolRead, /protocol\.soulBindingProofType/);
  assert.match(protocolRead, /runtimeConfig\.commerceV5SoulBindingProofType/);
  assert.match(protocolRead, /expectedBlobId && chainBlobId !== String\(expectedBlobId\)\.trim\(\)/);
  assert.match(prepare, /queryCanonicalCommerceV5LogicalAuxiliaryBlobId\(\)/);
  assert.match(prepare, /buildMakerV4PublicationBundle\([\s\S]*logicalAuxiliaryBlobId/);
  assert.ok(
    prepare.indexOf('queryCanonicalCommerceV5LogicalAuxiliaryBlobId()')
      < prepare.indexOf('prepareWalrusUpload(makerUploadEntries())'),
    'canonical protocol binding must be verified before Maker Quilt encoding or upload',
  );
  assert.match(restore, /recoverySourceManifest\?\.moveProjectionV2\?\.commerce/);
  assert.match(restore, /expectedBlobId:\s*recoveryLogicalAuxiliaryBlobId/);
  assert.match(restore, /buildMakerV4PublicationBundle\([\s\S]*logicalAuxiliaryBlobId:\s*canonicalLogicalAuxiliaryBlobId/);
  assert.ok(
    restore.indexOf('queryCanonicalCommerceV5LogicalAuxiliaryBlobId({')
      < restore.indexOf('resumeWalrusUpload(uploadEntries, recovery)'),
    'recovery must revalidate the immutable canonical Blob before resumeWalrusUpload',
  );
  assert.match(publish, /expectedBlobId:\s*pendingLogicalAuxiliaryBlobId/);
  assert.match(publish, /buildMakerV4MoveSummaryV2\([\s\S]*logicalAuxiliaryBlobId:\s*canonicalLogicalAuxiliaryBlobId/);
});

test('an untouched free Maker remains a legacy v4 release while the v5 gate is closed', () => {
  const releaseDocument = appSource.slice(
    appSource.indexOf('function makerV4DocumentForRelease'),
    appSource.indexOf('\nasync function makerV4RuntimeAssetsForRelease'),
  );
  assert.match(releaseDocument, /!commerceV5ReleaseEnabled/);
  assert.match(releaseDocument, /!makerCommerceV5RequiresRelease\(/);
  assert.match(releaseDocument, /delete documentV4\.commerce/);
});
