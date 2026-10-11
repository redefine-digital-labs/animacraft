import { normalizeSuiAddress } from '@mysten/sui/utils';
import { queryCompleteOutputRecordV5 } from './chain-commerce-v5.js';

export const SOULIDITY_COMPLETION_RECEIPT_V5_SCHEMA =
  'soulidity.animacraft-completion.v1';

export class CompletionReceiptV5Error extends Error {
  constructor(message, code = 'COMPLETION_RECEIPT_V5_INVALID', details = {}) {
    super(message);
    this.name = 'CompletionReceiptV5Error';
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details = {}) {
  throw new CompletionReceiptV5Error(message, code, details);
}

function requiredString(value, label, maximum = 2_048) {
  const result = String(value || '').trim();
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) {
    fail(
      'COMPLETION_RECEIPT_V5_FIELD',
      `${label} is missing or invalid.`,
      { label },
    );
  }
  return result;
}

function suiId(value, label) {
  try {
    return normalizeSuiAddress(requiredString(value, label, 128));
  } catch {
    return fail(
      'COMPLETION_RECEIPT_V5_SUI_ID',
      `${label} is not a valid Sui object ID or address.`,
      { label },
    );
  }
}

function comparableId(value) {
  try {
    return normalizeSuiAddress(String(value || '').trim());
  } catch {
    return '';
  }
}

