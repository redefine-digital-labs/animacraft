import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const workspace = await readFile(
  new URL('../maker-workspace.js', import.meta.url),
  'utf8',
);

test('Creator Commerce v5 publication is derived only from the certified immutable projection', () => {
  const input = app.slice(
    app.indexOf('function immutableMakerCommerceV5PublicationInput'),
    app.indexOf('\nasync function exactLegacyMakerTreasuryBalanceAtomic'),
  );
  assert.match(input, /state\.pendingMakerV4Bundle\?\.manifest/);
  assert.match(input, /JSON\.stringify\(inMemoryManifest\) === manifestJson/);
  assert.match(input, /manifest = JSON\.parse\(manifestJson\)/);
  assert.match(input, /manifest\.moveProjectionV2/);
  assert.match(
    input,
    /buildMakerCommerceV5DeploymentPlan\(\s*manifest\.moveProjectionV2,\s*\)/,
  );
  assert.doesNotMatch(input, /state\.makerDocumentV4|makerV4DocumentForRelease/);
});

test('Creator Commerce v5 recovery keeps one nested sequence-CAS checkpoint without replacing upload recovery', () => {
  const persistence = app.slice(
    app.indexOf('async function persistMakerCommerceV5Publication'),
    app.indexOf('\nasync function ensureMakerCommerceV5Publication'),
  );
  assert.match(persistence, /loadMakerUploadRecovery\(scope\.recoveryKey\)/);
  assert.match(
    persistence,
    /current\.sequence !== Number\(expectedSequence\)/,
  );
  assert.match(
    persistence,
    /current\.contextIdentity !== nextCheckpoint\.contextIdentity/,
  );
  assert.match(
    persistence,
    /current\.planIdentity !== nextCheckpoint\.planIdentity/,
  );
  assert.match(
    persistence,
    /saveVerifiedUploadRecovery\(scope\.recoveryKey, \{\s*\.\.\.durable,/,
    'every non-Commerce field in the existing Walrus recovery must survive',
  );
  assert.match(persistence, /commerceV5Publication: candidate/);
});

test('each Creator continuation invokes the one-transaction publication state machine and discovers landed migration intents', () => {
  const query = app.slice(
    app.indexOf('async function queryMakerCommerceV5Publication'),
    app.indexOf('\nfunction updateMakerCommerceV5PublicationState'),
  );
  assert.match(
    query,
    /if \(!rootId \|\| !makerTreasuryId\)[\s\S]*?findCommerceV5MigrationByLegacyMaker\(\s*context\.legacyMakerId/,
  );
  assert.match(query, /queryPackRecordsV5/);
  assert.match(query, /queryStyleBindingsV5/);
  assert.match(query, /queryOwnedCommerceV5State/);

  const continuation = app.slice(
    app.indexOf('async function advanceCurrentMakerCommerceV5Publication'),
    app.indexOf('\nasync function publishCurrentMaker'),
  );
  assert.match(continuation, /advanceMakerCommerceV5Publication\(\{/);
  assert.match(
    app.slice(
      app.indexOf('function makerCommerceV5PublicationDependencies'),
      app.indexOf('\nasync function finishMakerCommerceV5Publication'),
    ),
    /signAndExecute:\s*\(transaction,[\s\S]*?signExecuteAndWait\(/,
  );
});

test('recovery is finalized only after an exact ACTIVE readback and preserves the separate listing binding', () => {
  const finish = app.slice(
    app.indexOf('async function finishMakerCommerceV5Publication'),
    app.indexOf('\nasync function reconcileCurrentMakerCommerceV5Publication'),
  );
  assert.match(finish, /reconcileMakerCommerceV5Publication\(\{/);
  assert.match(
    finish,
    /checkpoint\.stage !== MAKER_COMMERCE_PUBLICATION_V5_STAGES\.ACTIVE[\s\S]*?checkpoint\.completed !== true[\s\S]*?checkpoint\.readbackVerified !== true/,
  );
  assert.match(finish, /controlVaultObjectId: checkpoint\.objects\.vaultId/);
  assert.doesNotMatch(
    finish.match(/applyActiveCommerceV5Binding\(\{([\s\S]*?)\n  \}\);/)?.[1] || '',
    /listingObjectId/,
    'migration/control-vault persistence must not overwrite a Maker listing',
  );
  assert.match(
    finish,
    /saveCurrentMakerDraft\(\{[\s\S]*?confirmed !== true[\s\S]*?clearMakerUploadRecovery/,
  );
});

test('the release dialog exposes the Commerce v5 substage until exact activation', () => {
  assert.match(app, /commerceV5Publication:\s*commercePublication/);
  assert.match(app, /label:\s*makerCommerceV5PublicationStageLabel/);
  assert.match(workspace, /commerce-v5-substage/);
  assert.match(workspace, /state\.commerceV5Publication\.stage/);
  assert.match(
    workspace,
    /!state\.commerceV5Publication[\s\S]*?state\.commerceV5Publication\.completed === true/,
  );
});
