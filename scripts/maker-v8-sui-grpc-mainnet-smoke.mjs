import { normalizeSuiAddress } from '@mysten/sui/utils';
import {
  MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
  createProductionMakerV8SuiGrpcTransport,
  isMakerV8SuiGrpcNotFoundError,
} from '../maker-v8-sui-grpc.js';

const PINNED_TRANSACTION = 'EZeS7CpqutgCYCijqH92mLFqyGAyfH5cvGyAzfAyLra3';
const PINNED_CHECKPOINT = '313650111';
const PINNED_EPOCH = '1227';
const PINNED_EFFECTS_DIGEST = 'CL3ZWBpky2idKZJNsdHzPEFW7jHduW6PxHiHfFEV7LYv';
const PINNED_EVENTS_DIGEST = '5iN5yd718PUQq1XAznSHkaaLXP7edCUwQqAvkvzfgN7a';
const MISSING_TRANSACTION = '11111111111111111111111111111111';
const SUI_FRAMEWORK_PACKAGE = normalizeSuiAddress('0x2');
const CLOCK_OBJECT = normalizeSuiAddress('0x6');
const CLOCK_TYPE = `${SUI_FRAMEWORK_PACKAGE}::clock::Clock`;

function requireValue(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

async function main() {
  const transport = createProductionMakerV8SuiGrpcTransport();
  const serviceInfo = await transport.getServiceInfo();
  requireValue(
    serviceInfo.chainIdentifier === MAKER_V8_SUI_MAINNET_GENESIS_DIGEST
      && serviceInfo.chain === 'mainnet',
    'Official gRPC service is not pinned Sui Mainnet.',
    serviceInfo,
  );

  const watermark = await transport.getCheckpointWatermark();
  requireValue(
    watermark.epoch === serviceInfo.epoch
      && watermark.checkpoint.sequenceNumber >= serviceInfo.lowestAvailableCheckpoint,
    'Checkpoint summary epoch or pruning watermark drifted.',
    { serviceInfo, watermark },
  );

  const framework = await transport.getObject({
    id: SUI_FRAMEWORK_PACKAGE,
    options: { showBcs: true, showOwner: true },
  });
  const frameworkModules = Object.keys(framework.data.bcs?.moduleMap ?? {});
  requireValue(
    framework.data.type === 'package'
      && framework.data.owner?.Immutable === true
      && frameworkModules.includes('sui'),
    '0x2 raw package module evidence is incomplete.',
    { data: framework.data, moduleCount: frameworkModules.length },
  );

  const protocol = await transport.getProtocolConfig();
  requireValue(
    protocol.protocolVersion === '133'
      && protocol.attributes.object_runtime_max_num_cached_objects === '1000'
      && protocol.attributes.object_runtime_max_num_store_entries === '1000'
      && protocol.attributes.bridge_should_try_to_finalize_committee === 'true',
    'Mainnet protocol 133 string attributes drifted.',
    { protocolVersion: protocol.protocolVersion },
  );
  const gaslessTokens = protocol.attributes.gasless_allowed_token_types;
  requireValue(
    typeof gaslessTokens === 'string'
      && Array.isArray(JSON.parse(gaslessTokens)),
    'Mainnet protocol JSON attribute was not preserved as its exact opaque string.',
  );

  const currentClock = await transport.getObject({
    id: CLOCK_OBJECT,
    options: { showBcs: true, showContent: true, showOwner: true },
  });
  const historicalClock = await transport.getHistoricalObject({
    objectId: CLOCK_OBJECT,
    version: BigInt(currentClock.data.version),
  });
  requireValue(
    historicalClock.digest === currentClock.data.digest
      && historicalClock.type === CLOCK_TYPE
      && historicalClock.contentBcs instanceof Uint8Array
      && historicalClock.objectBcs instanceof Uint8Array,
    'Clock historical Object BCS did not bind its current object envelope.',
    { current: currentClock.data, historical: historicalClock },
  );

  let notFoundError = null;
  try {
    await transport.getFinalizedTransactionEvidence({ digest: MISSING_TRANSACTION });
  } catch (error) {
    if (isMakerV8SuiGrpcNotFoundError(error, MISSING_TRANSACTION)) {
      notFoundError = error;
    } else {
      throw error;
    }
  }
  requireValue(notFoundError !== null, 'Missing transaction did not produce exact typed GetTransaction NOT_FOUND.');

  let transaction;
  try {
    transaction = await transport.getFinalizedTransactionEvidence({ digest: PINNED_TRANSACTION });
  } catch (error) {
    if (isMakerV8SuiGrpcNotFoundError(error, PINNED_TRANSACTION)) {
      console.error(JSON.stringify({
        status: 'PINNED_TRANSACTION_PRUNED',
        digest: PINNED_TRANSACTION,
        serviceName: error.serviceName,
        methodName: error.methodName,
        code: error.code,
      }, null, 2));
      process.exitCode = 2;
      return;
    }
    throw error;
  }
  requireValue(
    transaction.checkpoint === PINNED_CHECKPOINT
      && transaction.epoch === PINNED_EPOCH
      && transaction.signatures.length === 2
      && transaction.effectsDigest === PINNED_EFFECTS_DIGEST
      && transaction.eventsDigest === PINNED_EVENTS_DIGEST
      && transaction.transactionEvents?.eventCount === 2,
    'Pinned finalized transaction BCS evidence drifted.',
    transaction,
  );

  console.log(JSON.stringify({
    status: 'PASS',
    writes: 0,
    serviceInfo,
    checkpointSummary: {
      sequenceNumber: watermark.checkpoint.sequenceNumber,
      digest: watermark.checkpoint.digest,
      epoch: watermark.epoch,
    },
    frameworkPackage: {
      objectId: framework.data.objectId,
      version: framework.data.version,
      digest: framework.data.digest,
      moduleCount: frameworkModules.length,
    },
    protocol133: {
      protocolVersion: protocol.protocolVersion,
      objectRuntimeMaxNumCachedObjects:
        protocol.attributes.object_runtime_max_num_cached_objects,
      objectRuntimeMaxNumStoreEntries:
        protocol.attributes.object_runtime_max_num_store_entries,
      opaqueBoolean: protocol.attributes.bridge_should_try_to_finalize_committee,
      opaqueJsonByteLength: new TextEncoder().encode(gaslessTokens).length,
    },
    historicalClock: {
      objectId: historicalClock.objectId,
      version: historicalClock.version,
      digest: historicalClock.digest,
      type: historicalClock.type,
      objectBcsByteLength: historicalClock.objectBcs.length,
      contentBcsByteLength: historicalClock.contentBcs.length,
    },
    notFoundClassification: {
      digest: MISSING_TRANSACTION,
      name: notFoundError.name,
      code: notFoundError.code,
      serviceName: notFoundError.serviceName,
      methodName: notFoundError.methodName,
    },
    finalizedTransaction: {
      digest: transaction.digest,
      checkpoint: transaction.checkpoint,
      epoch: transaction.epoch,
      signatureCount: transaction.signatures.length,
      effectsDigest: transaction.effectsDigest,
      eventsDigest: transaction.eventsDigest,
      eventCount: transaction.transactionEvents.eventCount,
    },
  }, null, 2));
}

await main();
