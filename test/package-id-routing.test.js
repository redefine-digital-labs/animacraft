import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { publishedMakerFromIntentEvent } from '../chain-publication-recovery.js';

const ROOT = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, ROOT), 'utf8');
}

test('routes Move calls to the callable package and reads to the original package identity', async () => {
  const chain = await source('chain-runtime.js');

  assert.match(
    chain,
    /function moveTarget\(functionName\) \{\s*return `\$\{requireCallablePackageId\(\)\}::animacraft::\$\{functionName\}`;/,
  );
  assert.match(
    chain,
    /export async function listOwnedMakers[\s\S]*?const packageId = requireOriginalPackageId\(\);[\s\S]*?::animacraft::OCMaker/,
  );
  assert.match(
    chain,
    /export async function listPublishedMakerIds[\s\S]*?const packageId = requireOriginalPackageId\(\);[\s\S]*?::animacraft::OCMakerPublished/,
  );
  assert.match(chain, /isOriginalAnimacraftObjectType\(object\.type, expectedStructName/);
  assert.match(chain, /findOriginalAnimacraftObjectId\(indexedResult\.objectTypes, 'OCMaker'\)/);
  assert.match(chain, /findPublishedMakerByIntent[\s\S]*?transaction \{ digest \}/);
  assert.doesNotMatch(chain, /findPublishedMakerByIntent[\s\S]*?transactionBlock \{ digest \}/);
  assert.doesNotMatch(chain, /type\.endsWith\('::animacraft::/);
  assert.doesNotMatch(chain, /type\.includes\('::animacraft::/);
});

test('preflight verifies callable ABI and original event discovery independently', async () => {
  const preflight = await source('scripts/mainnet-preflight.mjs');

  assert.match(preflight, /`\$\{config\.originalPackageId\}::animacraft::OCMakerPublished`/);
  assert.match(preflight, /checkAnimacraftAbi\([\s\S]*?config\.callablePackageId,[\s\S]*?config\.protocolFeePackageId/);
  assert.match(preflight, /moveTypeEquals\(freeFn\.parameters\[1\], protocolFeeConfigType\)/);
  assert.match(preflight, /normalizeSuiAddress\(config\.protocolFeePackageId\)/);
  assert.match(preflight, /`\$\{typeOrigin\}::animacraft::ProtocolFeeConfig`/);
  assert.doesNotMatch(preflight, /`\$\{original\}::animacraft::ProtocolFeeConfig`/);
  assert.match(
    preflight,
    /`\$\{protocolFeeTypeOrigin\}::animacraft::CanonicalSoulMintAuthorization`/,
  );
  assert.match(
    preflight,
    /moveFunction\(client, packageId, 'consume_canonical_soul_mint_authorization'\)/,
  );
  assert.match(preflight, /moveTypeEquals\(freeFn\.returns\[0\], canonicalAuthorizationType\)/);
  assert.match(preflight, /moveTypeEquals\(paidFn\.returns\[0\], canonicalAuthorizationType\)/);
  assert.match(
    preflight,
    /moveTypeEquals\(\s*canonicalConsumeFn\.parameters\[0\],\s*canonicalAuthorizationType,/,
  );
  assert.match(preflight, /simulateProtocolVersion/);
  assert.match(preflight, /protocol_version=\$\{version\}/);
  assert.match(preflight, /checkProtocolFeeObjects\(client, config, validation\)/);
  assert.match(preflight, /requireSoulidity \|\| config\.canonicalSoulMintEnabled/);
  assert.match(preflight, /'mint_animacraft_in_personal_kiosk'/);
  assert.match(preflight, /'Soulidity Animacraft route'/);
});

test('application object hydration rejects types outside the original package', async () => {
  const app = await source('app.js');

  assert.match(app, /\], \{ expectedStructName: 'OCMaker' \}\);/);
  assert.match(app, /\{ expectedStructName: 'MakerTreasury', generic: true \}/);
  assert.match(app, /callablePackageId: runtimeConfig\.callablePackageId/);
  assert.match(app, /originalPackageId: runtimeConfig\.originalPackageId/);
});

test('publication recovery matches the immutable creator and Manifest intent', () => {
  const event = {
    transaction: { digest: '8hRecoveredDigest' },
    contents: {
      json: {
        maker_id: '0xabc123',
        creator: '0xADeA',
        manifest_blob_id: 'walrus-quilt-42',
      },
    },
  };

  assert.deepEqual(
    publishedMakerFromIntentEvent(event, {
      creator: '0xadea',
      manifestBlobId: 'walrus-quilt-42',
    }),
    {
      makerObjectId: '0xabc123',
      digest: '8hRecoveredDigest',
      creator: '0xADeA',
      manifestBlobId: 'walrus-quilt-42',
    },
  );
  assert.equal(publishedMakerFromIntentEvent(event, {
    creator: '0xadea',
    manifestBlobId: 'another-quilt',
  }), null);
  assert.equal(publishedMakerFromIntentEvent(event, {
    creator: '0xbeef',
    manifestBlobId: 'walrus-quilt-42',
  }), null);
});

test('application stores publication intent before signing and uses the complete v2 projection', async () => {
  const app = await source('app.js');

  assert.match(app, /state\.makerPublicationIntent = \{[\s\S]*?status: 'awaiting-signature'[\s\S]*?await persistMakerUploadRecovery\(\);[\s\S]*?const transaction = await publishMaker\(/);
  assert.match(app, /onSubmitted: async \(\{ digest \}\) => \{[\s\S]*?status: 'submitted'[\s\S]*?await persistMakerUploadRecovery\(\)/);
  assert.match(app, /findPublishedMakerByIntent\(\{[\s\S]*?creator: intent\.creator,[\s\S]*?manifestBlobId: intent\.manifestBlobId/);
  assert.match(app, /function makerPublicationRecoveryPending\(\) \{[\s\S]*?intent\.creator\.toLowerCase\(\) === String\(state\.walletAddress \|\| ''\)\.toLowerCase\(\)/);
  assert.match(app, /const pendingPublicationForWallet = pendingIntent[\s\S]*?pendingIntent\.creator\.toLowerCase\(\)[\s\S]*?if \(pendingPublicationForWallet\)/);
  assert.match(app, /function invalidateMakerUpload[\s\S]*?if \(makerPublicationRecoveryPending\(\)\) \{[\s\S]*?return false;/);
  assert.match(app, /canMutateDocument\(\) \{[\s\S]*?return !makerPublicationRecoveryPending\(\);/);
  assert.match(app, /const uploadedMakerDocument = state\.pendingMakerV4Bundle\?\.manifest;[\s\S]*?publishedMakerDocumentV4 = structuredClone\(uploadedMakerDocument\)/);
  assert.match(app, /reviewPendingMakerPublication[\s\S]*?clearPendingPublicationTitle[\s\S]*?clearPendingPublicationConfirm/);
  assert.match(app, /if \(!publicationSignatureRequested[\s\S]*?state\.makerPublicationIntent = null/);
  assert.doesNotMatch(app, /publicationIntentAge|ageMs < 90_000/);
  assert.match(app, /buildMakerV4MoveSummaryV2\(publishedManifest, \{/);
  assert.match(app, /auxiliaryLocation,/);
  assert.match(app, /projectionAuxiliaryBlob: makerProjectionAuxiliaryPngBlob\(\)/);
  assert.match(app, /const documentV4 = structuredClone\(state\.makerDocumentV4\);/);
  assert.doesNotMatch(app, /\bbuildMakerV4MoveSummary\(/);
  assert.doesNotMatch(app, /\bmergeExpansionPacks\(/);
});
