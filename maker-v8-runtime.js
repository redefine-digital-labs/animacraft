const SUI_ID_PATTERN = /^0x[0-9a-f]{64}$/;
const SUI_TYPE_PATTERN = /^0x[0-9a-f]{1,64}::[a-zA-Z_][a-zA-Z0-9_]*::[a-zA-Z_][a-zA-Z0-9_]*(?:<.+>)?$/;

export const MAKER_V8_VERSION = 8;

export const MAKER_V8_RUNTIME_FIELDS = Object.freeze([
  'makerV8CallablePackageId',
  'makerV8TypeOriginPackageId',
  'makerV8ProtocolConfigId',
  'makerV8ProtocolTreasuryId',
  'makerV8PaymentCoinType',
]);

export const MAKER_V8_RETIRED_SPLIT_FIELDS = Object.freeze([
  'makerV8SealPackageId',
  'makerV8SoulProofType',
  'makerV8PhysicalCallablePackageId',
  'makerV8PhysicalTypeOriginPackageId',
]);

export const MAKER_V8_LEGACY_GATES = Object.freeze([
  'canonicalSoulMintEnabled',
  'commerceV5ReleaseEnabled',
  'compositionV6ReleaseEnabled',
  'physicalStyleV7ReleaseEnabled',
  'expansionPackV8ReleaseEnabled',
]);

function issue(code, field, message) {
  return Object.freeze({ code, field, message });
}

function exactSuiId(value) {
  const normalized = String(value || '').toLowerCase();
  return SUI_ID_PATTERN.test(normalized) && !/^0x0{64}$/.test(normalized)
    ? normalized
    : '';
}

function exactSuiType(value) {
  const normalized = String(value || '').trim();
  return SUI_TYPE_PATTERN.test(normalized) ? normalized : '';
}

function hasOwn(record, field) {
  return Object.prototype.hasOwnProperty.call(record, field);
}

/**
 * Validates the one-way v8 cutover boundary. Once enabled, every prior product
 * gate must be explicitly present and false; a missing old gate is not treated
 * as a safe default because it could be supplied by another configuration
 * layer after validation.
 */
export function inspectMakerV8Runtime(
  config,
  { requireEnabled = false, requireFreshTypeOrigin = false } = {},
) {
  const source = config && typeof config === 'object' && !Array.isArray(config)
    ? config
    : {};
  const enabled = source.makerV8ReleaseEnabled === true;
  const issues = [];

  if (typeof source.makerV8ReleaseEnabled !== 'boolean') {
    issues.push(issue(
      'MAKER_V8_GATE_INVALID',
      'makerV8ReleaseEnabled',
      'makerV8ReleaseEnabled must be an explicit boolean.',
    ));
  }
  if (requireEnabled && !enabled) {
    issues.push(issue(
      'MAKER_V8_GATE_DISABLED',
      'makerV8ReleaseEnabled',
      'Unified Maker v8 is required but its release gate is not enabled.',
    ));
  }

  const shouldValidateTuple = enabled
    || requireEnabled
    || MAKER_V8_RUNTIME_FIELDS.some((field) => String(source[field] || '').trim());
  const runtime = {
    makerV8ReleaseEnabled: enabled,
    makerV8CallablePackageId: exactSuiId(source.makerV8CallablePackageId),
    makerV8TypeOriginPackageId: exactSuiId(source.makerV8TypeOriginPackageId),
    makerV8ProtocolConfigId: exactSuiId(source.makerV8ProtocolConfigId),
    makerV8ProtocolTreasuryId: exactSuiId(source.makerV8ProtocolTreasuryId),
    makerV8PaymentCoinType: exactSuiType(source.makerV8PaymentCoinType),
  };

  if (shouldValidateTuple) {
    for (const field of MAKER_V8_RUNTIME_FIELDS) {
      if (!runtime[field]) {
        issues.push(issue(
          'MAKER_V8_RUNTIME_FIELD_INVALID',
          field,
          `${field} must contain an exact non-zero Mainnet identity.`,
        ));
      }
    }
    if (
      requireFreshTypeOrigin
      && runtime.makerV8CallablePackageId
      && runtime.makerV8TypeOriginPackageId
      && runtime.makerV8CallablePackageId !== runtime.makerV8TypeOriginPackageId
    ) {
      issues.push(issue(
        'MAKER_V8_FRESH_TYPE_ORIGIN_REQUIRED',
        'makerV8TypeOriginPackageId',
        'The initial unified v8 callable and TypeOrigin package must be identical.',
      ));
    }
  }

  if (enabled || requireEnabled) {
    for (const field of MAKER_V8_RETIRED_SPLIT_FIELDS) {
      if (String(source[field] || '').trim()) {
        issues.push(issue(
          'MAKER_V8_SPLIT_RUNTIME_FIELD_RETIRED',
          field,
          `${field} must be absent or empty because Seal, Soul and Physical are native modules in the unified v8 package.`,
        ));
      }
    }
    for (const field of MAKER_V8_LEGACY_GATES) {
      if (!hasOwn(source, field) || source[field] !== false) {
        issues.push(issue(
          'MAKER_V8_DUAL_PRODUCT_GATE',
          field,
          `${field} must be explicitly false during the unified v8 cutover.`,
        ));
      }
    }
  }

  return Object.freeze({
    valid: issues.length === 0,
    enabled,
    runtime: Object.freeze(runtime),
    issues: Object.freeze(issues),
  });
}

export class MakerV8RuntimeError extends Error {
  constructor(issues) {
    super(issues.map((entry) => `${entry.field}: ${entry.message}`).join('\n'));
    this.name = 'MakerV8RuntimeError';
    this.code = issues[0]?.code || 'MAKER_V8_RUNTIME_INVALID';
    this.issues = Object.freeze([...issues]);
  }
}

export function assertMakerV8Runtime(config, options) {
  const inspected = inspectMakerV8Runtime(config, options);
  if (!inspected.valid) throw new MakerV8RuntimeError(inspected.issues);
  return inspected.runtime;
}

export function makerV8StableType(runtime, moduleName, typeName) {
  const checked = assertMakerV8Runtime(runtime, {
    requireEnabled: runtime?.makerV8ReleaseEnabled === true,
  });
  const moduleValue = String(moduleName || '');
  const typeValue = String(typeName || '');
  if (!/^[a-z_][a-z0-9_]*$/.test(moduleValue)) {
    throw new TypeError('Maker v8 module name is invalid.');
  }
  if (!/^[A-Z][A-Za-z0-9]*$/.test(typeValue)) {
    throw new TypeError('Maker v8 type name is invalid.');
  }
  return `${checked.makerV8TypeOriginPackageId}::${moduleValue}::${typeValue}`;
}