function exactHex(value, label, length = 32) {
  const bytes = value instanceof Uint8Array
    ? value
    : Array.isArray(value)
      && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      ? Uint8Array.from(value)
      : typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value.trim())
        ? Uint8Array.from(
            value
              .trim()
              .slice(2)
              .match(/.{2}/g)
              ?.map((byte) => Number.parseInt(byte, 16)) || [],
          )
        : null;
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
    fail(
      'COMPLETION_RECEIPT_V5_HEX',
      `${label} must contain exactly ${length} bytes.`,
      { label, length: bytes?.length ?? null },
    );
  }
  return `0x${[...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

function field(fields, snake, camel = '') {
  if (!fields || typeof fields !== 'object') return undefined;
  if (Object.hasOwn(fields, snake)) return fields[snake];
  return camel && Object.hasOwn(fields, camel) ? fields[camel] : undefined;
}

function parsedFields(event) {
  const value = event?.json ?? event?.parsedJson ?? event?.parsed_json;
  return value && typeof value === 'object' ? value : null;
}

function eventMoveType(event) {
  return event?.eventType ?? event?.type ?? '';
}

function exactMoveType(value, packageId, moduleName, structName) {
  const parts = String(value || '').split('::');
  return parts.length === 3
    && comparableId(parts[0]) === comparableId(packageId)
    && parts[1] === moduleName
    && parts[2] === structName;
}

function transactionValue(result) {
  return result?.Transaction ?? result?.FailedTransaction ?? result;
}

function successfulTransaction(result) {
  if (result?.$kind === 'FailedTransaction' || result?.FailedTransaction) {
    return false;
  }
  const status = transactionValue(result)?.status
    ?? transactionValue(result)?.effects?.status;
  if (typeof status?.success === 'boolean') return status.success;
  return status === 'success' || status?.status === 'success';
}

function transactionSender(result) {
  const transaction = transactionValue(result);
  return comparableId(
    transaction?.transaction?.sender
      || transaction?.transaction?.data?.sender
      || transaction?.transaction?.data?.transaction?.sender,
  );
}

function immutableOwner(owner) {
  return owner === 'Immutable'
    || owner?.$kind === 'Immutable'
    || Object.hasOwn(owner || {}, 'Immutable')
    || Object.hasOwn(owner || {}, 'immutable');
}

export function parseSoulidityCompletionMessageV5(value) {
  if (!value || typeof value !== 'object') {
    fail(
      'COMPLETION_RECEIPT_V5_MESSAGE',
      'Soulidity returned an invalid completion message.',
    );
  }
  if (value.schemaVersion !== SOULIDITY_COMPLETION_RECEIPT_V5_SCHEMA) {
    fail(
      'COMPLETION_RECEIPT_V5_SCHEMA',
      'Soulidity returned an unsupported completion receipt version.',
    );
  }
  return Object.freeze({
    schemaVersion: SOULIDITY_COMPLETION_RECEIPT_V5_SCHEMA,
    returnNonce: exactHex(value.returnNonce, 'Return nonce'),
    txDigest: requiredString(value.txDigest, 'Transaction digest', 128),
    soulObjectId: suiId(value.soulObjectId, 'Soul object ID'),
    provenanceObjectId: suiId(
      value.provenanceObjectId,
      'Animacraft provenance object ID',
    ),
    outputProvenanceObjectId: suiId(
      value.outputProvenanceObjectId,
      'Animacraft completed-output provenance object ID',
    ),
  });
}

export async function verifySoulidityCompletionReceiptV5({
  suiClient,
  message,
  expected,
  commerceTypeOriginPackageId,
  soulidityTypeOriginPackageId,
} = {}) {
  if (
    !suiClient?.getTransaction
    || !suiClient?.getObject
    || !suiClient?.getDynamicField
  ) {
    fail(
      'COMPLETION_RECEIPT_V5_CLIENT',
      'A Sui client is required to verify the Soulidity completion receipt.',
    );
  }
  const receipt = parseSoulidityCompletionMessageV5(message);
  const exact = Object.freeze({
    returnNonce: exactHex(expected?.returnNonce, 'Expected return nonce'),
    exportKey: requiredString(expected?.exportKey, 'Expected export key', 32_768),
    wallet: suiId(expected?.wallet, 'Expected payer wallet'),
    rootObjectId: suiId(expected?.rootObjectId, 'Expected MakerRootV5 ID'),
    completeOutputsTableId: suiId(
      expected?.completeOutputsTableId,
      'Expected MakerRootV5 Complete output table ID',
    ),
    legacyMakerObjectId: suiId(
      expected?.legacyMakerObjectId,
      'Expected legacy Maker ID',
    ),
    makerTreasuryObjectId: suiId(
      expected?.makerTreasuryObjectId,
      'Expected Maker treasury ID',
    ),
    profileBlobId: requiredString(
      expected?.profileBlobId,
      'Expected profile Blob ID',
    ),
    imageBlobId: requiredString(
      expected?.imageBlobId,
      'Expected encrypted output Blob ID',
    ),
    imageUrl: requiredString(
      expected?.imageUrl,
      'Expected public preview URL',
      8_192,
    ),
    recipeHash: exactHex(expected?.recipeHash, 'Expected Recipe hash'),
    outputSealId: exactHex(expected?.outputSealId, 'Expected output Seal ID'),
    outputNonce: exactHex(expected?.outputNonce, 'Expected output nonce'),
    outputDigest: exactHex(expected?.outputDigest, 'Expected output digest'),
  });
  if (receipt.returnNonce !== exact.returnNonce) {
    fail(
      'COMPLETION_RECEIPT_V5_CONTEXT',
      'The Soulidity receipt belongs to another completion attempt.',
    );
  }

  const transactionResult = await suiClient.getTransaction({
    digest: receipt.txDigest,
    include: {
      effects: true,
      events: true,
      transaction: true,
    },
  });
  const transaction = transactionValue(transactionResult);
  if (
    !successfulTransaction(transactionResult)
    || String(transaction?.digest || '') !== receipt.txDigest
  ) {
    fail(
      'COMPLETION_RECEIPT_V5_TRANSACTION',
      'The Soulidity completion transaction did not succeed on chain.',
    );
  }
  if (transactionSender(transactionResult) !== exact.wallet) {
    fail(
      'COMPLETION_RECEIPT_V5_PAYER',
      'The Soulidity completion transaction was signed by another wallet.',
    );
  }
  const events = Array.isArray(transaction?.events) ? transaction.events : [];
  const completeEvent = events.find((event) => exactMoveType(
    eventMoveType(event),
    commerceTypeOriginPackageId,
    'commerce_v5',
    'CompleteAuthorizedV5',
  ));
  const complete = parsedFields(completeEvent);
  if (!complete) {
    fail(
      'COMPLETION_RECEIPT_V5_AUTHORIZATION_EVENT',
      'The transaction is missing the canonical Commerce v5 authorization event.',
    );
  }
  const completeMatches = (
    comparableId(field(complete, 'root_id', 'rootId')) === exact.rootObjectId
    && comparableId(field(complete, 'legacy_maker_id', 'legacyMakerId'))
      === exact.legacyMakerObjectId
    && comparableId(field(complete, 'payer')) === exact.wallet
    && exactHex(field(complete, 'output_seal_id', 'outputSealId'), 'Authorized output Seal ID')
      === exact.outputSealId
    && exactHex(field(complete, 'output_nonce', 'outputNonce'), 'Authorized output nonce')
      === exact.outputNonce
    && exactHex(field(complete, 'output_digest', 'outputDigest'), 'Authorized output digest')
      === exact.outputDigest
    && String(field(complete, 'ciphertext_blob_id', 'ciphertextBlobId') || '')
      === exact.imageBlobId
  );
  if (!completeMatches) {
    fail(
      'COMPLETION_RECEIPT_V5_AUTHORIZATION_MISMATCH',
      'The on-chain Complete authorization does not match this exact OC output.',
    );
  }

  const bindingEvent = events.find((event) => exactMoveType(
    eventMoveType(event),
    commerceTypeOriginPackageId,
    'commerce_v5',
    'CompleteOutputBoundToSoulV5',
  ));
  const binding = parsedFields(bindingEvent);
  if (
    !binding
    || comparableId(field(binding, 'root_id', 'rootId')) !== exact.rootObjectId
    || exactHex(field(binding, 'seal_id', 'sealId'), 'Bound output Seal ID')
      !== exact.outputSealId
    || comparableId(field(binding, 'soul_id', 'soulId'))
      !== receipt.soulObjectId
    || comparableId(field(binding, 'payer')) !== exact.wallet
  ) {
    fail(
      'COMPLETION_RECEIPT_V5_OUTPUT_BINDING',
      'The transaction did not atomically bind this exact encrypted output to the minted Soul.',
    );
  }

  let completeOutputRecord;
  try {
    completeOutputRecord = await queryCompleteOutputRecordV5(
      suiClient,
      {
        objectId: exact.rootObjectId,
        completeOutputsTableId: exact.completeOutputsTableId,
      },
      exact.outputSealId,
    );
  } catch (cause) {
    fail(
      'COMPLETION_RECEIPT_V5_OUTPUT_RECORD',
      'The exact on-chain Commerce v5 Complete output record is unavailable.',
      { cause },
    );
  }
  if (
    comparableId(completeOutputRecord.rootId) !== exact.rootObjectId
    || completeOutputRecord.sealId !== exact.outputSealId
    || comparableId(completeOutputRecord.payer) !== exact.wallet
    || completeOutputRecord.recipeHash !== exact.recipeHash
    || completeOutputRecord.outputNonce !== exact.outputNonce
    || completeOutputRecord.outputDigest !== exact.outputDigest
    || completeOutputRecord.ciphertextBlobId !== exact.imageBlobId
    || completeOutputRecord.soulBound !== true
    || comparableId(completeOutputRecord.boundSoulId)
      !== receipt.soulObjectId
  ) {
    fail(
      'COMPLETION_RECEIPT_V5_OUTPUT_RECORD_MISMATCH',
      'The on-chain Commerce v5 Complete output record does not match this exact Soul and OC output.',
    );
  }

  const provenanceEvent = events.find((event) => exactMoveType(
    eventMoveType(event),
    soulidityTypeOriginPackageId,
    'animacraft_provenance',
    'AnimacraftProvenanceCreated',
  ));
  const provenanceCreated = parsedFields(provenanceEvent);
  const soulStateObjectId = comparableId(
    field(provenanceCreated, 'state_id', 'stateId'),
  );
  if (
    !provenanceCreated
    || comparableId(field(provenanceCreated, 'provenance_id', 'provenanceId'))
      !== receipt.provenanceObjectId
    || comparableId(field(provenanceCreated, 'soul_id', 'soulId'))
      !== receipt.soulObjectId
    || comparableId(field(provenanceCreated, 'maker_id', 'makerId'))
      !== exact.rootObjectId
    || comparableId(field(provenanceCreated, 'maker_treasury_id', 'makerTreasuryId'))
      !== exact.makerTreasuryObjectId
    || comparableId(field(provenanceCreated, 'payer')) !== exact.wallet
    || !soulStateObjectId
  ) {
    fail(
      'COMPLETION_RECEIPT_V5_PROVENANCE_EVENT',
      'The transaction is missing the exact Soulidity provenance event.',
    );
  }

  const outputProvenanceEvent = events.find((event) => exactMoveType(
    eventMoveType(event),
    soulidityTypeOriginPackageId,
    'animacraft_output_provenance_v5',
    'AnimacraftOutputProvenanceV5Created',
  ));
  const outputProvenanceCreated = parsedFields(outputProvenanceEvent);
  if (
    !outputProvenanceCreated
    || comparableId(
      field(
        outputProvenanceCreated,
        'output_provenance_id',
        'outputProvenanceId',
      ),
    ) !== receipt.outputProvenanceObjectId
    || comparableId(
      field(outputProvenanceCreated, 'base_provenance_id', 'baseProvenanceId'),
    ) !== receipt.provenanceObjectId
    || comparableId(field(outputProvenanceCreated, 'soul_id', 'soulId'))
      !== receipt.soulObjectId
    || comparableId(field(outputProvenanceCreated, 'state_id', 'stateId'))
      !== soulStateObjectId
    || comparableId(
      field(outputProvenanceCreated, 'maker_root_id', 'makerRootId'),
    ) !== exact.rootObjectId
    || exactHex(
      field(
        outputProvenanceCreated,
        'complete_output_seal_id',
        'completeOutputSealId',
      ),
      'Completed-output provenance Seal ID',
    ) !== exact.outputSealId
  ) {
    fail(
      'COMPLETION_RECEIPT_V5_OUTPUT_PROVENANCE_EVENT',
      'The transaction is missing the exact completed-output provenance event.',
    );
  }

  const [provenanceResponse, outputProvenanceResponse] = await Promise.all([
    suiClient.getObject({
      objectId: receipt.provenanceObjectId,
      include: { json: true },
    }),
    suiClient.getObject({
      objectId: receipt.outputProvenanceObjectId,
      include: { json: true },
    }),
  ]);
  const provenanceData = provenanceResponse?.object ?? provenanceResponse?.data;
  const provenanceFields = provenanceData?.json
    ?? (provenanceData?.content?.dataType === 'moveObject'
      ? provenanceData.content.fields
      : null);
  if (
    !provenanceFields
    || !exactMoveType(
      provenanceData?.type,
      soulidityTypeOriginPackageId,
      'animacraft_provenance',
      'AnimacraftProvenance',
    )
    || !immutableOwner(provenanceData?.owner)
  ) {
    fail(
      'COMPLETION_RECEIPT_V5_PROVENANCE_OBJECT',
      'The canonical Animacraft provenance object is unavailable.',
    );
  }
  const provenanceMatches = (
    Number(field(provenanceFields, 'animacraft_version', 'animacraftVersion')) === 5
    && comparableId(field(provenanceFields, 'soul_id', 'soulId'))
      === receipt.soulObjectId
    && comparableId(field(provenanceFields, 'maker_id', 'makerId'))
      === exact.rootObjectId
    && comparableId(field(provenanceFields, 'maker_treasury_id', 'makerTreasuryId'))
      === exact.makerTreasuryObjectId
    && comparableId(field(provenanceFields, 'payer')) === exact.wallet
    && String(field(provenanceFields, 'profile_json_blob_id', 'profileJsonBlobId') || '')
      === exact.profileBlobId
    && String(field(provenanceFields, 'image_blob_id', 'imageBlobId') || '')
      === exact.imageBlobId
    && String(field(provenanceFields, 'image_url', 'imageUrl') || '')
      === exact.imageUrl
    && exactHex(field(provenanceFields, 'recipe_hash', 'recipeHash'), 'Provenance Recipe hash')
      === exact.recipeHash
  );
  if (!provenanceMatches) {
    fail(
      'COMPLETION_RECEIPT_V5_PROVENANCE_MISMATCH',
      'The Soulidity provenance object does not match this exact OC output.',
    );
  }

  const outputProvenanceData = outputProvenanceResponse?.object
    ?? outputProvenanceResponse?.data;
  const outputProvenanceFields = outputProvenanceData?.json
    ?? (outputProvenanceData?.content?.dataType === 'moveObject'
      ? outputProvenanceData.content.fields
      : null);
  if (
    !outputProvenanceFields
    || !exactMoveType(
      outputProvenanceData?.type,
      soulidityTypeOriginPackageId,
      'animacraft_output_provenance_v5',
      'AnimacraftOutputProvenanceV5',
    )
    || !immutableOwner(outputProvenanceData?.owner)
  ) {
    fail(
      'COMPLETION_RECEIPT_V5_OUTPUT_PROVENANCE_OBJECT',
      'The immutable completed-output provenance object is unavailable.',
    );
  }
  if (
    Number(field(outputProvenanceFields, 'version')) !== 1
    || comparableId(field(outputProvenanceFields, 'soul_id', 'soulId'))
      !== receipt.soulObjectId
    || comparableId(
      field(outputProvenanceFields, 'base_provenance_id', 'baseProvenanceId'),
    ) !== receipt.provenanceObjectId
    || comparableId(
      field(outputProvenanceFields, 'maker_root_id', 'makerRootId'),
    ) !== exact.rootObjectId
    || exactHex(
      field(
        outputProvenanceFields,
        'complete_output_seal_id',
        'completeOutputSealId',
      ),
      'Frozen completed-output provenance Seal ID',
    ) !== exact.outputSealId
  ) {
    fail(
      'COMPLETION_RECEIPT_V5_OUTPUT_PROVENANCE_MISMATCH',
      'The completed-output provenance object does not match this exact OC output.',
    );
  }

  return Object.freeze({
    confirmed: true,
    exportKey: exact.exportKey,
    digest: receipt.txDigest,
    soulObjectId: receipt.soulObjectId,
    provenanceObjectId: receipt.provenanceObjectId,
    outputProvenanceObjectId: receipt.outputProvenanceObjectId,
    soulStateObjectId,
    rootObjectId: exact.rootObjectId,
    recipeHash: exact.recipeHash,
    outputSealId: exact.outputSealId,
    outputDigest: exact.outputDigest,
    imageBlobId: exact.imageBlobId,
  });
}
