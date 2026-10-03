import { sha256 } from '@noble/hashes/sha2.js';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { makerV8WalrusUploadIdV8 } from './maker-v8-walrus.js';
import { validateComposableProductSettings } from './maker-v8-composable-artwork-store.js';

const hash = bytes => Array.from(sha256(bytes), n => n.toString(16).padStart(2, '0')).join('');
const fail = message => { throw Object.assign(new Error(message), { code: 'COMPOSABLE_TRANSPORT_DRIFT' }); };
function sourceUploadId(binding, revision, sha256, settings) {
  const identity = JSON.stringify([binding.address, binding.rootId, binding.makerVersion,
    binding.contentCommitment, binding.partKey, revision, sha256, settings]);
  return makerV8WalrusUploadIdV8({ owner: binding.address,
    purpose: `external-${hash(new TextEncoder().encode(identity))}`, contentSha256: sha256 });
}

// Preparation only: publisher.prepare encodes/persists; it does not sign, upload
// or certify. Loading the same exact source resumes the same durable upload ID.
export function createMakerV8ComposableTransport({ publisher, artworkStore, wallet }) {
  for (const method of ['load', 'loadContent', 'prepare']) {
    if (typeof publisher?.[method] !== 'function') throw new TypeError(`Walrus publisher.${method} is required.`);
  }
  return Object.freeze({
    async productSource({ uploadId }) {
      const history = await this.history();
      const row = history.rows.find(row => row.uploadId === uploadId);
      if (!row || row.error || row.status !== 'COMPLETE' || row.stage !== 'COMPLETE') {
        fail('Certify the saved PNG before creating an external Product.');
      }
      const upload = await publisher.load(uploadId), content = await publisher.loadContent(uploadId);
      const bytes = content?.bytesBase64 ? fromBase64(content.bytesBase64) : new Uint8Array();
      if (upload?.status !== 'COMPLETE' || upload.stage !== 'COMPLETE' || upload.revision !== row.uploadRevision
        || upload.uploadId !== uploadId || content?.uploadId !== uploadId || content.owner !== history.address
        || content.mediaType !== 'image/png' || upload.mediaType !== 'image/png'
        || !bytes.length || bytes.length !== upload.byteLength || bytes.length !== content.byteLength
        || hash(bytes) !== row.sha256 || content.byteSha256 !== row.sha256 || upload.byteSha256 !== row.sha256
        || !upload.blobId || !/^0x[0-9a-f]{64}$/.test(upload.blobObjectId)
        || upload.deletable !== false) fail('Certified upload source differs from the retained artwork.');
      if ((await wallet.getCurrentAccount())?.address !== history.address) fail('Wallet changed while reading certified artwork.');
      return Object.freeze({ binding: structuredClone(row.binding), uploadId, uploadRevision: row.uploadRevision,
        artworkRevision: row.artworkRevision,
        payload: Object.freeze({ ...row.settings, partKey: row.binding.partKey,
          assetBlobId: upload.blobId, assetSha256: row.sha256, assetMediaType: 'image/png',
          assetByteLength: String(bytes.length), assetContentCommitment: row.sha256, recipient: null }) });
    },
    async advance({ uploadId, uploadRevision, stage, status, action }) {
      const history = await this.history();
      const row = history.rows.find(row => row.uploadId === uploadId);
      if (!row || row.error || row.uploadRevision !== uploadRevision || row.stage !== stage || row.status !== status) {
        fail('Upload changed. Read its current stage before continuing.');
      }
      const signing = action === 'SIGN';
      if (!(signing ? status === 'SIGNATURE_REQUIRED' && ['REGISTER', 'CERTIFY'].includes(stage)
        : action === 'RECOVER' && (status === 'RECOVERY_REQUIRED' || status === 'REGISTER_FINALIZED'))) {
        fail('This action does not match the saved upload stage.');
      }
      if ((await wallet.getCurrentAccount())?.address !== history.address) fail('Wallet changed before upload action.');
      const expected = { revision: uploadRevision, stage, status };
      return signing ? publisher.requestSignature(uploadId, expected) : publisher.resume(uploadId, expected);
    },
    async history() {
      const account = await wallet.getCurrentAccount();
      const references = await artworkStore.listUploadReferences(account?.address);
      const rows = [];
      for (const reference of references) {
        const { binding, artworkRevision, sha256, settings, uploadId } = reference;
        if (sourceUploadId(binding, artworkRevision, sha256, settings) !== uploadId) fail('Upload history binding differs.');
        try {
          const upload = await publisher.load(uploadId);
          const content = await publisher.loadContent(uploadId);
          if (upload?.uploadId !== uploadId || upload.byteSha256 !== sha256
            || content?.owner !== account.address || content.uploadId !== uploadId || content.byteSha256 !== sha256
            || content.mediaType !== 'image/png' || upload.mediaType !== 'image/png'
            || content.byteLength !== upload.byteLength) fail('Upload history source is missing or differs.');
          rows.push({ ...reference, status: upload.status, stage: upload.stage, uploadRevision: upload.revision,
            transactionDigest: upload.transactionDigest || null, error: '' });
        } catch (error) { rows.push({ ...reference, status: 'ERROR', error: String(error?.message || error) }); }
      }
      if ((await wallet.getCurrentAccount())?.address !== account.address) fail('Wallet changed while reading upload history.');
      return Object.freeze({ address: account.address, rows });
    },
    async prepare({ binding, expectedRevision }) {
      const readAccount = async () => {
        const account = await wallet.getCurrentAccount();
        if (account?.address !== binding.address) fail('Wallet differs from saved external artwork.');
      };
      await readAccount();
      const record = await artworkStore.load(binding);
      if (!record || record.revision !== expectedRevision || !record.settings) fail('Save exact artwork and product settings before preparing storage.');
      validateComposableProductSettings(record.settings);
      const uploadId = sourceUploadId(binding, expectedRevision, record.sha256, record.settings);
      const stillCurrent = async () => {
        await readAccount();
        const latest = await artworkStore.load(binding);
        if (!latest || latest.revision !== expectedRevision || latest.sha256 !== record.sha256
          || JSON.stringify(latest.settings) !== JSON.stringify(record.settings)) fail('External artwork changed during storage preparation. Reload before continuing.');
      };
      let upload = await publisher.load(uploadId);
      await stillCurrent();
      if (!upload) await publisher.prepare({ uploadId, owner: binding.address, mediaType: 'image/png', bytesBase64: toBase64(record.bytes), epochs: 3 });
      // Public load normalizes ENCODED into SIGNATURE_REQUIRED. Never interpret
      // encoded blob metadata as certified, nor reuse another record's bytes.
      upload = await publisher.load(uploadId);
      const content = await publisher.loadContent(uploadId);
      await stillCurrent();
      if (upload?.uploadId !== uploadId || content?.uploadId !== uploadId
        || content.owner !== binding.address || content.mediaType !== 'image/png'
        || content.byteLength !== record.bytes.length || content.byteSha256 !== record.sha256
        || content.bytesBase64 !== toBase64(record.bytes)
        || upload.byteSha256 !== record.sha256 || upload.byteLength !== record.bytes.length
        || upload.mediaType !== 'image/png') fail('Walrus source evidence differs from saved external artwork.');
      await artworkStore.rememberUpload({ binding, expectedRevision, uploadId, sha256: record.sha256 });
      await stillCurrent();
      return Object.freeze({ binding: structuredClone(binding), artworkRevision: expectedRevision,
        uploadId, status: upload.status, blobId: upload.blobId, byteSha256: record.sha256,
        byteLength: record.bytes.length, uploadRevision: upload.revision,
        stage: upload.stage, epochs: upload.epochs, deletable: upload.deletable,
        transactionDigest: upload.transactionDigest || null });
    },
  });
}
