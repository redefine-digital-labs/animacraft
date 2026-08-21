import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKER_V8_CLOCK_OBJECT_ID,
  MAKER_V8_ISSUE_LAYERS,
  MAKER_V8_LEGACY_FIELDS,
  MAKER_V8_MAKER_BINDING_FIELDS,
  MAKER_V8_PAYMENT_COIN_TYPE,
  MAKER_V8_ROLE_CONFIG_ROLES,
  MAKER_V8_ROLE_MODULES,
  MAKER_V8_ROLES,
  MAKER_V8_RUNTIME_SCHEMA,
  MAKER_V8_VERSION,
  MakerV8RuntimeError,
  assertMakerV8Runtime,
  inspectMakerV8Runtime,
  makerV8CallableTarget,
  makerV8StableType,
} from '../maker-v8-runtime.js';

function id(value) {
  return `0x${Number(value).toString(16).padStart(64, '0')}`;
}

function makerBinding(start = 400) {
  return Object.fromEntries(
    MAKER_V8_MAKER_BINDING_FIELDS.map((field, index) => [field, id(start + index)]),
  );
}

function runtime({ enabled = true, makerBindings } = {}) {
  const roles = Object.fromEntries(
    MAKER_V8_ROLES.map((role, index) => {
      const packageId = id(100 + index);
      return [role, {
        typeOriginPackageId: packageId,
        callablePackageId: packageId,
      }];
    }),
  );
  const value = {
    schemaVersion: MAKER_V8_RUNTIME_SCHEMA,
    protocolVersion: MAKER_V8_VERSION,
    enabled,
    catalogId: id(300),
    protocolConfigId: id(301),
    protocolTreasuryId: id(302),
    paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
    clockObjectId: MAKER_V8_CLOCK_OBJECT_ID,
    roles,
    roleConfigIds: Object.fromEntries(
      MAKER_V8_ROLE_CONFIG_ROLES.map((role, index) => [role, id(200 + index)]),
    ),
  };
  if (makerBindings !== undefined) value.makerBindings = makerBindings;
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function hasIssue(inspected, code, field) {
  return inspected.issues.some((entry) => (
    entry.code === code && (field === undefined || entry.field === field)
  ));
}

test('accepts only the exact seven-package v8 schema and returns an immutable normalized tuple', () => {
  const candidate = runtime();
  candidate.catalogId = candidate.catalogId.toUpperCase().replace('0X', '0x');
  candidate.paymentCoinType = candidate.paymentCoinType.replace(
    candidate.paymentCoinType.slice(2, 66),
    candidate.paymentCoinType.slice(2, 66).toUpperCase(),
  );

  const inspected = inspectMakerV8Runtime(candidate, { requireEnabled: true });
  assert.equal(inspected.valid, true);
  assert.equal(inspected.enabled, true);
  assert.equal(inspected.runtime.catalogId, id(300));
  assert.equal(inspected.runtime.paymentCoinType, MAKER_V8_PAYMENT_COIN_TYPE);
  assert.deepEqual(Object.keys(inspected.runtime), [
    'schemaVersion',
    'protocolVersion',
    'enabled',
    'catalogId',
    'protocolConfigId',
    'protocolTreasuryId',
    'paymentCoinType',
    'clockObjectId',
    'roles',
    'roleConfigIds',
    'makerBindings',
  ]);
  assert.deepEqual(inspected.runtime.makerBindings, []);
  assert.equal(Object.isFrozen(inspected), true);
  assert.equal(Object.isFrozen(inspected.runtime), true);
  assert.equal(Object.isFrozen(inspected.runtime.roles), true);
  assert.equal(Object.isFrozen(inspected.runtime.roles.core), true);
  assert.equal(Object.isFrozen(inspected.runtime.roleConfigIds), true);
  assert.equal(Object.isFrozen(inspected.runtime.makerBindings), true);
  assert.equal(Object.isFrozen(inspected.issuesByLayer), true);
  for (const layer of MAKER_V8_ISSUE_LAYERS) {
    assert.equal(Object.isFrozen(inspected.issuesByLayer[layer]), true, layer);
  }
});

test('stable types use each role TypeOrigin while callable targets use that role callable package', () => {
  const checked = assertMakerV8Runtime(runtime());
  const cases = [
    ['core', 'maker_v8', 'MakerRootV8'],
    ['seal', 'seal_v8', 'SealRegistryV8'],
    ['runtime', 'runtime_v8', 'RuntimeDefinitionRegistryV8'],
    ['output', 'output_v8', 'SoulRegistryV8'],
    ['physical', 'physical_v8', 'PhysicalRegistryV8'],
    ['market', 'market_v8', 'MarketRegistryV8'],
    ['release', 'release_v8', 'MakerV8Activated'],
  ];
  for (const [role, moduleName, typeName] of cases) {
    assert.equal(
      makerV8StableType(checked, role, moduleName, typeName),
      `${checked.roles[role].typeOriginPackageId}::${moduleName}::${typeName}`,
      role,
    );
    assert.equal(
      makerV8CallableTarget(checked, role, moduleName, 'version_v8'),
      `${checked.roles[role].callablePackageId}::${moduleName}::version_v8`,
      role,
    );
  }
  assert.equal(Object.isFrozen(MAKER_V8_ROLE_MODULES), true);
  assert.equal(Object.isFrozen(MAKER_V8_ROLE_MODULES.core), true);
});

test('allows upgraded callables only after live TypeOrigin lineage verification', () => {
  const candidate = runtime();
  candidate.roles.runtime.callablePackageId = id(510);

  const unverified = inspectMakerV8Runtime(candidate);
  assert.equal(unverified.valid, false);
  assert.equal(hasIssue(
    unverified,
    'MAKER_V8_ROLE_LINEAGE_UNVERIFIED',
    'roles.runtime.callablePackageId',
  ), true);

  const checked = assertMakerV8Runtime(candidate, {
    resolveTypeOriginPackageId(role, callablePackageId) {
      assert.equal(role, 'runtime');
      assert.equal(callablePackageId, id(510));
      return candidate.roles.runtime.typeOriginPackageId;
    },
  });
  assert.notEqual(
    checked.roles.runtime.typeOriginPackageId,
    checked.roles.runtime.callablePackageId,
  );
  assert.equal(assertMakerV8Runtime(checked), checked);
  assert.equal(
    makerV8StableType(checked, 'runtime', 'runtime_v8', 'MakerLoadoutV8'),
    `${id(102)}::runtime_v8::MakerLoadoutV8`,
  );
  assert.equal(
    makerV8CallableTarget(checked, 'runtime', 'runtime_v8', 'new_runtime_definition_registry_v8'),
    `${id(510)}::runtime_v8::new_runtime_definition_registry_v8`,
  );
});

test('rejects mismatched, malformed, asynchronous, or failed upgrade lineage readback', () => {
  const candidate = runtime();
  candidate.roles.release.callablePackageId = id(511);
  const cases = [
    {
      expected: 'MAKER_V8_ROLE_LINEAGE_MISMATCH',
      resolver: () => id(999),
    },
    {
      expected: 'MAKER_V8_ROLE_LINEAGE_INVALID',
      resolver: () => '0x1',
    },
    {
      expected: 'MAKER_V8_ROLE_LINEAGE_INVALID',
      resolver: async () => candidate.roles.release.typeOriginPackageId,
    },
    {
      expected: 'MAKER_V8_ROLE_LINEAGE_INVALID',
      resolver: () => { throw new Error('RPC failed'); },
    },
  ];
  for (const { expected, resolver } of cases) {
    const inspected = inspectMakerV8Runtime(candidate, {
      resolveTypeOriginPackageId: resolver,
    });
    assert.equal(hasIssue(inspected, expected), true, expected);
  }
});

test('requires every top-level identity, role, role identity, and companion config', () => {
  const cases = [
    ['catalogId', (candidate) => { delete candidate.catalogId; }],
    ['roles.market', (candidate) => { delete candidate.roles.market; }],
    [
      'roles.seal.typeOriginPackageId',
      (candidate) => { delete candidate.roles.seal.typeOriginPackageId; },
    ],
    ['roleConfigIds.output', (candidate) => { delete candidate.roleConfigIds.output; }],
  ];
  for (const [field, mutate] of cases) {
    const candidate = runtime();
    mutate(candidate);
    const inspected = inspectMakerV8Runtime(candidate);
    assert.equal(inspected.valid, false, field);
    assert.equal(hasIssue(inspected, 'MAKER_V8_FIELD_MISSING', field), true, field);
  }
});

test('rejects zero, short, non-string, and malformed identities at every layer', () => {
  const cases = [
    ['catalogId', (candidate) => { candidate.catalogId = id(0); }],
    ['protocolTreasuryId', (candidate) => { candidate.protocolTreasuryId = '0x12'; }],
    [
      'roles.core.typeOriginPackageId',
      (candidate) => { candidate.roles.core.typeOriginPackageId = 100; },
    ],
    [
      'roles.physical.callablePackageId',
      (candidate) => { candidate.roles.physical.callablePackageId = id(0); },
    ],
    ['roleConfigIds.market', (candidate) => { candidate.roleConfigIds.market = null; }],
  ];
  for (const [field, mutate] of cases) {
    const candidate = runtime();
    mutate(candidate);
    const inspected = inspectMakerV8Runtime(candidate);
    assert.equal(hasIssue(inspected, 'MAKER_V8_ID_INVALID', field), true, field);
  }
});

test('enforces native Mainnet USDC and the canonical Sui Clock object exactly', () => {
  const wrongCoin = runtime();
  wrongCoin.paymentCoinType = `${id(700)}::coin::COIN`;
  let inspected = inspectMakerV8Runtime(wrongCoin);
  assert.equal(hasIssue(inspected, 'MAKER_V8_PAYMENT_COIN_TYPE_MISMATCH'), true);

  const malformedCoin = runtime();
  malformedCoin.paymentCoinType = 'USDC';
  inspected = inspectMakerV8Runtime(malformedCoin);
  assert.equal(hasIssue(inspected, 'MAKER_V8_PAYMENT_COIN_TYPE_INVALID'), true);

  const shortClock = runtime();
  shortClock.clockObjectId = '0x6';
  inspected = inspectMakerV8Runtime(shortClock);
  assert.equal(hasIssue(inspected, 'MAKER_V8_ID_INVALID', 'clockObjectId'), true);

  const wrongClock = runtime();
  wrongClock.clockObjectId = id(701);
  inspected = inspectMakerV8Runtime(wrongClock);
  assert.equal(hasIssue(inspected, 'MAKER_V8_CLOCK_MISMATCH'), true);
});

test('allows original == callable only within one role and rejects all cross-role collisions', () => {
  assert.equal(inspectMakerV8Runtime(runtime()).valid, true);

  const sameColumns = runtime();
  sameColumns.roles.seal.typeOriginPackageId = sameColumns.roles.core.typeOriginPackageId;
  sameColumns.roles.seal.callablePackageId = sameColumns.roles.core.callablePackageId;
  assert.equal(hasIssue(
    inspectMakerV8Runtime(sameColumns),
    'MAKER_V8_ROLE_IDENTITY_COLLISION',
  ), true);

  const crossColumns = runtime();
  crossColumns.roles.runtime.callablePackageId = crossColumns.roles.output.typeOriginPackageId;
  const inspected = inspectMakerV8Runtime(crossColumns, {
    resolveTypeOriginPackageId: () => crossColumns.roles.runtime.typeOriginPackageId,
  });
  assert.equal(hasIssue(
    inspected,
    'MAKER_V8_ROLE_IDENTITY_COLLISION',
    'roles.output.typeOriginPackageId',
  ), true);
});

test('rejects collisions among catalog, protocol, role configs, and Maker object bindings', () => {
  const globalCollision = runtime();
  globalCollision.roleConfigIds.seal = globalCollision.protocolConfigId;
  assert.equal(hasIssue(
    inspectMakerV8Runtime(globalCollision),
    'MAKER_V8_OBJECT_ID_COLLISION',
    'roleConfigIds.seal',
  ), true);

  const bindingCollision = runtime({ makerBindings: [makerBinding()] });
  bindingCollision.makerBindings[0].marketTreasuryId =
    bindingCollision.makerBindings[0].marketRegistryId;
  assert.equal(hasIssue(
    inspectMakerV8Runtime(bindingCollision),
    'MAKER_V8_OBJECT_ID_COLLISION',
    'makerBindings[0].marketTreasuryId',
  ), true);

  const duplicateRoots = runtime({
    makerBindings: [makerBinding(400), makerBinding(500)],
  });
  duplicateRoots.makerBindings[1].rootId = duplicateRoots.makerBindings[0].rootId;
  assert.equal(hasIssue(
    inspectMakerV8Runtime(duplicateRoots),
    'MAKER_V8_OBJECT_ID_COLLISION',
    'makerBindings[1].rootId',
  ), true);
});

test('accepts optional complete per-Maker binding records and freezes every ID', () => {
  const candidate = runtime({ makerBindings: [makerBinding()] });
  const inspected = inspectMakerV8Runtime(candidate, { requireEnabled: true });
  assert.equal(inspected.valid, true);
  assert.deepEqual(
    Object.keys(inspected.runtime.makerBindings[0]),
    MAKER_V8_MAKER_BINDING_FIELDS,
  );
  assert.equal(Object.isFrozen(inspected.runtime.makerBindings[0]), true);
  assert.equal(
    inspected.runtime.makerBindings[0].packAdmissionAuthorityId,
    id(406),
  );
});

test('Maker binding records fail closed when partial, malformed, or extended', () => {
  for (const field of MAKER_V8_MAKER_BINDING_FIELDS) {
    const binding = makerBinding();
    delete binding[field];
    const inspected = inspectMakerV8Runtime(runtime({ makerBindings: [binding] }));
    assert.equal(hasIssue(
      inspected,
      'MAKER_V8_FIELD_MISSING',
      `makerBindings[0].${field}`,
    ), true, field);
  }

  const malformed = makerBinding();
  malformed.soulRegistryId = id(0);
  assert.equal(hasIssue(
    inspectMakerV8Runtime(runtime({ makerBindings: [malformed] })),
    'MAKER_V8_ID_INVALID',
    'makerBindings[0].soulRegistryId',
  ), true);

  const extended = makerBinding();
  extended.catalogId = id(900);
  assert.equal(hasIssue(
    inspectMakerV8Runtime(runtime({ makerBindings: [extended] })),
    'MAKER_V8_UNKNOWN_FIELD',
    'makerBindings[0].catalogId',
  ), true);

  assert.equal(hasIssue(
    inspectMakerV8Runtime({ ...runtime(), makerBindings: {} }),
    'MAKER_V8_MAKER_BINDINGS_INVALID',
  ), true);
});

test('rejects unknown fields at the root and every nested allowlist boundary', () => {
  const cases = [
    ['debug', (candidate) => { candidate.debug = true; }],
    ['roles.core.debug', (candidate) => { candidate.roles.core.debug = true; }],
    ['roles.commerce', (candidate) => { candidate.roles.commerce = {}; }],
    ['roleConfigIds.core', (candidate) => { candidate.roleConfigIds.core = id(800); }],
  ];
  for (const [field, mutate] of cases) {
    const candidate = runtime();
    mutate(candidate);
    const inspected = inspectMakerV8Runtime(candidate);
    assert.equal(hasIssue(inspected, 'MAKER_V8_UNKNOWN_FIELD', field), true, field);
  }
});

test('detects and rejects every retired flat, gate, single-package, and v4-v7 field', () => {
  for (const field of MAKER_V8_LEGACY_FIELDS) {
    const candidate = runtime();
    candidate[field] = field.toLowerCase().includes('enabled') ? false : '';
    const inspected = inspectMakerV8Runtime(candidate);
    assert.equal(hasIssue(
      inspected,
      'MAKER_V8_LEGACY_FIELD_FORBIDDEN',
      field,
    ), true, field);
  }

  for (const field of ['makerV7Runtime', 'legacyRuntime', 'compatibilityGate']) {
    const candidate = runtime();
    candidate[field] = false;
    assert.equal(hasIssue(
      inspectMakerV8Runtime(candidate),
      'MAKER_V8_LEGACY_FIELD_FORBIDDEN',
      field,
    ), true, field);
  }
});

test('requires the exact schema, public protocol version, and boolean fresh-only gate', () => {
  const candidate = runtime();
  candidate.schemaVersion = 'animacraft.maker-v8-runtime.v7';
  candidate.protocolVersion = 7;
  candidate.enabled = 'true';
  const inspected = inspectMakerV8Runtime(candidate);
  assert.equal(hasIssue(inspected, 'MAKER_V8_SCHEMA_INVALID'), true);
  assert.equal(hasIssue(inspected, 'MAKER_V8_PROTOCOL_VERSION_INVALID'), true);
  assert.equal(hasIssue(inspected, 'MAKER_V8_ENABLED_INVALID'), true);
});

test('disabled fixtures remain schema-valid but strict assertions and use helpers reject them', () => {
  const disabled = runtime({ enabled: false });
  assert.equal(inspectMakerV8Runtime(disabled).valid, true);
  assert.equal(hasIssue(
    inspectMakerV8Runtime(disabled, { requireEnabled: true }),
    'MAKER_V8_DISABLED',
  ), true);
  assert.throws(() => assertMakerV8Runtime(disabled), MakerV8RuntimeError);
  const checkedFixture = assertMakerV8Runtime(disabled, { requireEnabled: false });
  assert.equal(checkedFixture.enabled, false);
  assert.throws(
    () => makerV8StableType(checkedFixture, 'core', 'maker_v8', 'MakerRootV8'),
    MakerV8RuntimeError,
  );
  assert.throws(
    () => makerV8CallableTarget(
      checkedFixture,
      'release',
      'release_v8',
      'version_v8',
      { requireEnabled: false },
    ),
    MakerV8RuntimeError,
  );

  const partial = runtime({ enabled: false });
  delete partial.catalogId;
  assert.equal(inspectMakerV8Runtime(partial).valid, false);
});

test('inspection options are exact and old fresh-equality policy options are rejected', () => {
  let inspected = inspectMakerV8Runtime(runtime(), { requireFreshTypeOrigin: true });
  assert.equal(hasIssue(
    inspected,
    'MAKER_V8_UNKNOWN_FIELD',
    'options.requireFreshTypeOrigin',
  ), true);

  inspected = inspectMakerV8Runtime(runtime(), { requireEnabled: 'yes' });
  assert.equal(hasIssue(inspected, 'MAKER_V8_OPTION_INVALID'), true);

  inspected = inspectMakerV8Runtime(runtime(), { resolveTypeOriginPackageId: true });
  assert.equal(hasIssue(inspected, 'MAKER_V8_OPTION_INVALID'), true);
});

test('issues and assertion errors preserve immutable diagnostic layers', () => {
  const candidate = runtime({ makerBindings: [makerBinding()] });
  candidate.schemaVersion = 'wrong';
  candidate.paymentCoinType = `${id(710)}::coin::COIN`;
  candidate.roles.market.callablePackageId = id(711);
  candidate.makerBindings[0].physicalRegistryId = id(0);

  const inspected = inspectMakerV8Runtime(candidate);
  assert.ok(inspected.issuesByLayer.schema.length > 0);
  assert.ok(inspected.issuesByLayer.identity.length > 0);
  assert.ok(inspected.issuesByLayer.lineage.length > 0);
  assert.ok(inspected.issuesByLayer.binding.length > 0);

  assert.throws(
    () => assertMakerV8Runtime(candidate),
    (error) => {
      assert.equal(error instanceof MakerV8RuntimeError, true);
      assert.equal(typeof error.code, 'string');
      assert.equal(typeof error.layer, 'string');
      assert.equal(Object.isFrozen(error.issues), true);
      assert.equal(Object.isFrozen(error.issuesByLayer), true);
      assert.ok(error.issuesByLayer.lineage.length > 0);
      assert.match(error.message, /schemaVersion/);
      return true;
    },
  );
});

test('role-aware helpers reject unknown roles, cross-role modules, and malformed names', () => {
  const checked = assertMakerV8Runtime(runtime());
  assert.throws(
    () => makerV8StableType(checked, 'commerce', 'market_v8', 'MarketRegistryV8'),
    /Unknown Maker v8 package role/,
  );
  assert.throws(
    () => makerV8StableType(checked, 'core', 'seal_v8', 'SealRegistryV8'),
    /not an allowlisted module/,
  );
  assert.throws(
    () => makerV8StableType(checked, 'core', 'maker_v8', 'makerRootV8'),
    /type name is invalid/,
  );
  assert.throws(
    () => makerV8CallableTarget(checked, 'release', 'release_v8', 'MakerV8Activated'),
    /function name is invalid/,
  );
  assert.throws(
    () => makerV8StableType({}, 'core', 'maker_v8', 'MakerRootV8'),
    MakerV8RuntimeError,
  );
});

test('input objects are never mutated while normalization canonicalizes IDs', () => {
  const candidate = runtime();
  const before = clone(candidate);
  const inspected = inspectMakerV8Runtime(candidate);
  assert.equal(inspected.valid, true);
  assert.deepEqual(candidate, before);
  assert.notEqual(inspected.runtime, candidate);
  assert.notEqual(inspected.runtime.roles, candidate.roles);
  assert.notEqual(inspected.runtime.roleConfigIds, candidate.roleConfigIds);
});
