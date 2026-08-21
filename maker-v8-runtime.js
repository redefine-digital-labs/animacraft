const EXACT_SUI_ID = /^0x[0-9a-fA-F]{64}$/;
const EXACT_SUI_TYPE = /^0x([0-9a-fA-F]{64})::([A-Za-z_][A-Za-z0-9_]*)::([A-Za-z_][A-Za-z0-9_]*)$/;
const MOVE_MODULE = /^[a-z_][a-z0-9_]*$/;
const MOVE_TYPE = /^[A-Z][A-Za-z0-9_]*$/;
const MOVE_FUNCTION = /^[a-z_][a-z0-9_]*$/;
const ZERO_SUI_ID = `0x${'0'.repeat(64)}`;

export const MAKER_V8_VERSION = 8;
export const MAKER_V8_RUNTIME_SCHEMA = 'animacraft.maker-v8-runtime.v8';
export const MAKER_V8_PAYMENT_COIN_TYPE =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
export const MAKER_V8_CLOCK_OBJECT_ID = `0x${'0'.repeat(63)}6`;

export const MAKER_V8_ROLES = Object.freeze([
  'core',
  'seal',
  'runtime',
  'output',
  'physical',
  'market',
  'release',
]);

export const MAKER_V8_ROLE_CONFIG_ROLES = Object.freeze([
  'seal',
  'runtime',
  'output',
  'physical',
  'market',
  'release',
]);

export const MAKER_V8_MAKER_BINDING_FIELDS = Object.freeze([
  'rootId',
  'baseRegistryId',
  'makerTreasuryId',
  'sealRegistryId',
  'runtimeDefinitionRegistryId',
  'packRegistryId',
  'packAdmissionAuthorityId',
  'outputRegistryId',
  'soulRegistryId',
  'physicalRegistryId',
  'marketRegistryId',
  'marketTreasuryId',
]);

export const MAKER_V8_LEGACY_FIELDS = Object.freeze([
  'makerV8ReleaseEnabled',
  'makerV8PackageId',
  'makerV8CallablePackageId',
  'makerV8TypeOriginPackageId',
  'makerV8ProtocolConfigId',
  'makerV8ProtocolTreasuryId',
  'makerV8PaymentCoinType',
  'makerV8ClockId',
  'makerV8CatalogId',
  'makerV8ProductReleaseCatalogId',
  'makerV8SealPackageId',
  'makerV8SoulProofType',
  'makerV8PhysicalCallablePackageId',
  'makerV8PhysicalTypeOriginPackageId',
  'packageId',
  'callablePackageId',
  'originalPackageId',
  'releaseEnabled',
  'canonicalSoulMintEnabled',
]);

export const MAKER_V8_ISSUE_LAYERS = Object.freeze([
  'shape',
  'schema',
  'identity',
  'lineage',
  'binding',
  'activation',
]);

export const MAKER_V8_ROLE_MODULES = deepFreeze({
  core: [
    'activation_v8',
    'base_registry_v8',
    'core_v8',
    'maker_v8',
    'package_binding_v8',
    'protocol_config_v8',
    'treasury_v8',
  ],
  seal: ['seal_v8'],
  runtime: ['runtime_binding_v8', 'runtime_seal_v8', 'runtime_v8'],
  output: ['output_v8'],
  physical: ['physical_v8'],
  market: ['market_v8'],
  release: ['release_v8'],
});

