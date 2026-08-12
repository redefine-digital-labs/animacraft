import assert from 'node:assert/strict';
import test from 'node:test';

import { scanV8HistoryWindow } from '../scripts/expansion-pack-v8-free-readiness.mjs';
import {
  requireFinalizerProtocolIdentities,
  requireIndependentExtensionTypeOrigin,
  requireMakerReleaseEvidenceTypeOrigin,
  unavailableObjectResult,
  validateParentStagePrior,
} from '../scripts/expansion-pack-v8-parent-stage.mjs';

const CHAIN = '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S';
const TYPE_ORIGIN = `0x${'11'.repeat(32)}`;
const INDEPENDENT_ORIGIN = `0x${'22'.repeat(32)}`;
const ROOT = `0x${'33'.repeat(32)}`;
const TREASURY = `0x${'44'.repeat(32)}`;
const CONTROL_CAP = `0x${'55'.repeat(32)}`;
const MAKER = `0x${'66'.repeat(32)}`;
const CONFIG = `0x${'77'.repeat(32)}`;
const ADMIN = `0x${'88'.repeat(32)}`;
const SIGNER = `0x${'99'.repeat(32)}`;
const ROUTE = 'aa'.repeat(32);
const CUTOFF = Object.freeze({
  sequenceNumber: '100',
  digest: 'CutoffDigest100',
  timestamp: '2026-08-12T00:00:00Z',
});

function intent() {
  return {
    network: { chainIdentifier: CHAIN },
    transactions: { parentFinalize: { expiration: { chain: CHAIN } } },
    protocol: {
      typeOriginPackageId: TYPE_ORIGIN,
      commerceV5CallablePackageId: TYPE_ORIGIN,
      commerceV5TypeOriginPackageId: `0x${'cf'.repeat(32)}`,
      independentExtensionV5TypeOriginPackageId: INDEPENDENT_ORIGIN,
      legacyLogicalV5TypeOriginPackageId: INDEPENDENT_ORIGIN,
      commerceProtocolConfigV5Id: CONFIG,
      protocolFeeAdminCapId: ADMIN,
    },
    parent: {
      legacyMakerId: MAKER,
      versionNumber: '2',
      manifestQuiltId: 'parent-quilt',
      manifestSha256: 'bb'.repeat(32),
      exactStyleRouteSha256: ROUTE,
      expectedStyleCount: 26,
      expectedStyleCounts: { visual: 19, logicalNone: 3, logicalColor: 4, total: 26 },
      currentV5: { rootId: ROOT, treasuryId: TREASURY, controlCapId: CONTROL_CAP },
    },
    signer: { address: SIGNER },
    productGates: {
      expansionPackV8ReleaseEnabledBeforePublication: false,
      commerceV5ReleaseEnabled: false,
      canonicalSoulMintEnabled: false,
      compositionV6ReleaseEnabled: false,
      physicalStyleV7ReleaseEnabled: false,
      completeBridgeEnabled: false,
      physicalBridgeEnabled: false,
    },
  };
}

function deployment() {
  return {
    releases: {
      expansionPackV8: {
        callablePackageId: TYPE_ORIGIN,
        typeOriginPackageId: TYPE_ORIGIN,
      },
    },
  };
}

function priorResult(stage) {
  const transactionDigest = 'PriorDigest';
  return {
    schemaVersion: 'animacraft.expansion-pack-v8-parent-stage-result.v1',
    stage,
    transactionDigest,
    finalized: {
      digest: transactionDigest,
      effects: {
        transactionDigest,
        status: { success: true, error: null },
      },
      events: [],
    },
    postState: {
      root: {
        objectId: ROOT,
        lifecycle: 1,
        styleCount: '0',
        styleRegistrySealed: false,
        packCount: '0',
        requiresSealPolicy: false,
        sealPolicyBound: false,
        baseAccess: { kind: 0, purchasePriceAtomic: '0' },
        basePolicy: {
          mode: 0,
          freeQuotaPerWallet: '0',
          priceAtomic: '0',
          totalCap: '0',
        },
      },
      packs: [],
      styles: [],
    },
  };
}

function evidencePrior() {
  const result = priorResult('evidence');
  result.finalized.events = [{
    eventType: `${TYPE_ORIGIN}::commerce_v5::MakerReleaseEvidenceBoundV5`,
    json: {
      root_id: ROOT,
      legacy_maker_id: MAKER,
      parent_version: '2',
      manifest_blob_id: 'parent-quilt',
      manifest_sha256: `0x${'bb'.repeat(32)}`,
      newly_bound: true,
    },
  }];
  result.postState.releaseEvidence = {
    rootId: ROOT,
    parentVersion: '2',
    parentManifestBlobId: 'parent-quilt',
    parentManifestSha256: 'bb'.repeat(32),
  };
  return result;
}

function emptyConnection(name) {
  return { data: { [name]: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } };
}

