import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';
import { GrpcTypes } from '@mysten/sui/grpc';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { nativeSoulPublicationFixture } from './native-soul-publication-fixture.mjs';
import { NATIVE_SOUL_KIOSK_DEPENDENCY as KIOSK } from '../../scripts/native-soul-source-cas.mjs';
import { NATIVE_SOUL_EXTERNAL_PUBLICATIONS } from '../../scripts/native-soul-external-publications.mjs';
import { certifyMainnetV8PackagePublish, deriveMainnetV8ProtocolConfigCommitment } from '../../scripts/mainnet-v8-release.mjs';
import { NativeSoulBootstrapBcs as BootstrapBcs, NATIVE_SOUL_BOOTSTRAP_USDC_TYPE } from '../../scripts/native-soul-bootstrap-readback.mjs';
import { assertPackagePublishCertificate, mainnetV8TypedDigest, MAINNET_V8_PUBLISH_ORDER,
  MAINNET_V8_RELEASE_SIGNER, MAINNET_V8_CHAIN_IDENTIFIER,
  buildMainnetV8PackageArtifact, mainnetV8PackageCommitment,
  mainnetV8AbiCommitment, sha256MainnetV8Bytes, sha256MainnetV8Json } from '../../scripts/mainnet-v8-release-lib.mjs';

