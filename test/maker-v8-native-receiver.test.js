import test from 'node:test';
import assert from 'node:assert/strict';
import { createMakerV8NativeReceiverV8 } from '../maker-v8-native-receiver.js';
const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const scope = { rootId: id(1), signer: id(2) };
const origin = 'https://www.soulidity.ai';
const digest = '1'.repeat(43);
function fixture(options = {}) {
  const sent = []; const listeners = new Set(); let opened = null;
  const popup = { closed: false, focus() {}, postMessage(packet, target) { sent.push({ packet, target }); options.onSend?.(packet); } };
  const win = { location: { origin: 'https://animacraft.soulidity.ai' },
    open(url) { opened = url; return options.blocked ? null : popup; },
    addEventListener(type, listener) { assert.equal(type, 'message'); listeners.add(listener); },
    removeEventListener(type, listener) { listeners.delete(listener); },
  };
  const receiver = createMakerV8NativeReceiverV8({ window: win, timeoutMs: 100, retryMs: 5, ...options });
  function respond(packet, result, extra = {}) {
    const event = { source: popup, origin, data: { schemaVersion: packet.schemaVersion, type: 'RESPONSE',
      nonce: packet.nonce, requestId: packet.requestId, rootId: packet.rootId, signer: packet.signer, result }, ...extra };
    for (const listener of listeners) listener(event);
  }
  return { receiver, popup, sent, respond, opened: () => opened, listeners };
}
function completed() {
  return { action: 'completeOutput', status: 'FINALIZED_SUCCESS', transactionDigest: digest,
    certificate: { status: 'CERTIFIED', transactionDigest: digest,
      evidence: { certifiedEvent: { fields: { root_id: scope.rootId, original_holder: scope.signer, soul_id: id(3) } } } } };
}
const sidecars = () => [0, 1, 2].map(kind => ({ kind, name: ['soul', 'default', 'skill'][kind], versionIndex: 0,
  sidecar: { version: 1, mode: 'seal-envelope', encryptedDek: 'encrypted-only' } }));

test('reception uses exact popup/origin/nonce/scope and sends no certificate or private project', async () => {
  const h = fixture();
  h.receiver.open(scope);
  const url = new URL(h.opened());
  assert.equal(url.origin, origin); assert.equal(url.pathname, '/integrations/animacraft');
  assert.equal(url.searchParams.get('owner'), scope.signer);
  const pending = h.receiver.preflight(scope); const packet = h.sent[0].packet;
  for (const extra of [{ origin: 'https://evil.invalid' }, { source: {} },
    { data: { ...packet, type: 'RESPONSE', nonce: '0'.repeat(32), result: { ready: true, ...scope } } }]) {
    h.respond(packet, { ready: true, ...scope }, extra);
  }
  let resolved = false; pending.then(() => { resolved = true; });
  await Promise.resolve(); assert.equal(resolved, false);
  h.respond(packet, { ready: true, ...scope }); assert.deepEqual(await pending, { ready: true });
  const sync = h.receiver.sync({ ...scope, action: { ...completed(), privateProject: 'must not cross origins' }, contentSidecars: sidecars() });
  const preflight = h.sent.at(-1).packet; h.respond(preflight, { ready: true, ...scope });
  await new Promise(resolve => setImmediate(resolve));
  const request = h.sent.at(-1);
  assert.equal(request.target, origin); assert.equal(request.packet.type, 'SYNC');
  assert.deepEqual(Object.keys(request.packet.payload).sort(), ['contentSidecars', 'soulOnChainId', 'txDigest']);
  assert.equal(JSON.stringify(request.packet).includes('privateProject'), false);
  assert.equal(JSON.stringify(request.packet).includes('certificate'), false);
  h.respond(request.packet, { status: 'COMPLETE', soulId: id(3), transactionDigest: digest });
  assert.equal((await sync).status, 'COMPLETE');
  h.receiver.dispose(); assert.equal(h.listeners.size, 0);
});

test('startup retries one preflight request while a SYNC timeout never emits a second POST', async () => {
  const h = fixture({ timeoutMs: 25, retryMs: 2 });
  const startup = h.receiver.preflight(scope);
  await new Promise(resolve => setTimeout(resolve, 7));
  assert.ok(h.sent.length > 1);
  assert.equal(new Set(h.sent.map(row => row.packet.requestId)).size, 1);
  h.respond(h.sent[0].packet, { ready: true, ...scope }); await startup;
  const sync = h.receiver.sync({ ...scope, action: completed(), contentSidecars: sidecars() });
  h.respond(h.sent.at(-1).packet, { ready: true, ...scope });
  await assert.rejects(sync, { code: 'MAKER_V8_NATIVE_RECEIVER_TIMEOUT' });
  assert.equal(h.sent.filter(row => row.packet.type === 'SYNC').length, 1);
  h.receiver.dispose();
});

test('popup blocking, content secrets, wrong completion and server mismatch cannot announce success', async () => {
  const blocked = fixture({ blocked: true });
  await assert.rejects(blocked.receiver.preflight(scope), { code: 'MAKER_V8_NATIVE_RECEIVER_POPUP_BLOCKED' });
  blocked.receiver.dispose();
  const h = fixture();
  const secrets = sidecars(); secrets[0].sidecar.dek = 'private';
  await assert.rejects(h.receiver.sync({ ...scope, action: completed(), contentSidecars: secrets }), { code: 'MAKER_V8_NATIVE_RECEIVER_CONTENT_INVALID' });
  assert.equal(h.sent.length, 0);
  await assert.rejects(h.receiver.sync({ ...scope, action: { ...completed(), status: 'OUTCOME_UNKNOWN' }, contentSidecars: sidecars() }), { code: 'MAKER_V8_NATIVE_RECEIVER_COMPLETION_INVALID' });
  const sync = h.receiver.sync({ ...scope, action: completed(), contentSidecars: sidecars() });
  h.respond(h.sent.at(-1).packet, { ready: true, ...scope });
  await new Promise(resolve => setImmediate(resolve));
  h.respond(h.sent.at(-1).packet, { status: 'COMPLETE', soulId: id(99), transactionDigest: digest });
  await assert.rejects(sync, { code: 'MAKER_V8_NATIVE_RECEIVER_COMPLETION_INVALID' });
  h.receiver.dispose();
  assert.throws(() => fixture({ origin: 'https://evil.invalid' }), { code: 'MAKER_V8_NATIVE_RECEIVER_ORIGIN_INVALID' });
});
