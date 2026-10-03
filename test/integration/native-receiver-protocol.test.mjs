// Run with Node --experimental-strip-types and an explicit SOULIDITY_WORKTREE.
// Exercises both actual browser protocol implementations, not live login/chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMakerV8NativeReceiverV8 } from '../../maker-v8-native-receiver.js';
import { encryptMakerV8NativeContentV8, createMakerV8NativeContentSidecarV8 } from '../../maker-v8-native-content-crypto.js';
assert.ok(process.env.SOULIDITY_WORKTREE, 'Set the exact Soulidity implementation worktree');
const { nativeMessageRequest, receiveNativeRequest, createNativeRequestCache } = await import(pathToFileURL(
  resolve(process.env.SOULIDITY_WORKTREE, 'web/lib/animacraft/native-handoff.ts'),
).href);
const id = n => `0x${n.toString(16).padStart(64, '0')}`;

test('actual Animacraft encrypted sidecars traverse the actual Soulidity protocol with exact authenticated-HTTP body', async () => {
  const scope = { rootId: id(1), signer: id(2) }; const digest = '1'.repeat(43);
  const sourceOrigin = 'https://animacraft.soulidity.ai'; const targetOrigin = 'https://www.soulidity.ai';
  const listeners = new Set(); const cache = createNativeRequestCache(); const http = []; const errors = [];
  let handoff;
  const sourceWindow = { location: { origin: sourceOrigin },
    addEventListener: (_, cb) => listeners.add(cb), removeEventListener: (_, cb) => listeners.delete(cb),
    open(url) {
      const query = new URL(url).searchParams;
      handoff = Object.fromEntries(['source', 'root', 'owner', 'returnOrigin', 'returnNonce'].map(key => [key, query.get(key)]));
      return popup;
    },
  };
  const popup = { closed: false, focus() {}, postMessage(data, target) {
    assert.equal(target, targetOrigin);
    const request = nativeMessageRequest({ source: sourceWindow, origin: sourceOrigin, data }, sourceWindow, handoff, sourceOrigin);
    assert.ok(request, 'Real Soulidity parser must accept real Animacraft packets');
    void cache.run(request, () => receiveNativeRequest(request, async (url, options) => {
      http.push({ url, options });
      if (!options.method) return Response.json({ ready: true, ...scope });
      assert.equal(options.headers['x-csrf-token'], 'test-csrf-stays-on-soulidity');
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body).sort(), ['contentSidecars', 'rootId', 'signer', 'soulOnChainId', 'txDigest']);
      assert.equal(body.rootId, scope.rootId); assert.equal(body.signer, scope.signer);
      assert.equal(body.txDigest, digest); assert.equal(body.soulOnChainId, id(3));
      return Response.json({ status: 'COMPLETE', soulId: id(3), transactionDigest: digest });
    }, async () => ({ 'x-csrf-token': 'test-csrf-stays-on-soulidity' }))).then(response => {
      assert.ok(response);
      assert.equal(JSON.stringify(response).includes('test-csrf'), false);
      for (const listener of listeners) listener({ origin: targetOrigin, source: popup, data: response });
    }).catch(error => errors.push(error));
  } };
  const sidecars = [];
  for (const [kind, name, fileName] of [[0, 'soul', 'soul.md'], [1, 'default', 'memory.md'], [2, 'nova', 'skills.zip']]) {
    const { material } = await encryptMakerV8NativeContentV8({ plaintext: new TextEncoder().encode('private native fixture'), mimeType: 'application/octet-stream', fileName });
    const sidecar = await createMakerV8NativeContentSidecarV8({ material, threshold: 1, sealPackageId: id(4), contentObjectId: id(5), kind, name, versionIndex: 0,
      sealClient: { async encrypt() { return { encryptedObject: new Uint8Array(80).fill(9) }; } } });
    sidecars.push({ kind, name, versionIndex: 0, sidecar });
  }
  const receiver = createMakerV8NativeReceiverV8({ window: sourceWindow, timeoutMs: 500 });
  try {
    await receiver.preflight(scope);
    const result = await receiver.sync({ ...scope, contentSidecars: sidecars,
      action: { status: 'FINALIZED_SUCCESS', action: 'completeOutput', transactionDigest: digest,
        certificate: { status: 'CERTIFIED', transactionDigest: digest, evidence: {
          certifiedEvent: { fields: { root_id: scope.rootId, original_holder: scope.signer, soul_id: id(3) } },
        } } },
    });
    assert.deepEqual(result, { status: 'COMPLETE', soulId: id(3), transactionDigest: digest });
    assert.equal(http.filter(row => row.options.method === 'POST').length, 1);
    assert.equal(JSON.stringify(http).includes('private native fixture'), false);
    assert.equal(JSON.stringify(http).includes('"dek"'), false);
    assert.deepEqual(errors, []);
  } finally { receiver.dispose(); }
});