export const id = n => `0x${n.toString(16).padStart(64, '0')}`;
// Actual sample.mv: approved sui 1.78.1-722ac4fcf484, WAE mainnet build.
// Source: module sample::sample { public struct Sample has copy, drop, store
// { value: u64 } public fun value(sample: &Sample): u64 { sample.value } }
// Move.toml: edition="2024", [addresses] sample="0x0". No added dependencies.
// Reproduce: sui move build --path <fixture> --build-env mainnet --warnings-are-errors.
// SHA256 e75e46f8c6c7eb942942c8b1c80f75a19bc31789924a960696325d37ecb1c7b7.
const OWN_DATATYPE_MODULE = 'oRzrCwcAAAUJAQACAgIEAwYFBQsHBxIUCCYgCkYFDEsNDVgCAAEAAAcAAAIAAQABBggAAQMABlNhbXBsZQZzYW1wbGUFdmFsdWUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAQIDAAEAAAIECwAQABQCAAAAAA==';
function ownModuleBytes(address, ownDatatype = false) {
  if (!ownDatatype) return moduleBytes(address, 'sample');
  const bytes = fromBase64(OWN_DATATYPE_MODULE);
  assert.equal(sha256MainnetV8Bytes(bytes), 'e75e46f8c6c7eb942942c8b1c80f75a19bc31789924a960696325d37ecb1c7b7');
  assert.deepEqual(bytes.slice(74, 106), new Uint8Array(32));
  // Exactly the compiler's sole self address table entry, not a datatype edit.
  bytes.set(Buffer.from(address.slice(2), 'hex'), 74);
  return bytes;
}
function moduleBytes(address, name) {
  const names = Buffer.concat([Buffer.from([name.length]), Buffer.from(name)]);
  return Buffer.concat([Buffer.from([0xa1, 0x1c, 0xeb, 0x0b, 6, 0, 0, 0, 3,
    1, 0, 2, 7, 2, names.length, 8, 2 + names.length, 32, 0, 0]), names,
  Buffer.from(address.slice(2), 'hex'), Buffer.from([0])]);
}
function packageObject(target, version, modules, origins, links, previousTransaction) {
  const bytes = bcs.Object.serialize({ data: { Package: { id: target, version, moduleMap: modules,
    typeOriginTable: origins, linkageTable: new Map(links.map(row => [row.originalId,
      { upgradedId: row.upgradedId, upgradedVersion: row.upgradedVersion }])) } },
  owner: { Immutable: true }, previousTransaction, storageRebate: '0' }).toBytes();
  return { reference: { objectId: target, version, digest: mainnetV8TypedDigest('Object', bytes) }, objectBcsBase64: toBase64(bytes) };
}
export function nativeSoulPublicationCertificateFixture(role = 'soulidity', options = {}) {
  const f = nativeSoulPublicationFixture(options), { args } = f;
  const tx = args.moveOutputs[0].previousTransaction;
  const modules = ['kiosk_lock_rule', 'personal_kiosk_rule', 'witness_rule'];
  const origins = [
    { moduleName: modules[0], datatypeName: 'Config', package: args.kioskTypeOrigins.kioskLockConfig },
    { moduleName: modules[0], datatypeName: 'Rule', package: args.kioskTypeOrigins.kioskLockRule },
    { moduleName: modules[1], datatypeName: 'Rule', package: args.kioskTypeOrigins.personalKioskRule },
    { moduleName: modules[2], datatypeName: 'Rule', package: args.kioskTypeOrigins.witnessRule },
  ];
  // Minimal table-encoded bytecode is only a reader/ABI fixture, not executable
  // Sui bytecode or a claimed on-chain package. All envelopes/hashes are actual BCS.
  const dependency = packageObject(KIOSK.callable, options.currentExternalPins ? '4' : '3', new Map(modules.map(name => [name, moduleBytes(KIOSK.original, name)])), origins, [], tx);
  const externalPackages = options.currentExternalPins
    ? NATIVE_SOUL_EXTERNAL_PUBLICATIONS.map(pin => pin.packageName === 'Kiosk' ? dependency
      : packageObject(pin.publishedAt, pin.version, new Map([['sample', moduleBytes(pin.originalId, 'sample')]]), [], [], tx))
    : [dependency];
  const links = options.currentExternalPins
    ? NATIVE_SOUL_EXTERNAL_PUBLICATIONS.map(pin => ({ originalId: pin.originalId, upgradedId: pin.publishedAt, upgradedVersion: pin.version }))
    : [{ originalId: KIOSK.original, upgradedId: KIOSK.callable, upgradedVersion: '3' }];
  const dependencies = externalPackages.map(p => p.reference.objectId).sort();
  const ownDatatype = options.ownDatatype === true;
  const source = ownModuleBytes(id(0), ownDatatype), published = ownModuleBytes(args.packageId, ownDatatype);
  const ownOrigins = ownDatatype ? [{ moduleName: 'sample', datatypeName: 'Sample', package: args.packageId }] : [];
  const own = packageObject(args.packageId, '1', new Map([['sample', published]]), ownOrigins, links, tx);
  args.created[0] = { operation: 'CREATED', ...own.reference, owner: { kind: 'Immutable' } };
  if (role !== 'soulidity') { args.created = args.created.slice(0, 2); args.moveOutputs = args.moveOutputs.slice(0, 1); }
  if (role === 'core') {
    const configId = options.protocolConfigId ?? id(700);
    const commitment = [...Buffer.from(deriveMainnetV8ProtocolConfigCommitment({ configId, coreOriginalPackageId: args.packageId,
      coreCallablePackageId: args.packageId, revision: '0', treasuryId: null, enabled: false }), 'hex')];
    f.encode('protocolConfig', `${args.packageId}::protocol_config_v8::ProtocolConfigV8`, BootstrapBcs.protocol,
      { id: configId, version: '8', core_original_package_id: args.packageId, core_callable_package_id: args.packageId,
        revision: '0', treasury_id: null, payment_coin_type: NATIVE_SOUL_BOOTSTRAP_USDC_TYPE, primary_content_fee_bps: 1000,
        fixed_complete_fee_atomic: '0', maker_market_fee_bps: 250, soul_market_fee_bps: 250, enabled: false, commitment },
      { kind: 'Shared', initialSharedVersion: '7' }, false);
    f.encode('protocolAdminCap', `${args.packageId}::protocol_config_v8::ProtocolAdminCapV8`, BootstrapBcs.protocolAdmin,
      { id: options.protocolAdminCapId ?? id(701), version: '8', config_id: configId }, { kind: 'AddressOwner', address: args.signer }, true);
  }
  const packages = new Map([[args.packageId, own], ...externalPackages.map(p => [p.reference.objectId, p])]);
  const reads = [];
  const transport = {
    async getHistoricalObject({ objectId, version }) {
      reads.push({ objectId, version: String(version), kind: 'historical' });
      if (packages.has(objectId)) {
        const evidence = packages.get(objectId); assert.equal(String(version), evidence.reference.version);
        return { ...evidence.reference, type: 'package', previousTransaction: tx, owner: { Immutable: true }, objectBcs: fromBase64(evidence.objectBcsBase64) };
      }
      const output = args.moveOutputs.find(row => row.reference.objectId === objectId); assert.ok(output);
      return { ...output.reference, type: output.type, owner: output.owner, previousTransaction: output.previousTransaction,
        contentBcs: fromBase64(output.contentBcsBase64), objectBcs: fromBase64(output.objectBcsBase64) };
    },
    async getObject({ id: objectId }) {
      reads.push({ objectId, kind: 'current' });
      if (objectId === args.packageId) return { data: { ...own.reference, previousTransaction: tx, bcs: { moduleMap: { sample: toBase64(published) } } } };
      assert.ok(!dependencies.includes(objectId), 'Never use latest dependency');
      const output = args.moveOutputs.find(row => row.reference.objectId === objectId); assert.ok(output);
      return { data: { ...output.reference, type: output.type, owner: output.owner, previousTransaction: output.previousTransaction,
        content: { dataType: 'moveObject', fields: output.fields }, bcs: { dataType: 'moveObject', bcsBytes: output.contentBcsBase64 } } };
    },
  };
  const typeName = `${args.packageId}::sample::Sample`;
  const descriptor = GrpcTypes.Package.fromJson({ storageId: args.packageId, originalId: args.packageId, version: '1', modules: [{ name: 'sample',
    datatypes: ownDatatype ? [{ typeName, definingId: args.packageId, module: 'sample', name: 'Sample',
      abilities: ['COPY', 'DROP', 'STORE'], typeParameters: [], kind: 'STRUCT',
      fields: [{ name: 'value', position: 0, type: { type: 'U64', typeParameterInstantiation: [] } }], variants: [] }] : [],
    functions: ownDatatype ? [{ name: 'value', visibility: 'PUBLIC', isEntry: false, typeParameters: [],
      parameters: [{ reference: 'IMMUTABLE', body: { type: 'DATATYPE', typeName, typeParameterInstantiation: [] } }],
      returns: [{ body: { type: 'U64', typeParameterInstantiation: [] } }] }] : [] }] });
  const input = { role, signer: args.signer, transport,
    client: { movePackageService: { getPackage({ packageId }) { assert.equal(packageId, args.packageId); return { response: Promise.resolve({ package: descriptor }) }; } } },
    build: { modules: [{ name: 'sample', base64: toBase64(source) }], packageArtifact: { dependencies } }, finalityEvidence: null };
  function effects() {
    const owner = r => r.owner.kind === 'Shared' ? { Shared: { initialSharedVersion: r.owner.initialSharedVersion } }
      : r.owner.kind === 'Immutable' ? { Immutable: true } : { [r.owner.kind]: r.owner.address };
    return { V2: { status: { Success: true }, executedEpoch: '1242', gasUsed: { computationCost: '1', storageCost: '1', storageRebate: '0', nonRefundableStorageFee: '0' },
      transactionDigest: tx, gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: '7',
      changedObjects: args.created.map(row => [row.objectId, { inputState: { NotExist: true }, idOperation: { Created: true },
        outputState: row.objectId === args.packageId ? { PackageWrite: ['1', row.digest] } : { ObjectWrite: [row.digest, owner(row)] } }]),
      unchangedConsensusObjects: [], auxDataDigest: null } };
  }
  const setEffects = value => { input.finalityEvidence = { digest: tx, effectsBcsBase64: bcs.TransactionEffects.serialize(value).toBase64() }; };
  setEffects(effects());
  return { ...f, input, reads, packages, own, dependency, effects, setEffects,
    cold(result) {
      return assertPackagePublishCertificate(result, String(MAINNET_V8_PUBLISH_ORDER.indexOf(role)), input.finalityEvidence,
        { abiArtifact: result.package.abiArtifact, packageArtifact: { dependencies, modules: [{ name: 'sample', bytesBase64: toBase64(source) }] } }, args.signer);
    } };
}


