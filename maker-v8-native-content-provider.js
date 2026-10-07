import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { buildMakerV8NativeContentIntentV8 } from './maker-v8-native-content-intent.js';
import { encryptMakerV8NativeContentV8, createMakerV8NativeContentSidecarV8 } from './maker-v8-native-content-crypto.js';
import { MAKER_V8_PUBLIC_PREVIEW_KEY, encodeMakerV8PublicPreviewV8 } from './maker-v8-public-preview.js';
import { deriveMakerV8NativeContentIdV8 } from './maker-v8-native-content-identity.js';
import { CONTENT_ENVELOPE_SCHEMA, encodeContentEnvelope } from './maker-v8-native-envelope-codec.js';
import { assertMakerV8NativeContentEvidenceV8 } from './maker-v8-native-content-evidence.js';

const clone = value => structuredClone(value);
const hash = bytes => [...sha256(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function fail(code) { throw Object.assign(new Error(code), { code }); }
function scope(rootId, signer) {
  for (const value of [rootId, signer]) if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value)) fail('MAKER_V8_NATIVE_CONTENT_SCOPE_INVALID');
  return `native-content/${rootId}/${signer}`;
}
const random = () => [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');

/** Private CAS journal owns recovery materials; public Walrus WAL receives ciphertext only. */
export function createMakerV8NativeContentProviderV8({ store, walrus, resolveAuthority, resolveCompletionAuthority, receiver, envelopes,
  locks = globalThis.navigator?.locks } = {}) {
  const recoveryActions = new Map();
  for (const method of ['load', 'create', 'compareAndSwap']) if (typeof store?.[method] !== 'function') fail('MAKER_V8_NATIVE_CONTENT_STORE_REQUIRED');
  async function exclusive(key, operation) {
    if (typeof locks?.request !== 'function') fail('MAKER_V8_NATIVE_CONTENT_LOCKS_REQUIRED');
    return locks.request(key, { mode: 'exclusive', ifAvailable: true }, lock => {
      if (lock === null) fail('MAKER_V8_NATIVE_CONTENT_BUSY');
      return operation();
    });
  }
  function requireRecoveryDependencies(rootId, signer) {
    scope(rootId, signer);
    if (typeof locks?.request !== 'function') fail('MAKER_V8_NATIVE_CONTENT_LOCKS_REQUIRED');
    if (typeof resolveCompletionAuthority !== 'function') fail('MAKER_V8_NATIVE_CONTENT_COMPLETION_AUTHORITY_REQUIRED');
    if (typeof receiver?.preflight !== 'function'
      || typeof receiver?.sync !== 'function') fail('MAKER_V8_NATIVE_CONTENT_RECEIVER_REQUIRED');
  }
  function validateContentAuthority(result) {
    const original = result?.runtime?.nativeSoulIntegration?.soulidityOriginalPackageId;
    if (!/^0x[0-9a-f]{64}$/.test(original ?? '') || /^0x0+$/.test(original)
      || typeof result.sealClient?.encrypt !== 'function' || !Number.isInteger(result.threshold)
      || result.threshold < 1 || result.threshold > 254) fail('MAKER_V8_NATIVE_CONTENT_AUTHORITY_REQUIRED');
    return result;
  }
  // Recovery authenticates existing content, never permission to issue a new Soul.
  async function completionAuthority(rootId, signer) {
    requireRecoveryDependencies(rootId, signer);
    const result = validateContentAuthority(await resolveCompletionAuthority({ rootId, signer }));
    if ((await receiver.preflight({ rootId, signer }))?.ready !== true) fail('MAKER_V8_NATIVE_CONTENT_RECEIVER_UNAVAILABLE');
    return result;
  }
  async function authority(rootId, signer) {
    requireRecoveryDependencies(rootId, signer);
    if (typeof resolveAuthority !== 'function') fail('MAKER_V8_NATIVE_CONTENT_AUTHORITY_REQUIRED');
    for (const method of ['prepare', 'load', 'resume', 'requestSignature', 'loadContent']) {
      if (typeof walrus?.publisher?.[method] !== 'function') fail('MAKER_V8_NATIVE_CONTENT_WALRUS_REQUIRED');
    }
    if (typeof walrus?.persistence?.requirePersistentStorage !== 'function') fail('MAKER_V8_NATIVE_CONTENT_WALRUS_REQUIRED');
    const result = validateContentAuthority(await resolveAuthority({ rootId, signer }));
    if (!Object.hasOwn(result, 'currentKioskId') || !Object.hasOwn(result, 'currentKioskCapOnChainId')) fail('MAKER_V8_NATIVE_CONTENT_AUTHORITY_REQUIRED');
    const { currentKioskId, currentKioskCapOnChainId } = result;
    if ((currentKioskId === null) !== (currentKioskCapOnChainId === null)) fail('MAKER_V8_NATIVE_CONTENT_KIOSK_INVALID');
    if (currentKioskId !== null) scope(currentKioskId, currentKioskCapOnChainId);
    if ((await receiver.preflight({ rootId, signer }))?.ready !== true) fail('MAKER_V8_NATIVE_CONTENT_RECEIVER_UNAVAILABLE');
    await walrus.persistence.requirePersistentStorage();
    return result;
  }
  async function intentFor(project) {
    const intent = await buildMakerV8NativeContentIntentV8(clone(project));
    if (!Array.isArray(intent.files) || intent.files.length !== 3 || !/^[0-9a-f]{64}$/.test(intent.commitment)) fail('MAKER_V8_NATIVE_CONTENT_INTENT_INVALID');
    for (const file of intent.files) {
      const bytes = fromBase64(file.bytesBase64);
      if (toBase64(bytes) !== file.bytesBase64 || hash(bytes) !== file.sha256) fail('MAKER_V8_NATIVE_CONTENT_INTENT_INVALID');
    }
    return clone(intent);
  }
  const save = (key, row, data) => store.compareAndSwap(key, row.revision, data);
  async function prepareUpload(file, signer, persistPrepared) {
    const publisher = walrus.publisher;
    let view = await publisher.load(file.uploadId);
    if (view === null) {
      if (file.uploadPrepared) fail('MAKER_V8_NATIVE_CONTENT_UPLOAD_JOURNAL_MISSING');
      await publisher.prepare({ uploadId: file.uploadId, owner: signer, mediaType: 'application/octet-stream', bytesBase64: file.ciphertextBase64 });
      view = await publisher.load(file.uploadId); // prepare returns internal ENCODED, load exposes SIGNATURE_REQUIRED.
    }
    const content = await publisher.loadContent(file.uploadId);
    if (!content || content.owner !== signer || content.mediaType !== 'application/octet-stream'
      || content.bytesBase64 !== file.ciphertextBase64
      || content.byteSha256 !== hash(fromBase64(file.ciphertextBase64))) fail('MAKER_V8_NATIVE_CONTENT_UPLOAD_DRIFT');
    if (!['COMPLETE', 'SIGNATURE_REQUIRED', 'RECOVERY_REQUIRED', 'REGISTER_FINALIZED'].includes(view?.status)) {
      fail('MAKER_V8_NATIVE_CONTENT_UPLOAD_STATE_INVALID');
    }
    if (!file.uploadPrepared) await persistPrepared();
    return view;
  }
  async function settleUpload(file, signer, assertBeforeSignature, view) {
    const publisher = walrus.publisher;
    for (let step = 0; step < 8; step++) {
      if (view?.status === 'COMPLETE') {
        scope(view.blobObjectId, signer);
        return view.blobObjectId;
      }
      if (view?.status === 'SIGNATURE_REQUIRED') {
        if (typeof assertBeforeSignature !== 'function') fail('MAKER_V8_NATIVE_CONTENT_SIGNATURE_GUARD_REQUIRED');
        await assertBeforeSignature(Object.freeze({
          kind: 'STORAGE_UPLOAD', purpose: 'NATIVE_CONTENT', uploadId: file.uploadId,
          blobId: view.blobId ?? null, byteLength: fromBase64(file.ciphertextBase64).length,
          byteSha256: hash(fromBase64(file.ciphertextBase64)),
        }));
        await publisher.requestSignature(file.uploadId);
        view = await publisher.load(file.uploadId);
      } else if (['RECOVERY_REQUIRED', 'REGISTER_FINALIZED'].includes(view?.status)) {
        const previous = view;
        view = await publisher.resume(file.uploadId);
        if (view.status === previous.status) return null;
      } else fail('MAKER_V8_NATIVE_CONTENT_UPLOAD_STATE_INVALID');
    }
    return null;
  }
  return Object.freeze({
    async exportRecovery({ rootId, signer }) {
      const key = scope(rootId, signer);
      const actionId = recoveryActions.get(key) ?? (await store.load(key))?.data.completion?.actionId;
      if (!actionId || typeof envelopes?.exportRecovery !== 'function') return null;
      return envelopes.exportRecovery({ rootId, signer, actionId });
    },
    async preflight({ rootId, signer, project }) {
      await intentFor(project); await authority(rootId, signer); await store.load(scope(rootId, signer));
      return Object.freeze({ ready: true });
    },
    async prepare({ rootId, signer, project, assertBeforeSignature, deferStorage = false }) {
      const key = scope(rootId, signer); const submitted = clone(project);
      return exclusive(key, async () => {
        const intent = await intentFor(submitted); const auth = await authority(rootId, signer);
        let row = await store.load(key);
        if (row?.data.completion && row.data.intent.commitment !== intent.commitment) fail('MAKER_V8_NATIVE_CONTENT_PENDING_COMPLETION');
        if (!row || row.data.spent || row.data.intent.commitment !== intent.commitment) {
          if (row?.data.completion) fail('MAKER_V8_NATIVE_CONTENT_PENDING_COMPLETION');
          // Persist one identity before any paid upload. Retry never rotates it.
          if (row && !row.data.spent) fail('MAKER_V8_NATIVE_CONTENT_PENDING_UPLOAD');
          const mintNonce = random();
          const data = { attemptId: random(), mintNonce,
            expectedContentObjectId: deriveMakerV8NativeContentIdV8(auth.runtime.nativeSoulIntegration, signer, mintNonce),
            intent, files: [], completion: null, finalized: null, spent: false };
          for (let index = 0; index < intent.files.length; index++) {
            const file = intent.files[index];
            const encrypted = await encryptMakerV8NativeContentV8({ plaintext: fromBase64(file.bytesBase64), mimeType: file.mimeType, fileName: file.fileName });
            data.files.push({ uploadId: `native-${data.attemptId}-${index}`, material: encrypted.material,
              ciphertextBase64: toBase64(encrypted.ciphertext), uploadPrepared: false, blobObjectId: null, sidecar: null });
          }
          row = row ? await save(key, row, data) : await store.create(key, data);
        }
        if (!same(row.data.intent, intent)) fail('MAKER_V8_NATIVE_CONTENT_INTENT_DRIFT');
        if (deriveMakerV8NativeContentIdV8(auth.runtime.nativeSoulIntegration, signer, row.data.mintNonce)
          !== row.data.expectedContentObjectId) fail('MAKER_V8_NATIVE_CONTENT_IDENTITY_DRIFT');
        // All envelopes are wrapped and read back before the first payment.
        for (let index = 0; index < intent.files.length; index++) {
          if (row.data.files[index].sidecar) continue;
          const file = intent.files[index];
          const sidecar = await createMakerV8NativeContentSidecarV8({ sealClient: auth.sealClient, threshold: auth.threshold,
            sealPackageId: auth.runtime.nativeSoulIntegration.soulidityOriginalPackageId,
            contentObjectId: row.data.expectedContentObjectId, kind: file.kind, name: file.name,
            versionIndex: 0, material: row.data.files[index].material });
          encodeContentEnvelope({ schema: CONTENT_ENVELOPE_SCHEMA, contentObjectId: row.data.expectedContentObjectId,
            kind: file.kind, name: file.name, versionIndex: '0', blobObjectId: row.data.expectedContentObjectId, sidecar },
          auth.runtime.nativeSoulIntegration.soulidityOriginalPackageId);
          const data = clone(row.data); data.files[index].sidecar = sidecar;
          row = await save(key, row, data);
        }
        const views = [];
        for (let index = 0; index < row.data.files.length; index++) {
          const file = row.data.files[index]; const source = intent.files[index];
          const encrypted = await encryptMakerV8NativeContentV8({ plaintext: fromBase64(source.bytesBase64), mimeType: source.mimeType, fileName: source.fileName, material: file.material });
          if (toBase64(encrypted.ciphertext) !== file.ciphertextBase64) fail('MAKER_V8_NATIVE_CONTENT_CIPHERTEXT_DRIFT');
          views.push(await prepareUpload(file, signer, async () => {
            const data = clone(row.data); data.files[index].uploadPrepared = true;
            row = await save(key, row, data);
          }));
        }
        // Prepare every durable member before any wallet prompt. The caller can
        // now join the final render to this fixed set without exposing raw DEKs.
        // Existing signed WALs retain their topology; preparation never settles
        // or replaces them, and the batching controller must query them first.
        if (deferStorage) return Object.freeze({ status: 'STORAGE_PREPARED', uploads: row.data.files.map(file => ({
          uploadId: file.uploadId, owner: signer, mediaType: 'application/octet-stream',
          bytesBase64: file.ciphertextBase64,
        })) });
        for (let index = 0; index < row.data.files.length; index++) {
          const file = row.data.files[index];
          const blobObjectId = await settleUpload(file, signer, assertBeforeSignature, views[index]);
          if (blobObjectId === null) return Object.freeze({ status: 'RECOVERY_REQUIRED' });
          if (file.blobObjectId !== null && file.blobObjectId !== blobObjectId) fail('MAKER_V8_NATIVE_CONTENT_UPLOAD_DRIFT');
          if (file.blobObjectId === null) {
            const data = clone(row.data); data.files[index].blobObjectId = blobObjectId;
            row = await save(key, row, data);
          }
        }
        return Object.freeze({ status: 'READY', nativeSoul: {
          name: intent.name, description: intent.description,
          mintNonce: row.data.mintNonce, expectedContentObjectId: row.data.expectedContentObjectId,
          currentKioskId: auth.currentKioskId, currentKioskCapOnChainId: auth.currentKioskCapOnChainId,
          initialStateConfig: [{ key: MAKER_V8_PUBLIC_PREVIEW_KEY, valueUtf8: encodeMakerV8PublicPreviewV8(intent.publicPreview) }],
          initialContent: intent.files.map((file, index) => ({
            kind: file.kind, name: file.name, slotReadModeMask: 3, downloadPolicy: 'public', setActive: false,
            blobObjectId: row.data.files[index].blobObjectId,
            expectedVersionIndex: '0',
            encryptedEnvelope: encodeContentEnvelope({ schema: CONTENT_ENVELOPE_SCHEMA,
              contentObjectId: row.data.expectedContentObjectId, kind: file.kind, name: file.name,
              versionIndex: '0', blobObjectId: row.data.files[index].blobObjectId,
              sidecar: row.data.files[index].sidecar }, auth.runtime.nativeSoulIntegration.soulidityOriginalPackageId),
          })),
        } });
      });
    },
    async loadCompletion({ rootId, signer }) {
      const row = await store.load(scope(rootId, signer));
      return row?.data.completion ? clone(row.data.completion) : null;
    },
    async saveCompletion({ rootId, signer, actionId, project }) {
      const submitted = clone(project);
      const key = scope(rootId, signer); const intent = await intentFor(submitted);
      const row = await store.load(key);
      if (typeof actionId !== 'string' || !actionId || !row || row.data.spent
        || row.data.intent.commitment !== intent.commitment || row.data.files.some(file => file.blobObjectId === null)) fail('MAKER_V8_NATIVE_CONTENT_COMPLETION_INVALID');
      const completion = { rootId, signer, actionId, project: submitted };
      if (row.data.completion) {
        if (!same(row.data.completion, completion)) fail('MAKER_V8_NATIVE_CONTENT_COMPLETION_CONFLICT');
        return;
      }
      await save(key, row, { ...row.data, completion });
    },
    async clearCompletion({ rootId, signer, actionId }) {
      const key = scope(rootId, signer); const row = await store.load(key);
      if (!row?.data.completion || row.data.completion.actionId !== actionId) fail('MAKER_V8_NATIVE_CONTENT_COMPLETION_CONFLICT');
      await save(key, row, { ...row.data, completion: null, spent: true });
    },
    // Only an explicitly requested new completion retires an already received
    // Soul. A stale page cannot retire an unknown result or a newer attempt.
    async retireFinalizedCompletion({ rootId, signer, actionId, soulId, transactionDigest }) {
      const key = scope(rootId, signer);
      scope(soulId, signer);
      if (typeof actionId !== 'string' || !actionId || typeof transactionDigest !== 'string'
        || !transactionDigest) fail('MAKER_V8_NATIVE_CONTENT_COMPLETION_CONFLICT');
      return exclusive(key, async () => {
        const row = await store.load(key);
        const completion = row?.data.completion;
        const finalized = row?.data.finalized;
        const finalizing = row?.data.finalizing;
        if (!completion || row.data.spent || completion.rootId !== rootId || completion.signer !== signer
          || completion.actionId !== actionId || finalizing?.actionId !== actionId
          || finalizing.soulId !== soulId || finalizing.transactionDigest !== transactionDigest
          || finalized?.soulId !== soulId || finalized.transactionDigest !== transactionDigest) {
          fail('MAKER_V8_NATIVE_CONTENT_COMPLETION_CONFLICT');
        }
        await save(key, row, { ...row.data, completion: null, spent: true });
        return Object.freeze({ status: 'RETIRED', actionId, soulId, transactionDigest });
      });
    },
    async finalize({ rootId, signer, project, action, assertBeforeSignature, mode = 'resume', reprepare = false, recoveryJson }) {
      const key = scope(rootId, signer); const submitted = clone(project); const completed = clone(action);
      return exclusive(key, async () => {
        let row = await store.load(key); const intent = await intentFor(submitted);
        if (!row?.data.completion || row.data.completion.actionId !== completed.actionId
          || !same(row.data.intent, intent) || row.data.files.length !== intent.files.length) fail('MAKER_V8_NATIVE_CONTENT_COMPLETION_CONFLICT');
        const auth = await completionAuthority(rootId, signer);
        const event = completed.certificate?.evidence?.certifiedEvent?.fields;
        const transactionDigest = completed.transactionDigest;
        if (!event || event.root_id !== rootId || event.original_holder !== signer || !transactionDigest
          || completed.status !== 'FINALIZED_SUCCESS' || completed.action !== 'completeOutput'
          || completed.certificate?.status !== 'CERTIFIED' || completed.certificate?.actionId !== completed.actionId
          || completed.certificate?.transactionDigest !== transactionDigest) fail('MAKER_V8_NATIVE_CONTENT_CERTIFICATE_INVALID');
        const states = completed.certificate.evidence.objects.filter(object => object.objectId === event.soul_state_id
          && object.type === `${auth.runtime.nativeSoulIntegration.soulidityOriginalPackageId}::soul::SoulState`);
        if (states.length !== 1 || states[0].fields.soulId !== event.soul_id) fail('MAKER_V8_NATIVE_CONTENT_CERTIFICATE_INVALID');
        const contentObjectId = states[0].fields.contentId;
        scope(contentObjectId, signer);
        if (contentObjectId !== row.data.expectedContentObjectId) fail('MAKER_V8_NATIVE_CONTENT_CERTIFICATE_DRIFT');
        const finalizing = { actionId: completed.actionId, transactionDigest, soulId: event.soul_id, contentObjectId };
        if (row.data.finalizing && !same(row.data.finalizing, finalizing)) fail('MAKER_V8_NATIVE_CONTENT_CERTIFICATE_DRIFT');
        const contentSidecars = [];
        for (let index = 0; index < intent.files.length; index++) {
          const file = intent.files[index];
          if (!row.data.files[index].sidecar) fail('MAKER_V8_NATIVE_CONTENT_INITIAL_ENVELOPE_MISSING');
          contentSidecars.push({ kind: file.kind, name: file.name, versionIndex: 0, sidecar: row.data.files[index].sidecar });
        }
        const slots = intent.files.map((file, index) => {
          const saved = row.data.files[index];
          if (!saved) fail('MAKER_V8_NATIVE_CONTENT_UPLOAD_DRIFT');
          scope(saved.blobObjectId, signer);
          return { contentObjectId, kind: file.kind, name: file.name, versionIndex: '0', blobObjectId: saved.blobObjectId };
        });
        assertMakerV8NativeContentEvidenceV8({ evidence: completed.certificate.evidence.nativeContentEvidence,
          effectsSha256: completed.certificate.evidence.effectsBcsSha256, transactionDigest,
          originalPackageId: auth.runtime.nativeSoulIntegration.soulidityOriginalPackageId,
          soulId: event.soul_id, stateId: event.soul_state_id, signer,
          input: { expectedContentObjectId: contentObjectId,
            initialStateConfig: [{ key: MAKER_V8_PUBLIC_PREVIEW_KEY, valueUtf8: encodeMakerV8PublicPreviewV8(intent.publicPreview) }],
            initialContent: slots.map((slot, index) => ({ ...slot, slotReadModeMask: 3, downloadPolicy: 'public', setActive: false,
              expectedVersionIndex: '0', encryptedEnvelope: encodeContentEnvelope({ schema: CONTENT_ENVELOPE_SCHEMA, ...slot,
                sidecar: contentSidecars[index].sidecar }, auth.runtime.nativeSoulIntegration.soulidityOriginalPackageId) })) } });
        if (!row.data.finalizing) row = await save(key, row, { ...row.data, finalizing });
        const current = await store.load(key);
        if (!current || current.revision !== row.revision || !same(current.data, row.data)) fail('MAKER_V8_NATIVE_CONTENT_COMPLETION_CONFLICT');
        const result = await receiver.sync({ rootId, signer, action: completed, contentSidecars });
        if (result?.status !== 'COMPLETE') return Object.freeze({ status: 'RECOVERY_REQUIRED' });
        if (result.soulId !== event.soul_id || result.transactionDigest !== transactionDigest) fail('MAKER_V8_NATIVE_CONTENT_RECEIVER_DRIFT');
        await save(key, row, { ...row.data, finalized: { soulId: event.soul_id, transactionDigest } });
        return Object.freeze({ status: 'COMPLETE', soulId: event.soul_id, transactionDigest });
      });
    },
  });
}