function graphqlMock({ chain = CHAIN, eventNode = null, passNode = null, anchor = CUTOFF } = {}) {
  const calls = [];
  return {
    calls,
    async query({ query, variables }) {
      calls.push({ query, variables });
      if (query.includes('ExpansionPackV8ZeroHistoryCutoff')) {
        return { data: { chainIdentifier: chain, checkpoint: CUTOFF } };
      }
      if (query.includes('ExpansionPackV8ZeroHistoryAnchor')) {
        return { data: { chainIdentifier: chain, checkpoint: anchor } };
      }
      if (query.includes('ExpansionPackV8ZeroHistoryObjects')) {
        return passNode
          ? { data: { objects: { pageInfo: { hasNextPage: false }, nodes: [passNode] } } }
          : emptyConnection('objects');
      }
      if (query.includes('ExpansionPackV8ZeroHistory')) {
        return eventNode && variables.type.endsWith('::ExpansionPackAdmittedV8')
          ? { data: { events: { pageInfo: { hasNextPage: false }, nodes: [eventNode] } } }
          : emptyConnection('events');
      }
      throw new Error('Unexpected GraphQL query.');
    },
  };
}

const source = Object.freeze({ headCommit: 'commit', headTree: 'tree' });
const runtime = Object.freeze({ graphqlUrl: 'https://graphql.mainnet.sui.io/graphql' });

test('trusted v8 history omits permissionless Created scans and binds the reviewed chain', async () => {
  const graphqlClient = graphqlMock();
  const result = await scanV8HistoryWindow({
    runtime, intent: intent(), source, graphqlClient,
  });
  assert.equal(result.trustedHistoryClear, true);
  assert.equal(result.chainIdentifier, CHAIN);
  assert.equal(result.targetAdmittedCount, 0);
  assert.equal(result.targetEntitlementCount, 0);
  assert.equal(result.targetPassCount, 0);
  assert.equal(result.untrustedCreatedTelemetry.scanned, false);
  assert.equal(
    graphqlClient.calls.some(({ variables }) => variables?.type?.endsWith('::ExpansionPackCreatedV8')),
    false,
  );
});

test('trusted event and Pass JSON/type omissions fail closed', async () => {
  const admittedType = `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackAdmittedV8`;
  await assert.rejects(
    scanV8HistoryWindow({
      runtime,
      intent: intent(),
      source,
      graphqlClient: graphqlMock({
        eventNode: { contents: { type: { repr: admittedType }, json: null } },
      }),
    }),
    /missing exact Move JSON fields/,
  );
  const passType = `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackPassV8`;
  await assert.rejects(
    scanV8HistoryWindow({
      runtime,
      intent: intent(),
      source,
      graphqlClient: graphqlMock({
        passNode: {
          address: `0x${'ab'.repeat(32)}`,
          asMoveObject: { contents: { type: { repr: passType }, json: {} } },
        },
      }),
    }),
    /missing its exact parent Root or release ID/,
  );
});

test('continuation rejects a foreign chain and an anchor digest mismatch', async () => {
  await assert.rejects(
    scanV8HistoryWindow({
      runtime,
      intent: intent(),
      source,
      graphqlClient: graphqlMock({ chain: 'foreign-chain' }),
    }),
    /not bound to the reviewed Mainnet chain/,
  );
  await assert.rejects(
    scanV8HistoryWindow({
      runtime,
      intent: intent(),
      source,
      afterCheckpoint: CUTOFF.sequenceNumber,
      expectedAuditHash: 'cc'.repeat(32),
      expectedCutoff: CUTOFF,
      expectedChainIdentifier: CHAIN,
      graphqlClient: graphqlMock({
        anchor: { ...CUTOFF, digest: 'DifferentDigest' },
      }),
    }),
    /anchor.*no longer matches the reviewed chain/i,
  );
});

test('retired-cap proof requires an exact unavailable code bound to the target ID', () => {
  const expected = `0x${'dd'.repeat(32)}`;
  const other = `0x${'ee'.repeat(32)}`;
  assert.equal(unavailableObjectResult(
    { code: 'ObjectNotFound', objectId: expected },
    expected,
    { allowMessage: false, requireReportedId: true },
  ), 'objectnotfound');
  assert.equal(unavailableObjectResult(
    { code: 'ObjectNotFound' },
    expected,
    { allowMessage: false, requireReportedId: true },
  ), '');
  assert.equal(unavailableObjectResult(
    { code: 'ObjectNotFound', objectId: other },
    expected,
    { allowMessage: false, requireReportedId: true },
  ), '');
  assert.equal(unavailableObjectResult(
    new Error(`transport endpoint not found for ${expected}`),
    expected,
    { allowMessage: false, requireReportedId: true },
  ), '');
});