export async function nativeSoulPublicationOutcomeFixture({ role = 'soulidity', outputOwner = MAINNET_V8_RELEASE_SIGNER, ownDatatype = false, nonce = 42, ...options } = {}) {
  const source = toBase64(ownModuleBytes(id(0), ownDatatype));
  const dependencies = options.currentExternalPins
    ? NATIVE_SOUL_EXTERNAL_PUBLICATIONS.map(p => p.publishedAt).sort() : [KIOSK.callable];
  const tx = new Transaction();
  const cap = tx.publish({ modules: [source], dependencies });
  tx.transferObjects([cap], MAINNET_V8_RELEASE_SIGNER);
  tx.setSender(MAINNET_V8_RELEASE_SIGNER); tx.setGasOwner(MAINNET_V8_RELEASE_SIGNER);
  tx.setGasPayment([]); tx.setGasBudget(1000); tx.setGasPrice(1);
  tx.setExpiration({ ValidDuring: { minEpoch: 1242, maxEpoch: 1243, minTimestamp: null, maxTimestamp: null, chain: MAINNET_V8_CHAIN_IDENTIFIER, nonce } });
  const bytes = TransactionDataBuilder.restore(tx.getData()).build();
  const parsed = bcs.TransactionData.parse(bytes), digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  const kindBytes = bcs.TransactionKind.serialize(parsed.V1.kind).toBytes();
  // This test exercises the durable envelope/BCS checker, not cryptographic
  // wallet signing or checkpoint membership. No real secret or RPC is used.
  const signatureBytes = Uint8Array.of(0, ...new Uint8Array(96).fill(0x55)), signature = toBase64(signatureBytes);
  const senderBytes = bcs.SenderSignedData.serialize([{ intentMessage: { intent: { scope: { TransactionData: true }, version: { V0: true }, appId: { Sui: true } }, value: parsed }, txSignatures: [signature] }]).toBytes();
  const signedArtifact = { transactionBase64: toBase64(bytes), transactionSha256: sha256MainnetV8Bytes(bytes),
    transactionKindBase64: toBase64(kindBytes), transactionKindSha256: sha256MainnetV8Bytes(kindBytes), digest,
    signature, signatureSha256: sha256MainnetV8Bytes(signatureBytes), senderSignedDataBase64: toBase64(senderBytes), senderSignedDataSha256: sha256MainnetV8Bytes(senderBytes), signer: MAINNET_V8_RELEASE_SIGNER };
  const f = nativeSoulPublicationCertificateFixture(role, { ...options, ownDatatype, signer: outputOwner, transactionDigest: digest });
  const effectsBytes = fromBase64(f.input.finalityEvidence.effectsBcsBase64);
  f.input.finalityEvidence = { ...f.input.finalityEvidence, schemaVersion: 'animacraft.mainnet-v8-release-runner.v1',
    checkpoint: '319550159', epoch: '1242', transactionBase64: signedArtifact.transactionBase64,
    transactionSha256: signedArtifact.transactionSha256, signature, signatureSha256: signedArtifact.signatureSha256,
    effectsSha256: sha256MainnetV8Bytes(effectsBytes), effectsDigest: mainnetV8TypedDigest('TransactionEffects', effectsBytes),
    effectsStatus: { success: true, error: null }, eventsDigest: null, transactionEvents: null };
  const readback = await certifyMainnetV8PackagePublish(f.input);
  const packageArtifact = buildMainnetV8PackageArtifact({ role, modules: [{ name: 'sample', bytesBase64: source }], dependencies, buildDigest: 'a'.repeat(64) });
  const certificate = { finalityEvidence: f.input.finalityEvidence, finalityEvidenceSha256: sha256MainnetV8Json(f.input.finalityEvidence), readback, readbackSha256: sha256MainnetV8Json(readback) };
  const details = { packageArtifact, packageCommitment: mainnetV8PackageCommitment(packageArtifact), abiArtifact: readback.package.abiArtifact,
    abiCommitment: mainnetV8AbiCommitment(readback.package.abiArtifact), certificate, certificateSha256: sha256MainnetV8Json(certificate) };
  const input = { status: 'FINALIZED_SUCCESS', ordinal: String(MAINNET_V8_PUBLISH_ORDER.indexOf(role)), attempt: '0', readyArtifactSha256: 'b'.repeat(64), signedArtifact,
    signedArtifactSha256: sha256MainnetV8Json(signedArtifact), digest, observation: details };
  return { input, details };
}
