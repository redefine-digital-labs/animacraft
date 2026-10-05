import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readApprovedUiDonor } from './fixtures/approved-ui-donors/read-donor.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ORIGINAL_PURE_VIEWS = Object.freeze({
  'docs-center.js': 'e5e2b033322e431b279bf573a01bd8882f5546311959b2e867e98c060bd40647',
  'docs-center-content.js': 'e18635e470971cf15d967a93deff1ab5f3d96b70eac0a58bd85bf29f6d78db64',
  'docs-center-figures.js': 'e9ee5571098ed2c41849d840e461e00bd92b68d9d39c9f1aaa6be0160e2464b9',
  'maker-workspace-i18n.js': '29f4250b6cb59db1e41e26c63c512eb671b72373ca5f47b0d90257dd5a2eb514',
  'expansion-pack-lifecycle-i18n.js': '089fdc7c0fb5590ddd062ead428303851c57c7c8a097089d465eafe95d385019',
  'maker-definition-rule-control.js': '990a93c2222e9f4c3d6552a6ec50d76e02786c2be764f9bf929e7951b630750b',
});

const forbiddenJsonRpc = /@mysten\/sui\/(?:jsonrpc|client)|SuiJsonRpcClient|getJsonRpcFullnodeUrl|JsonRpcProvider|["']jsonrpc["']\s*:\s*["']2\.0["']|\bjsonRpcClient\b/i;
const forbiddenTransactionConstruction = /\bnew\s+Transaction(?:Block)?\s*\(|\bTransaction(?:Block)?\.from\s*\(|\.\s*(?:moveCall|splitCoins|mergeCoins|transferObjects|publish|upgrade)\s*\(|\b(?:signAndExecuteTransaction|executeTransactionBlock|dryRunTransactionBlock|devInspectTransactionBlock)\s*\(/;
const embeddedPackageOrObjectId = /\b0x[0-9a-f]{64}\b/i;
const retiredAuthorityImport = /^\s*import\b[^\n]*(?:chain-runtime|maker-v4|maker-publication-v4|maker-commerce-v5|maker-commerce-chain-v5|maker-commerce-publication-v5|maker-seal-v5|maker-composable|maker-physical-v7|expansion-pack-publication|expansion-pack-lifecycle(?!-i18n)|expansion-pack-player|oc-handoff|completion-receipt-v5|walrus-certification)/im;

test('unchanged original pure-view sources remain byte locked to aac90dbc', () => {
  for (const [file, expected] of Object.entries(ORIGINAL_PURE_VIEWS)) {
    if (file === 'maker-workspace-i18n.js') continue; // Explicit workflow deltas checked below.
    const digest = createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex');
    assert.equal(digest, expected, `${file} must remain byte-identical to the approved source`);
  }
});

test('workflow locale deltas preserve every other historical key and translation', async () => {
  const file = 'maker-workspace-i18n.js';
  const source = readApprovedUiDonor(file);
  assert.equal(createHash('sha256').update(source).digest('hex'), ORIGINAL_PURE_VIEWS[file]);
  const historicalSource = source.replace("'./expansion-pack-lifecycle-i18n.js'",
    JSON.stringify(pathToFileURL(join(ROOT, 'expansion-pack-lifecycle-i18n.js')).href));
  const historical = await import(`data:text/javascript;base64,${Buffer.from(historicalSource).toString('base64')}`);
  const current = await import(pathToFileURL(join(ROOT, file)).href);
  const changed = ['versionHistoryCopy', 'wardrobeSetupCopy', 'wardrobePartSlotCopy'];
  const added = `playerOutputSelection playerPackPaid playerPackTransactionFinalized
    playerPackAtomicUnits playerPackEntryOnly playerPackConfirm playerPackRecover playerPackDismiss
    playerCommerceNotQuoted playerControlUnavailable playerStepMakerAccess playerStepPackAccess playerStepStartAnother
    playerStepOpenSoul playerStepStartAnotherCopy playerStepRecoveredOtherDraft playerStepBaseItem
    playerStepLoadout playerStepComplete playerStepRenderUpload playerStepNativeUpload playerStepEnvelopes
    playerStepGasBudget playerEnvelopeRecoveryExport playerEnvelopeRecoveryImport playerEnvelopeRecoveryClear
    playerEnvelopeRecoveryCopy playerStepEnvelopesCopy playerStepConfirm playerStepCancel playerStepCancelCopy
    playerStepStorageCopy playerStepEntryCopy playerStepNoBusinessFee playerStepFreeRemaining
    playerStepTotalRemaining playerStepPolicyPrice playerStepRightsCopy playerStepQuoteCopy
    playerOverviewTitle playerOverviewEntry playerOverviewComplete playerOverviewTotal playerOverviewEntryNeeded
    playerOverviewEntryHeld playerOverviewContinue playerOverviewCopy playerOverviewRightsCopy
    saveRecoveryCopy savingRecoveryCopy localRecoveryCopy saveRecoveryCopyHint recoveryCopyRetry
    playerSlotCapacityFull
    publicationReview publicationCopy publicationSign publicationContinue publicationRefresh
    publicationUnknown publicationGas publicationStorage publicationRelay publicationTerms
    publicationWallet publicationStage publicationAssets publicationStale publicationUnavailable
    publicationComplete publicationLoading publicationEarlier publicationGasPrice publicationOpen
    publicationFlowCopy publicationResourceProgress publicationQuoteScope publicationRecoveryCopy
    publicationInProgress publicationAssetBatch publicationBatchQuoteScope
    publicationThreeStageTitle publicationThreeStageCopy publicationUploadAndCertify publicationCurrentResource publicationCheckTransaction publicationContinuePublish publicationContinueCertify publicationContinueUpload publicationContinueRegister publicationResultPending publicationPublishSaved publicationCertifySaved publicationUploadReady publicationRegisterSaved publicationPublishReview publicationCertifyReview publicationRegisterReview publicationSignPublish publicationSignCertify publicationSignRegister publicationResourceReady publicationContinueResources
    chainHistory chainCopy chainLocal chainCurrentUnpublished chainNext chainRevisions
    chainArchiveReview chainArchiveSign chainArchiveRecover chainSuccessor chainArchiveDigest
    chainLoading chainUnavailable chainEmpty chainPreparing chainArchiveImpact chainArchiveSaved
    chainSuccessorReady`.trim().split(/\s+/).sort();
  assert.deepEqual(current.MAKER_WORKSPACE_LOCALES, historical.MAKER_WORKSPACE_LOCALES);
  const placeholders = text => [...text.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort();
  for (const locale of historical.MAKER_WORKSPACE_LOCALES) {
    const before = historical.makerWorkspaceDictionary(locale), after = current.makerWorkspaceDictionary(locale);
    assert.deepEqual(Object.keys(before).filter(key => !(key in after)), ['playerCommerceFree']);
    assert.deepEqual(Object.keys(before).filter(key => key in after && before[key] !== after[key]).sort(), [...changed].sort());
    assert.deepEqual(Object.keys(after).filter(key => !(key in before)).sort(), added);
    assert.match(after.versionHistoryCopy, /100/, 'Retained checkpoint limit must stay visible.');
    for (const key of [...changed, ...added]) {
      assert.equal(typeof after[key], 'string');
      assert.ok(after[key].trim().length > 0, `${locale}/${key} is missing`);
      assert.deepEqual(placeholders(after[key]), placeholders(current.makerWorkspaceDictionary('en')[key]), `${locale}/${key} placeholders`);
    }
  }
});

test('approved original pure-view sources pass Node syntax checks and imports', async () => {
  for (const file of Object.keys(ORIGINAL_PURE_VIEWS)) {
    const path = join(ROOT, file);
    const checked = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    assert.equal(checked.status, 0, `${file} syntax check failed:\n${checked.stderr}`);
    const module = await import(pathToFileURL(path).href);
    assert.equal(typeof module, 'object', `${file} must remain importable as an ES module`);
  }
});

test('approved original pure-view sources contain no transport or chain authority', () => {
  for (const file of Object.keys(ORIGINAL_PURE_VIEWS)) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    assert.doesNotMatch(source, forbiddenJsonRpc, `${file} must not contain JSON-RPC transport`);
    assert.doesNotMatch(source, forbiddenTransactionConstruction, `${file} must not construct transactions`);
    assert.doesNotMatch(source, embeddedPackageOrObjectId, `${file} must not embed old package or object IDs`);
    assert.doesNotMatch(source, retiredAuthorityImport, `${file} must not import retired chain authority`);
  }
});
