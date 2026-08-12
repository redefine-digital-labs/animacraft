import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

function section(from, to) {
  const start = app.indexOf(from);
  const end = app.indexOf(to, start + from.length);
  assert.notEqual(start, -1, `missing ${from}`);
  assert.notEqual(end, -1, `missing ${to}`);
  return app.slice(start, end);
}

test('v8 Player discovery requires package identity while the release gate controls only new sales', () => {
  const hydration = section(
    'async function hydratePlayerExpansionPacksV8',
    '\nasync function purchasePlayerMakerAccessV5',
  );
  assert.ok(
    hydration.indexOf('!expansionPackV8RuntimeConfigured()')
      < hydration.indexOf('getSuiClient()'),
    'missing v8 package identities must return before constructing a chain client',
  );
  assert.match(hydration, /salesEnabled: runtime\.expansionPackV8ReleaseEnabled === true/);
  assert.match(hydration, /expansionPackParentReleaseForDocument\(document\)/);
  assert.match(hydration, /commerce\.chain\?\.root\?\.objectId/);
  assert.match(hydration, /commerce\.chain\?\.root\?\.legacyMakerId/);
  assert.match(hydration, /const eventAdapter = createGraphqlMoveEventAdapter\(\)/);
  assert.match(
    hydration,
    /const discoveryClient = Object\.freeze\(\{\s*queryEvents: \(request\) => eventAdapter\.queryEvents\(request\),\s*getObjects: \(request\) => client\.getObjects\(request\),\s*\}\)/,
  );
  assert.match(hydration, /queryExpansionPackReleasesV8\(discoveryClient,/);
  assert.match(hydration, /queryOwnedExpansionPackPassesV8\(client,/);
  assert.match(hydration, /responseBytesWithinLimit\(/);
  assert.match(hydration, /queryExpansionPackStyleRecordsV8\(client,/);
  assert.match(hydration, /verifyExpansionPackPlayerReleaseV8\(\{/);
  assert.match(hydration, /manifestBytes,/);
  assert.match(hydration, /styleRecords,/);
  assert.match(hydration, /passes,/);
  assert.match(hydration, /expectedSealPackageId: runtime\.expansionPackV8TypeOriginPackageId/);
  assert.match(hydration, /materializeExpansionPackPlayerEntryV8\(verified,/);
  assert.match(
    hydration,
    /sealPublicPolicy: expansionPackV8DeploymentSealPublicPolicy\(\)/,
  );
  assert.match(app, /walrusFileUrl\(assetBlobId\)/);
  assert.match(app, /releaseId: String\(entry\.releaseId \|\| ''\)/);
});

test('v8 acquisition trusts neither a local id nor a transaction digest by itself', () => {
  const acquisition = section(
    'async function acquirePlayerExpansionPackV8',
    '\nfunction expansionPackParentReleaseForDocument',
  );
  assert.match(acquisition, /hydratePlayerExpansionPacksV8\(document, \{ force: true \}\)/);
  assert.match(acquisition, /candidate\.releaseId/);
  assert.match(acquisition, /entry\.access\.availableForAcquire/);
  assert.match(acquisition, /buildClaimFreeExpansionPackV8\(\{/);
  assert.match(acquisition, /buildPurchaseExpansionPackV8\(\{/);
  assert.match(
    acquisition,
    /signTransactionForRecovery\(transaction, \{ expectedWallet: wallet \}\)/,
  );
  assert.match(
    acquisition,
    /requireExpansionPackV8DeploymentSealPolicy\(entry\);\s*const signed = await signTransactionForRecovery/,
  );
  assert.match(
    acquisition,
    /executeSignedTransactionAndWait\(pendingRecovery\.signed, \{/,
  );
  assert.doesNotMatch(acquisition, /signExecuteAndWait\(/);
  assert.match(acquisition, /persistSignedTransaction\(recoveryIdentity, signed,/);
  assert.ok(
    acquisition.indexOf('persistSignedTransaction(recoveryIdentity, signed,')
      < acquisition.indexOf('executeSignedTransactionAndWait(pendingRecovery.signed,'),
    'exact signed bytes must be durable before broadcast',
  );
  assert.match(acquisition, /getConnectedWalletAddress\(\)/);
  assert.match(acquisition, /storeVerifiedReceipt\(/);
  assert.match(acquisition, /cleanupPending\(/);
  assert.ok(
    acquisition.indexOf('.storeVerifiedReceipt(')
      < acquisition.indexOf('.cleanupPending('),
    'verified Pass receipt must be durable before replay bytes are cleaned up',
  );
  assert.match(acquisition, /readExpansionPackV8Submission\(\{/);
  assert.match(acquisition, /readback\?\.entitlementGranted/);
  assert.match(acquisition, /error\?\.code === 'TRANSACTION_FINALIZED_FAILURE'/);
  assert.match(acquisition, /await expansionPackPlayerAcquisitionRecoveryStore\.storeFinalizedFailure\(/);
  assert.ok(
    acquisition.indexOf('.storeFinalizedFailure(')
      < acquisition.indexOf('state: EXPANSION_PACK_PLAYER_ACQUISITION_STATE.OUTCOME_PENDING'),
    'a definitive failed digest must be archived before the ambiguous-outcome branch',
  );
  assert.match(acquisition, /acquired\.access\.pass\.objectId/);
  assert.match(acquisition, /acquired\.access\.pass\.contentCommitment/);
  assert.match(
    acquisition,
    /assertBeforeExecute: \(\) => \{[\s\S]*?requireExpansionPackV8DeploymentSealPolicy\(entry\);[\s\S]*?\}/,
  );
  assert.match(
    acquisition,
    /requireExpansionPackV8DeploymentSealPolicy\(entry\);\s*pendingRecovery = await expansionPackPlayerAcquisitionRecoveryStore\.checkpointPending/,
  );
});

test('paid v8 Player separates acquisition readiness from verified Seal plaintext', () => {
  const resolver = section(
    'async function resolveExpansionPackV8RuntimeAsset',
    '\nfunction activeCommerceV5Binding',
  );
  assert.match(resolver, /entry\?\.release\?\.sealPackageId/);
  assert.match(resolver, /entry\?\.parent\?\.ownershipEpoch/);
  assert.match(resolver, /entry\?\.release\?\.admittedParentOwnershipEpoch/);
  assert.ok(
    resolver.indexOf('expansionPackV8ServerConfigsForProtection(protection)')
      < resolver.indexOf('makerSealSessionForExpansionPackV8('),
    'public server policy must match before session signing or credential use',
  );
  assert.match(resolver, /makerSealSessionForExpansionPackV8\(\s*wallet,\s*pinnedSealPackageId,/);
  assert.match(resolver, /buildExpansionPackStyleSealApprovalV8\(\{/);
  assert.match(resolver, /sealPackageId: pinnedSealPackageId/);
  assert.match(resolver, /decryptMakerSealAssetV5\(\{/);
  assert.match(resolver, /observedPlaintextSha256 !== expectedSha256/);
  assert.match(resolver, /URL\.createObjectURL\(plaintextBlob\)/);
  assert.match(resolver, /URL\.revokeObjectURL\(url\)/);
  assert.match(app, /if \(entry\.transportReady !== true\)/);
});

test('v8 Seal policy comparison strips credentials before matching and reattaches only local config', () => {
  const policy = section(
    'function expansionPackV8ServerConfigsForProtection',
    '\nfunction makerSealExpectedRegistrationsV5',
  );
  const publicProjection = section(
    'function expansionPackV8DeploymentSealPublicPolicy',
    '\nfunction expansionPackV8EntryMatchesDeploymentSealPolicy',
  );
  assert.match(publicProjection, /objectId:/);
  assert.match(publicProjection, /weight:/);
  assert.match(publicProjection, /aggregatorUrl:/);
  assert.doesNotMatch(publicProjection, /apiKey/);
  assert.ok(
    policy.indexOf('matchesExpansionPackSealPublicPolicyV8(')
      < policy.indexOf('return publicServers.map('),
    'immutable public policy must match before configured servers are returned',
  );
  assert.match(policy, /return configured;/);
  assert.doesNotMatch(policy, /descriptor\?\.apiKey/);
});

test('verified v8 state and acquisition callback are passed into the shared Workspace', () => {
  const context = section('async function syncMakerWorkspaceContext', '\nfunction renderAll');
  assert.match(context, /const syncRequestId = \+\+makerWorkspaceContextSyncRequestId/);
  assert.match(context, /syncRequestId === makerWorkspaceContextSyncRequestId/);
  assert.ok(
    context.match(/if \(!requestIsActive\(\)\) return undefined;/g)?.length >= 4,
    'every awaited hydration stage must be fenced by the outer sync request',
  );
  assert.match(
    context,
    /if \(!requestIsActive\(\)\) return undefined;\s*return makerWorkspace\.setContext\(\{/,
  );
  assert.match(context, /hydratePlayerExpansionPacksV8\(document\)/);
  assert.match(context, /expansionPackV8FailClosedState\(/);
  assert.match(context, /expansionPackV8State,/);
  assert.match(app, /async onAcquireExpansionPackV8\(payload\)/);
  assert.match(app, /return acquirePlayerExpansionPackV8\(payload\)/);
});

test('v8 publication is fenced by the exact saved draft revision and controller epoch', () => {
  const publication = section(
    'function expansionPackPublicationScope(payload)',
    '\nasync function syncMakerWorkspaceContext',
  );
  assert.match(publication, /draftRevision:/);
  assert.match(publication, /publicationRequestToken:/);
  assert.match(publication, /expansionPackPublicationRequestIsActive/);
  assert.match(publication, /invalidateExpansionPackPublicationController\(\)/);
  assert.match(publication, /requireActiveExpansionPackPublicationScope\(scope, controllerEpoch\)/);
  assert.match(publication, /controller !== expansionPackPublicationController/);
  assert.match(app, /onResetExpansionPackPublication\(\)/);
});
