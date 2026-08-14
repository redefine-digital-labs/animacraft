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

test('Maker Workspace receives authoritative Expansion Pack lifecycle callbacks', () => {
  assert.match(app, /async onLoadExpansionPackLifecycles\(payload\) \{\s*return loadExpansionPackLifecycleInventory\(payload\);/);
  assert.match(app, /async onManageExpansionPackLifecycle\(payload\) \{\s*return openExpansionPackLifecycleManager\(payload\);/);
  const inventory = section(
    'async function loadExpansionPackLifecycleInventory',
    '\nfunction expansionPackLifecycleSummaryFromView',
  );
  assert.match(inventory, /queryManagedExpansionPackReleasesV8\(discoveryClient,/);
  assert.match(inventory, /listOwnedObjects: \(request\) => client\.listOwnedObjects\(request\)/);
  assert.doesNotMatch(inventory, /queryExpansionPackReleasesV8\(discoveryClient,/);
  assert.match(inventory, /readExpansionPackLifecycleV8\(\{/);
  assert.match(inventory, /listFinalizedFailuresForRelease\(\{/);
  assert.match(inventory, /chainDescriptors: recoveredChainDescriptors/);
  assert.match(inventory, /state: 'unknown'/);
});

test('Pack manager exposes only protocol-valid terminal-safe actions', () => {
  const render = section(
    'function renderExpansionPackLifecycleManager()',
    '\nfunction openMakerLifecycleManager',
  );
  assert.match(render, /allowed\.has\('pause'\)/);
  assert.match(render, /allowed\.has\('resume'\)/);
  assert.match(render, /allowed\.has\('archive'\)/);
  assert.match(render, /stateName === 'archived'/);
  assert.match(render, /expansionPackLifecycleArchivedTerminal/);
  assert.doesNotMatch(render, /pack-restore/);
  assert.match(render, /pack-recover/);
  assert.match(render, /const actionLocked = Boolean\(recovery \|\| terminalFailure\)/);
  assert.match(render, /!actionLocked && allowed\.has\('pause'\)/);
  assert.match(render, /!actionLocked && allowed\.has\('resume'\)/);
  assert.match(render, /!actionLocked && allowed\.has\('archive'\)/);
});

test('lifecycle writes persist and recover exact signed bytes without replacement signing', () => {
  const execution = section(
    'async function runExpansionPackLifecycleController',
    '\nasync function openExpansionPackLifecycleManager',
  );
  assert.match(execution, /activeExpansionPackLifecycleController\(\)/);
  assert.match(execution, /controller\.execute\(\{/);
  assert.match(execution, /controller\.recover\(\{/);
  assert.match(execution, /OUTCOME_PENDING/);
  assert.match(execution, /FINALIZED_FAILURE/);
  assert.match(app, /listPendingForRelease\(\{/);
  assert.match(app, /withExclusiveExpansionPackLifecycleReleaseLock/);
  assert.match(app, /navigator\.locks\.request/);
  assert.match(
    app,
    /closingPack && expansionPackLifecycleManagerView\.busy === true && !force/,
    'the shared modal must not close while an exact lifecycle transaction is live',
  );
});

test('wallet context drift clears the Pack busy state and force-closes its modal', () => {
  const execution = section(
    'async function runExpansionPackLifecycleController',
    '\nasync function executeExpansionPackLifecycleManagement',
  );
  assert.match(execution, /if \(!expansionPackLifecycleViewIsActive\(scope\)\) \{/);
  assert.match(execution, /status: 'idle',[\s\S]*busy: false/);
  const wallet = section('async function applyWalletConnection', '\nlet walletConnectionApplyQueue');
  assert.match(wallet, /closeMakerLifecycleManager\(\{ restoreFocus: false, force: true \}\)/);
});