const TOP_LEVEL_FIELDS = Object.freeze([
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
const REQUIRED_TOP_LEVEL_FIELDS = TOP_LEVEL_FIELDS.filter((field) => field !== 'makerBindings');
const ROLE_FIELDS = Object.freeze(['typeOriginPackageId', 'callablePackageId']);
const OPTION_FIELDS = Object.freeze(['requireEnabled', 'resolveTypeOriginPackageId']);
const LEGACY_FIELD_SET = new Set(MAKER_V8_LEGACY_FIELDS);
const VALIDATED_RUNTIMES = new WeakSet();

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function issue(layer, code, field, message) {
  return Object.freeze({ layer, code, field, message });
}

function hasOwn(record, field) {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isLegacyField(field) {
  return LEGACY_FIELD_SET.has(field)
    || /^makerV8/i.test(field)
    || /releaseenabled$/i.test(field)
    || /legacy/i.test(field)
    || /gate/i.test(field)
    || /packageid$/i.test(field);
}

function inspectRecordShape(
  value,
  path,
  allowedFields,
  requiredFields,
  issues,
) {
  if (!isPlainRecord(value)) {
    issues.push(issue(
      'shape',
      'MAKER_V8_RECORD_REQUIRED',
      path,
      `${path || 'runtime'} must be a plain object with an exact allowlisted shape.`,
    ));
    return false;
  }

  const allowed = new Set(allowedFields);
  for (const field of Object.keys(value)) {
    if (allowed.has(field)) continue;
    const legacy = isLegacyField(field);
    issues.push(issue(
      'shape',
      legacy ? 'MAKER_V8_LEGACY_FIELD_FORBIDDEN' : 'MAKER_V8_UNKNOWN_FIELD',
      path ? `${path}.${field}` : field,
      legacy
        ? `${field} is a retired gate, alias, or single-package field and must not appear in the fresh v8 contract.`
        : `${field} is not allowed by the fresh v8 runtime schema.`,
    ));
  }
  for (const symbol of Object.getOwnPropertySymbols(value)) {
    issues.push(issue(
      'shape',
      'MAKER_V8_UNKNOWN_FIELD',
      path || '$',
      `Symbol field ${String(symbol)} is not allowed by the fresh v8 runtime schema.`,
    ));
  }
  for (const field of requiredFields) {
    if (!hasOwn(value, field)) {
      issues.push(issue(
        'shape',
        'MAKER_V8_FIELD_MISSING',
        path ? `${path}.${field}` : field,
        `${field} is required by the fresh v8 runtime schema.`,
      ));
    }
  }
  return true;
}

function normalizeSuiId(value) {
  if (typeof value !== 'string' || !EXACT_SUI_ID.test(value)) return '';
  const normalized = value.toLowerCase();
  return normalized === ZERO_SUI_ID ? '' : normalized;
}

function inspectId(record, field, path, issues, layer = 'identity') {
  if (!isPlainRecord(record) || !hasOwn(record, field)) return '';
  const normalized = normalizeSuiId(record[field]);
  if (!normalized) {
    issues.push(issue(
      layer,
      'MAKER_V8_ID_INVALID',
      path,
      `${path} must be an exact 32-byte, non-zero Sui ID.`,
    ));
  }
  return normalized;
}

function normalizeSuiType(value) {
  if (typeof value !== 'string') return '';
  const match = EXACT_SUI_TYPE.exec(value);
  if (!match) return '';
  return `0x${match[1].toLowerCase()}::${match[2]}::${match[3]}`;
}

function inspectOptions(value, issues) {
  if (value === undefined) {
    return { requireEnabled: false, resolveTypeOriginPackageId: null };
  }
  if (!isPlainRecord(value)) {
    issues.push(issue(
      'shape',
      'MAKER_V8_OPTIONS_INVALID',
      'options',
      'Maker v8 inspection options must be a plain object.',
    ));
    return { requireEnabled: false, resolveTypeOriginPackageId: null };
  }
  inspectRecordShape(value, 'options', OPTION_FIELDS, [], issues);
  let requireEnabled = false;
  if (hasOwn(value, 'requireEnabled')) {
    if (typeof value.requireEnabled !== 'boolean') {
      issues.push(issue(
        'shape',
        'MAKER_V8_OPTION_INVALID',
        'options.requireEnabled',
        'requireEnabled must be a boolean.',
      ));
    } else {
      requireEnabled = value.requireEnabled;
    }
  }
  let resolveTypeOriginPackageId = null;
  if (hasOwn(value, 'resolveTypeOriginPackageId')) {
    if (typeof value.resolveTypeOriginPackageId !== 'function') {
      issues.push(issue(
        'shape',
        'MAKER_V8_OPTION_INVALID',
        'options.resolveTypeOriginPackageId',
        'resolveTypeOriginPackageId must be a synchronous function.',
      ));
    } else {
      resolveTypeOriginPackageId = value.resolveTypeOriginPackageId;
    }
  }
  return { requireEnabled, resolveTypeOriginPackageId };
}

function inspectRoleIdentities(source, issues, resolveTypeOriginPackageId) {
  const normalized = {};
  const rolesShapeValid = inspectRecordShape(
    source,
    'roles',
    MAKER_V8_ROLES,
    MAKER_V8_ROLES,
    issues,
  );

  for (const role of MAKER_V8_ROLES) {
    const record = rolesShapeValid && hasOwn(source, role) ? source[role] : undefined;
    const recordValid = inspectRecordShape(
      record,
      `roles.${role}`,
      ROLE_FIELDS,
      ROLE_FIELDS,
      issues,
    );
    const typeOriginPackageId = recordValid
      ? inspectId(
        record,
        'typeOriginPackageId',
        `roles.${role}.typeOriginPackageId`,
        issues,
      )
      : '';
    const callablePackageId = recordValid
      ? inspectId(
        record,
        'callablePackageId',
        `roles.${role}.callablePackageId`,
        issues,
      )
      : '';
    normalized[role] = { typeOriginPackageId, callablePackageId };

    if (
      typeOriginPackageId
      && callablePackageId
      && typeOriginPackageId !== callablePackageId
    ) {
      if (!resolveTypeOriginPackageId) {
        issues.push(issue(
          'lineage',
          'MAKER_V8_ROLE_LINEAGE_UNVERIFIED',
          `roles.${role}.callablePackageId`,
          `${role} uses an upgraded callable package, so its live TypeOrigin must be resolved and verified.`,
        ));
      } else {
        let resolved = '';
        try {
          resolved = normalizeSuiId(resolveTypeOriginPackageId(role, callablePackageId));
        } catch {
          // Resolver failures are fail-closed and reported below.
        }
        if (!resolved) {
          issues.push(issue(
            'lineage',
            'MAKER_V8_ROLE_LINEAGE_INVALID',
            `roles.${role}.callablePackageId`,
            `The ${role} callable package TypeOrigin resolver did not return an exact non-zero Sui ID.`,
          ));
        } else if (resolved !== typeOriginPackageId) {
          issues.push(issue(
            'lineage',
            'MAKER_V8_ROLE_LINEAGE_MISMATCH',
            `roles.${role}.callablePackageId`,
            `The ${role} callable package does not resolve to its configured stable TypeOrigin.`,
          ));
        }
      }
    }
  }

  const seen = new Map();
  for (const role of MAKER_V8_ROLES) {
    for (const column of ['typeOriginPackageId', 'callablePackageId']) {
      const id = normalized[role][column];
      if (!id) continue;
      const prior = seen.get(id);
      if (prior && prior.role !== role) {
        issues.push(issue(
          'identity',
          'MAKER_V8_ROLE_IDENTITY_COLLISION',
          `roles.${role}.${column}`,
          `${role}.${column} collides with ${prior.role}.${prior.column}; all seven role identities must be pairwise disjoint across both ID columns.`,
        ));
      } else if (!prior) {
        seen.set(id, { role, column });
      }
    }
  }

  return normalized;
}

function inspectRoleConfigIds(source, issues) {
  const normalized = {};
  const valid = inspectRecordShape(
    source,
    'roleConfigIds',
    MAKER_V8_ROLE_CONFIG_ROLES,
    MAKER_V8_ROLE_CONFIG_ROLES,
    issues,
  );
  for (const role of MAKER_V8_ROLE_CONFIG_ROLES) {
    normalized[role] = valid
      ? inspectId(source, role, `roleConfigIds.${role}`, issues)
      : '';
  }
  return normalized;
}

function inspectMakerBindings(source, issues) {
  if (source === undefined) return [];
  if (!Array.isArray(source)) {
    issues.push(issue(
      'shape',
      'MAKER_V8_MAKER_BINDINGS_INVALID',
      'makerBindings',
      'makerBindings must be an array of complete verified binding records.',
    ));
    return [];
  }

  const normalized = [];
  for (let index = 0; index < source.length; index += 1) {
    const record = source[index];
    const path = `makerBindings[${index}]`;
    const valid = inspectRecordShape(
      record,
      path,
      MAKER_V8_MAKER_BINDING_FIELDS,
      MAKER_V8_MAKER_BINDING_FIELDS,
      issues,
    );
    const binding = {};
    for (const field of MAKER_V8_MAKER_BINDING_FIELDS) {
      binding[field] = valid
        ? inspectId(record, field, `${path}.${field}`, issues, 'binding')
        : '';
    }
    normalized.push(binding);
  }
  return normalized;
}

function inspectObjectIdCollisions(runtime, issues) {
  const seen = new Map();
  const observe = (id, path, layer = 'identity') => {
    if (!id) return;
    const prior = seen.get(id);
    if (prior) {
      issues.push(issue(
        layer,
        'MAKER_V8_OBJECT_ID_COLLISION',
        path,
        `${path} collides with ${prior}; distinct v8 objects cannot share an ID.`,
      ));
      return;
    }
    seen.set(id, path);
  };

  observe(runtime.catalogId, 'catalogId');
  observe(runtime.protocolConfigId, 'protocolConfigId');
  observe(runtime.protocolTreasuryId, 'protocolTreasuryId');
  observe(runtime.clockObjectId, 'clockObjectId');
  for (const role of MAKER_V8_ROLE_CONFIG_ROLES) {
    observe(runtime.roleConfigIds[role], `roleConfigIds.${role}`);
  }
  runtime.makerBindings.forEach((binding, index) => {
    for (const field of MAKER_V8_MAKER_BINDING_FIELDS) {
      observe(binding[field], `makerBindings[${index}].${field}`, 'binding');
    }
  });
}

function groupIssues(issues) {
  const grouped = Object.fromEntries(
    MAKER_V8_ISSUE_LAYERS.map((layer) => [layer, []]),
  );
  for (const entry of issues) grouped[entry.layer].push(entry);
  for (const layer of MAKER_V8_ISSUE_LAYERS) Object.freeze(grouped[layer]);
  return Object.freeze(grouped);
}

/**
 * Inspects one self-contained fresh-v8 deployment tuple. An upgraded callable
 * is accepted only when resolveTypeOriginPackageId(role, callablePackageId)
 * proves that it belongs to the configured stable TypeOrigin lineage.
 */
export function inspectMakerV8Runtime(config, options) {
  const issues = [];
  const checkedOptions = inspectOptions(options, issues);
  const source = isPlainRecord(config) ? config : {};
  inspectRecordShape(
    config,
    '',
    TOP_LEVEL_FIELDS,
    REQUIRED_TOP_LEVEL_FIELDS,
    issues,
  );

  const schemaVersion = hasOwn(source, 'schemaVersion')
    && typeof source.schemaVersion === 'string'
    ? source.schemaVersion
    : '';
  if (hasOwn(source, 'schemaVersion') && schemaVersion !== MAKER_V8_RUNTIME_SCHEMA) {
    issues.push(issue(
      'schema',
      'MAKER_V8_SCHEMA_INVALID',
      'schemaVersion',
      `schemaVersion must equal ${MAKER_V8_RUNTIME_SCHEMA}.`,
    ));
  }

  const protocolVersion = hasOwn(source, 'protocolVersion')
    && source.protocolVersion === MAKER_V8_VERSION
    ? MAKER_V8_VERSION
    : source.protocolVersion;
  if (hasOwn(source, 'protocolVersion') && source.protocolVersion !== MAKER_V8_VERSION) {
    issues.push(issue(
      'schema',
      'MAKER_V8_PROTOCOL_VERSION_INVALID',
      'protocolVersion',
      `protocolVersion must equal ${MAKER_V8_VERSION}.`,
    ));
  }

  const enabled = source.enabled === true;
  if (hasOwn(source, 'enabled') && typeof source.enabled !== 'boolean') {
    issues.push(issue(
      'schema',
      'MAKER_V8_ENABLED_INVALID',
      'enabled',
      'enabled must be an explicit boolean.',
    ));
  }
  if (checkedOptions.requireEnabled && !enabled) {
    issues.push(issue(
      'activation',
      'MAKER_V8_DISABLED',
      'enabled',
      'Fresh Maker v8 is required for this use path, but enabled is false.',
    ));
  }

  const catalogId = inspectId(source, 'catalogId', 'catalogId', issues);
  const protocolConfigId = inspectId(
    source,
    'protocolConfigId',
    'protocolConfigId',
    issues,
  );
  const protocolTreasuryId = inspectId(
    source,
    'protocolTreasuryId',
    'protocolTreasuryId',
    issues,
  );
  const clockObjectId = inspectId(source, 'clockObjectId', 'clockObjectId', issues);
  if (clockObjectId && clockObjectId !== MAKER_V8_CLOCK_OBJECT_ID) {
    issues.push(issue(
      'identity',
      'MAKER_V8_CLOCK_MISMATCH',
      'clockObjectId',
      `clockObjectId must equal Sui's canonical Clock object ${MAKER_V8_CLOCK_OBJECT_ID}.`,
    ));
  }

  const paymentCoinType = hasOwn(source, 'paymentCoinType')
    ? normalizeSuiType(source.paymentCoinType)
    : '';
  if (hasOwn(source, 'paymentCoinType') && !paymentCoinType) {
    issues.push(issue(
      'identity',
      'MAKER_V8_PAYMENT_COIN_TYPE_INVALID',
      'paymentCoinType',
      'paymentCoinType must be an exact fully qualified Sui Move type.',
    ));
  } else if (paymentCoinType && paymentCoinType !== MAKER_V8_PAYMENT_COIN_TYPE) {
    issues.push(issue(
      'identity',
      'MAKER_V8_PAYMENT_COIN_TYPE_MISMATCH',
      'paymentCoinType',
      `paymentCoinType must equal native Sui Mainnet USDC (${MAKER_V8_PAYMENT_COIN_TYPE}).`,
    ));
  }

  const roles = inspectRoleIdentities(
    source.roles,
    issues,
    checkedOptions.resolveTypeOriginPackageId,
  );
  const roleConfigIds = inspectRoleConfigIds(source.roleConfigIds, issues);
  const makerBindings = inspectMakerBindings(source.makerBindings, issues);

  const runtime = deepFreeze({
    schemaVersion,
    protocolVersion,
    enabled,
    catalogId,
    protocolConfigId,
    protocolTreasuryId,
    paymentCoinType,
    clockObjectId,
    roles,
    roleConfigIds,
    makerBindings,
  });
  inspectObjectIdCollisions(runtime, issues);

  const frozenIssues = Object.freeze(issues);
  const inspected = Object.freeze({
    valid: frozenIssues.length === 0,
    enabled,
    runtime,
    issues: frozenIssues,
    issuesByLayer: groupIssues(frozenIssues),
  });
  if (inspected.valid) VALIDATED_RUNTIMES.add(runtime);
  return inspected;
}

export class MakerV8RuntimeError extends Error {
  constructor(issues) {
    const frozenIssues = Object.freeze([...(issues || [])]);
    super(frozenIssues.map((entry) => `${entry.field}: ${entry.message}`).join('\n'));
    this.name = 'MakerV8RuntimeError';
    this.code = frozenIssues[0]?.code || 'MAKER_V8_RUNTIME_INVALID';
    this.layer = frozenIssues[0]?.layer || 'shape';
    this.issues = frozenIssues;
    this.issuesByLayer = groupIssues(frozenIssues);
  }
}

export function assertMakerV8Runtime(config, options = undefined) {
  if (VALIDATED_RUNTIMES.has(config)) {
    const noOptions = options === undefined
      || (isPlainRecord(options) && Object.keys(options).length === 0);
    const enabledRequest = isPlainRecord(options)
      && Object.keys(options).every((field) => field === 'requireEnabled')
      && typeof options.requireEnabled === 'boolean';
    if (noOptions || enabledRequest) {
      if (options?.requireEnabled === false || config.enabled === true) return config;
      throw new MakerV8RuntimeError([
        issue('activation', 'MAKER_V8_DISABLED', 'enabled', 'Fresh Maker v8 is required for this use path, but enabled is false.'),
      ]);
    }
  }
  let strictOptions = options;
  if (options === undefined) {
    strictOptions = { requireEnabled: true };
  } else if (isPlainRecord(options) && !hasOwn(options, 'requireEnabled')) {
    strictOptions = { ...options, requireEnabled: true };
  }
  const inspected = inspectMakerV8Runtime(config, strictOptions);
  if (!inspected.valid) throw new MakerV8RuntimeError(inspected.issues);
  return inspected.runtime;
}

function runtimeForUse(runtime, options) {
  if (
    VALIDATED_RUNTIMES.has(runtime)
    && runtime.enabled === true
    && options === undefined
  ) {
    return runtime;
  }
  const enabledOptions = isPlainRecord(options)
    ? { ...options, requireEnabled: true }
    : options;
  return assertMakerV8Runtime(runtime, enabledOptions);
}

function checkedRoleAndModule(runtime, role, moduleName, options) {
  const checked = runtimeForUse(runtime, options);
  if (!MAKER_V8_ROLES.includes(role)) {
    throw new TypeError(`Unknown Maker v8 package role: ${String(role)}.`);
  }
  if (!MOVE_MODULE.test(String(moduleName || ''))) {
    throw new TypeError('Maker v8 module name is invalid.');
  }
  if (!MAKER_V8_ROLE_MODULES[role].includes(moduleName)) {
    throw new TypeError(`${moduleName} is not an allowlisted module for the ${role} role.`);
  }
  return { checked, packageRole: checked.roles[role] };
}

export function makerV8StableType(
  runtime,
  role,
  moduleName,
  typeName,
  options,
) {
  const { packageRole } = checkedRoleAndModule(runtime, role, moduleName, options);
  if (!MOVE_TYPE.test(String(typeName || ''))) {
    throw new TypeError('Maker v8 type name is invalid.');
  }
  return `${packageRole.typeOriginPackageId}::${moduleName}::${typeName}`;
}

export function makerV8CallableTarget(
  runtime,
  role,
  moduleName,
  functionName,
  options,
) {
  const { packageRole } = checkedRoleAndModule(runtime, role, moduleName, options);
  if (!MOVE_FUNCTION.test(String(functionName || ''))) {
    throw new TypeError('Maker v8 function name is invalid.');
  }
  return `${packageRole.callablePackageId}::${moduleName}::${functionName}`;
}
