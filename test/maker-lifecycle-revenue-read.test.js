import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifecycleProductFacade, createLazyMakerV8LifecycleFacade } from '../app.js';

const rootId = `0x${'11'.repeat(32)}`;
const address = `0x${'22'.repeat(32)}`;
function harness() {
  const state = { account: { address, network: 'mainnet' }, found: true, admin: true };
  const calls = [];
  const root = { objectId: rootId, adminCapId: 'cap', makerKey: 'maker', makerVersion: 3n,
    lifecycle: 'ARCHIVED', controlEpoch: 7n };
  const chain = {
    async discover() { return state.found ? [{ binding: { rootId } }] : []; },
    async loadContext() { return { root }; },
    async inventory(owner, selected) {
      assert.equal(owner, address); assert.equal(selected, root);
      return { adminCaps: state.admin ? [{ objectId: 'cap' }] : [{ objectId: 'other' }] };
    },
    async loadOperationalState(selected) {
      assert.equal(selected, root);
      await state.duringRead?.();
      return { makerTreasury: { objectId: 'treasury', version: 5n, digest: 'digest',
        balanceAtomic: 9007199254740993n, totalCollectedAtomic: 9007199254740999n,
        totalWithdrawnAtomic: 6n }, protocolConfig: {} };
    },
  };
  const controller = Object.fromEntries(['build', 'prepare', 'requestSignature', 'recover']
    .map((name) => [name, async (value) => { calls.push(name); return value; }]));
  const facade = createLifecycleProductFacade({ chain, controller,
    authority: { runtime: { paymentCoinType: 'coin' } },
    adapters: { wallet: { async getCurrentAccount() { return state.account; } } },
  });
  return { state, calls, facade };
}

test('archived Maker revenue is exact, immutable and does not prepare or sign', async () => {
  const { facade, calls } = harness();
  const snapshot = await facade.getSnapshot({ rootId });
  assert.equal(snapshot.rootId, rootId);
  assert.equal(snapshot.lifecycle, 'ARCHIVED');
  assert.equal(snapshot.makerVersion, '3');
  assert.equal(snapshot.controlEpoch, '7');
  assert.equal(snapshot.paymentCoinType, 'coin');
  assert.deepEqual(snapshot.treasury, { objectId: 'treasury', version: '5', digest: 'digest',
    balanceAtomic: '9007199254740993', totalCollectedAtomic: '9007199254740999', totalWithdrawnAtomic: '6' });
  assert.ok(Object.isFrozen(snapshot.treasury));
  assert.doesNotThrow(() => JSON.stringify(snapshot));
  assert.deepEqual(calls, []);
});

for (const [name, setup, input, code] of [
  ['no Root', () => {}, {}, 'ROOT_REQUIRED'],
  ['unknown Root', (s) => { s.found = false; }, { rootId }, 'ROOT_NOT_FOUND'],
  ['wrong capability', (s) => { s.admin = false; }, { rootId }, 'ADMIN_REQUIRED'],
  ['wrong network', (s) => { s.account.network = 'testnet'; }, { rootId }, 'WALLET_REQUIRED'],
  ['disconnected', (s) => { s.account = {}; }, { rootId }, 'WALLET_REQUIRED'],
  ['wallet change', (s) => { s.duringRead = () => { s.account.address = 'other'; }; }, { rootId }, 'WALLET_CHANGED'],
  ['disconnect during read', (s) => { s.duringRead = () => { s.account = {}; }; }, { rootId }, 'WALLET_CHANGED'],
]) test(`revenue rejects ${name} without write operations`, async () => {
  const { state, facade, calls } = harness();
  setup(state);
  await assert.rejects(facade.getSnapshot(input), { code: `ANIMACRAFT_LIFECYCLE_${code}` });
  assert.deepEqual(calls, []);
});

test('lazy facade forwards only readback and retries a failed resolution', async () => {
  const { facade, calls } = harness();
  let resolutions = 0;
  const lazy = createLazyMakerV8LifecycleFacade(async () => {
    if (++resolutions === 1) throw new Error('offline');
    return facade;
  });
  await assert.rejects(lazy.getSnapshot({ rootId }), /offline/);
  assert.equal((await lazy.getSnapshot({ rootId })).rootId, rootId);
  assert.equal(resolutions, 2);
  assert.deepEqual(calls, []);
});

test('withdrawal still re-reads exact Root and derives its default amount and recipient', async () => {
  const { facade, calls } = harness();
  const built = await facade.build({ rootId, action: 'WITHDRAW_MAKER_REVENUE' });
  assert.equal(built.amountAtomic, '9007199254740993');
  assert.equal(built.recipient, address);
  assert.deepEqual(calls, ['build']);
});

test('independent read resolution never initializes write adapters or persistence', async () => {
  const { facade, calls } = harness();
  const lazy = createLazyMakerV8LifecycleFacade(
    () => { throw new Error('write adapters must not initialize'); },
    { resolveRead: async () => facade },
  );
  assert.equal((await lazy.getSnapshot({ rootId })).rootId, rootId);
  assert.deepEqual(calls, []);
});
