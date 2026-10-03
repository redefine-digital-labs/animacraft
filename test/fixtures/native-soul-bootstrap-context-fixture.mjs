import { createHash } from 'node:crypto';
import { toBase58 } from '@mysten/sui/utils';
import * as L from '../../scripts/mainnet-v8-release-lib.mjs';
import { nativeSoulBootstrapFixture, bootstrapStages, bootstrapId as id } from './native-soul-bootstrap-fixture.mjs';
import { bootstrapHistoryFixture, historicalObject, rewriteHistoricalObject } from './native-soul-bootstrap-history-fixture.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const digest = n => toBase58(new Uint8Array(32).fill(n));
const priorKeys = {
  INITIALIZE_PROTOCOL: ['protocol', 'protocolAdmin'], SETUP_RELEASE: ['protocol', 'protocolAdmin'],
  BEGIN_BOOTSTRAP: ['protocol', 'protocolAdmin', 'catalog', 'replacement', 'bootstrapSlot'],
  FINALIZE_BOOTSTRAP: ['protocol', 'protocolAdmin', 'catalog', 'replacement', 'bootstrapSlot', 'outputConfig', 'marketConfig', 'bootstrapAdmin'],
};

// Structurally coherent full-Object/source artifacts; no executed transactions,
// signatures, real package compilation or checkpoint finality is claimed.
export function contextFixture(stage) {
  const setup = nativeSoulBootstrapFixture('SETUP_RELEASE');
  const toolchain = { suiVersion: L.MAINNET_V8_SUI_VERSION, suiVersionOutput: L.MAINNET_V8_SUI_VERSION_OUTPUT,
    suiSourceCommit: L.MAINNET_V8_SUI_SOURCE_COMMIT, suiBinarySha256: L.MAINNET_V8_SUI_BINARY_SHA256,
    frameworkRevision: L.MAINNET_V8_FRAMEWORK_REVISION };
  const sourceRevision = { schema: 'animacraft.native-source-snapshot.v1', repositories: {
    animacraft: { baseGitCommit: '1'.repeat(40), baseGitTree: '2'.repeat(40) },
    soulidity: { baseGitCommit: '3'.repeat(40), baseGitTree: '4'.repeat(40) },
  }, packages: L.MAINNET_V8_PUBLISH_ORDER.map(role => {
    const files = ['Move.lock', 'Move.toml', 'sources/main.move'].map(path => ({ path,
      sha256: hash(`${role}/${path}`), byteLength: String(Buffer.byteLength(`${role}/${path}`)) }));
    return { role, packageName: L.MAINNET_V8_PUBLISH_PACKAGE_NAMES[role], repository: role === 'soulidity' ? role : 'animacraft',
      files, originalFiles: structuredClone(files) };
  }) };
  sourceRevision.snapshotSha256 = L.sha256MainnetV8Json(sourceRevision);
  const plan = { schemaVersion: L.MAINNET_V8_RELEASE_PLAN_SCHEMA, sourceRevision, toolchain,
    chain: { network: 'mainnet', chainIdentifier: L.MAINNET_V8_CHAIN_IDENTIFIER, legacyChainIdentifier: L.MAINNET_V8_LEGACY_CHAIN_IDENTIFIER },
    sender: L.MAINNET_V8_RELEASE_SIGNER, protocolProfile: structuredClone(L.MAINNET_V8_PROTOCOL_PROFILE),
    paymentCoinType: L.MAINNET_V8_PAYMENT_COIN_TYPE, steps: structuredClone(L.MAINNET_V8_RELEASE_STEPS),
    sealPolicy: L.buildMainnetV8SealPolicyTemplate({ keyServers: L.MAINNET_V8_BROWSER_KEY_SERVERS.map(({ objectId }) => ({ objectId, weight: '1' })), threshold: L.MAINNET_V8_BROWSER_SEAL_THRESHOLD }),
    packages: sourceRevision.packages.map(source => {
      const sourceArtifact = L.buildMainnetV8SourceArtifact({ ...source, toolchain,
        release: { snapshotSha256: sourceRevision.snapshotSha256, repository: source.repository,
          ...sourceRevision.repositories[source.repository] } });
      return { role: source.role, packageName: source.packageName, sourceArtifact, sourceCommitment: L.mainnetV8SourceCommitment(sourceArtifact) };
    }),
  };
  plan.executionPlanId = L.sha256MainnetV8Json(plan);
  const packages = plan.packages.map((p, i) => ({ role: p.role, packageId: setup.input.packageIds[p.role],
    packageDigest: digest(i + 1), packageVersion: '1', upgradeCapId: id(500 + i), publishDigest: digest(i + 21),
    sourceCommitment: p.sourceCommitment, packageCommitment: setup.input.commitments[p.role]?.package ?? hash('SO package'),
    abiCommitment: setup.input.commitments[p.role]?.abi ?? hash('SO abi'), finalityEvidenceSha256: hash(`finality/${p.role}`),
    readbackSha256: hash(`readback/${p.role}`) }));
  const manifest = L.buildMainnetV8FinalManifestContents({ plan, packages });
  const base = bootstrapHistoryFixture('INITIALIZE_PROTOCOL');
  const latest = structuredClone(base.priorObjects), coreTx = packages[0].publishDigest;
  for (const [kind, evidence] of Object.entries(latest)) {
    rewriteHistoricalObject(evidence, object => { object.previousTransaction = coreTx;
      if (kind === 'protocolAdmin') object.owner = { AddressOwner: plan.sender }; });
    evidence.previousTransaction = coreTx;
    if (kind === 'protocolAdmin') evidence.owner = { kind: 'address', address: plan.sender };
  }
  const raw = evidence => ({ ...structuredClone(evidence), owner: evidence.owner.kind === 'shared'
    ? { Shared: { initial_shared_version: evidence.owner.initialSharedVersion } } : { AddressOwner: evidence.owner.address } });
  const core = { schemaVersion: L.MAINNET_V8_RELEASE_RUNNER_SCHEMA, kind: 'PACKAGE_PUBLISH_CERTIFICATE', role: 'core',
    transactionDigest: coreTx, package: { reference: { objectId: packages[0].packageId } },
    protocolConfig: raw(latest.protocol), protocolAdminCap: raw(latest.protocolAdmin) };
  const priorReadbacks = { core };
  const commitments = L.mainnetV8CatalogCommitmentsFromFinalManifest(manifest, plan);
  for (const previous of bootstrapStages.slice(0, stage === 'VERIFY_AND_EXPORT' ? bootstrapStages.length : bootstrapStages.indexOf(stage))) {
    const f = nativeSoulBootstrapFixture(previous, { commitments }), ordinal = bootstrapStages.indexOf(previous), version = String(12 + ordinal);
    const priorObjects = Object.fromEntries(priorKeys[previous].map(kind => [kind, structuredClone(latest[kind])]));
    const shared = kind => ({ objectId: latest[kind].reference.objectId, initialSharedVersion: latest[kind].owner.initialSharedVersion });
    const owned = kind => ({ ...latest[kind].reference });
    const input = { packageIds: setup.input.packageIds, protocolConfig: shared('protocol'), protocolAdminCap: owned('protocolAdmin') };
    if (previous === 'SETUP_RELEASE') Object.assign(input, { commitments, sealPolicy: manifest.sealPolicy,
      walrusSystem: setup.input.walrusSystem, walrusExecution: setup.input.walrusExecution });
    if (previous === 'BEGIN_BOOTSTRAP' || previous === 'FINALIZE_BOOTSTRAP') Object.assign(input, { catalog: shared('catalog'), replacement: owned('replacement') });
    if (previous === 'FINALIZE_BOOTSTRAP') Object.assign(input, { bootstrapAdmin: owned('bootstrapAdmin'), outputConfig: shared('outputConfig'), marketConfig: shared('marketConfig') });
    const read = previous === 'BEGIN_BOOTSTRAP' ? ['protocol', 'replacement'] : [];
    const objects = {};
    for (const kind of Object.keys(f.objects)) {
      if (read.includes(kind)) { objects[kind] = structuredClone(latest[kind]); continue; }
      if (f.objects[kind].owner.kind === 'address') f.objects[kind].owner.address = plan.sender;
      if (f.objects[kind].owner.kind === 'shared') f.objects[kind].owner.initialSharedVersion = latest[kind]?.owner.initialSharedVersion ?? version;
      f.encode(kind); objects[kind] = historicalObject(f.objects[kind], version, digest(50 + ordinal));
    }
    priorReadbacks[previous] = { schema: 'native-soul-bootstrap-history-v1', stage: previous, input,
      objects, priorObjects, consensusObjects: {} };
    Object.assign(latest, objects);
  }
  const args = { stage, manifest, plan, priorReadbacks };
  if (stage === 'SETUP_RELEASE') Object.assign(args, { walrusSystem: setup.input.walrusSystem,
    walrusExecution: setup.input.walrusExecution, keyServerCertificates: L.MAINNET_V8_BROWSER_KEY_SERVERS.map(({ objectId, owner, contentSha256 }) => ({
    objectId, owner, contentSha256, type: L.MAINNET_V8_BROWSER_KEY_SERVER_TYPE,
    version: '1', digest: digest(80), previousTransaction: digest(81),
  })) });
  return structuredClone(args);
}