test('atomic-finalizer signing requires the current intent to retain a nonzero TypeOrigin', () => {
  assert.equal(requireIndependentExtensionTypeOrigin(intent()), INDEPENDENT_ORIGIN);
  const missing = intent();
  delete missing.protocol.independentExtensionV5TypeOriginPackageId;
  assert.throws(
    () => requireIndependentExtensionTypeOrigin(missing),
    /must be populated before atomic finalization/,
  );
  const zero = intent();
  zero.protocol.independentExtensionV5TypeOriginPackageId = '0x0';
  assert.throws(
    () => requireIndependentExtensionTypeOrigin(zero),
    /must be populated before atomic finalization/,
  );
});

test('maker evidence uses the stable v6/v8 origin, never the Commerce core origin', () => {
  assert.equal(requireMakerReleaseEvidenceTypeOrigin(intent(), deployment()), TYPE_ORIGIN);
  const wrong = intent();
  wrong.protocol.typeOriginPackageId = wrong.protocol.commerceV5TypeOriginPackageId;
  assert.throws(
    () => requireMakerReleaseEvidenceTypeOrigin(wrong, deployment()),
    /stable v6\/v8 origin|must not use the Commerce v5 core TypeOrigin/,
  );
});

test('stage priors require exact schema, stage, success and PAUSED FREE zero readback', () => {
  assert.doesNotThrow(() => validateParentStagePrior(
    'evidence', priorResult('policy'), intent(), deployment(),
  ));
  for (const mutate of [
    (value) => { value.schemaVersion = 'fake'; },
    (value) => { value.stage = 'evidence'; },
    (value) => { value.finalized.effects.status.success = false; },
    (value) => { value.postState.root.lifecycle = 2; },
    (value) => { value.postState.root.basePolicy.priceAtomic = '1'; },
    (value) => { value.postState.root.styleRegistrySealed = true; },
  ]) {
    const fake = priorResult('policy');
    mutate(fake);
    assert.throws(() => validateParentStagePrior('evidence', fake, intent(), deployment()));
  }
});

test('finalize prior requires stable-origin event tuple and exact bound dynamic field', () => {
  assert.doesNotThrow(() => validateParentStagePrior(
    'finalize', evidencePrior(), intent(), deployment(),
  ));
  const commerceEvent = evidencePrior();
  commerceEvent.finalized.events[0].eventType =
    `${intent().protocol.commerceV5TypeOriginPackageId}::commerce_v5::MakerReleaseEvidenceBoundV5`;
  assert.throws(
    () => validateParentStagePrior('finalize', commerceEvent, intent(), deployment()),
    /stable-origin MakerReleaseEvidenceBoundV5/,
  );
  const wrongTuple = evidencePrior();
  wrongTuple.finalized.events[0].json.manifest_blob_id = 'forged';
  assert.throws(
    () => validateParentStagePrior('finalize', wrongTuple, intent(), deployment()),
    /event tuple drifted/,
  );
  const noBoundField = evidencePrior();
  delete noBoundField.postState.releaseEvidence;
  assert.throws(
    () => validateParentStagePrior('finalize', noBoundField, intent(), deployment()),
    /exact bound Root evidence dynamic field/,
  );
});

test('finalizer identities fail closed on missing or mismatched v7 origins', () => {
  const current = intent();
  current.protocol.callablePackageId = INDEPENDENT_ORIGIN;
  current.protocol.commerceV5CallablePackageId = INDEPENDENT_ORIGIN;
  assert.deepEqual(requireFinalizerProtocolIdentities(current, {
    releases: { expansionPackV8: { callablePackageId: INDEPENDENT_ORIGIN } },
  }), {
    callablePackageId: INDEPENDENT_ORIGIN,
    independentExtensionV5TypeOriginPackageId: INDEPENDENT_ORIGIN,
    legacyLogicalV5TypeOriginPackageId: INDEPENDENT_ORIGIN,
  });
  for (const key of [
    'independentExtensionV5TypeOriginPackageId',
    'legacyLogicalV5TypeOriginPackageId',
  ]) {
    const missing = structuredClone(current);
    delete missing.protocol[key];
    assert.throws(
      () => requireFinalizerProtocolIdentities(missing, deployment()),
      /TypeOrigin|exact Sui ID/,
    );
  }
  const mismatch = structuredClone(current);
  mismatch.protocol.legacyLogicalV5TypeOriginPackageId = TYPE_ORIGIN;
  assert.throws(
    () => requireFinalizerProtocolIdentities(mismatch, {
      releases: { expansionPackV8: { callablePackageId: INDEPENDENT_ORIGIN } },
    }),
    /does not match the reviewed callable\/deployment package proof/,
  );
  const splitCallable = structuredClone(current);
  splitCallable.protocol.commerceV5CallablePackageId = TYPE_ORIGIN;
  assert.throws(
    () => requireFinalizerProtocolIdentities(splitCallable, {
      releases: { expansionPackV8: { callablePackageId: INDEPENDENT_ORIGIN } },
    }),
    /callable identities drifted/,
  );
});
