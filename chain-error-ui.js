const MAX_DETAIL_LENGTH = 8_000;

export const FRESH_V8_ERROR_LAYER = Object.freeze({
  LOCAL_SCHEMA_CONFIG: 'LOCAL_SCHEMA_CONFIG',
  STALE_CONTEXT: 'STALE_CONTEXT',
  ELIGIBILITY: 'ELIGIBILITY',
  CUSTODY_AUTHORITY: 'CUSTODY_AUTHORITY',
  QUOTE_PAYMENT: 'QUOTE_PAYMENT',
  DRY_RUN_MOVE_ABORT: 'DRY_RUN_MOVE_ABORT',
  WALLET: 'WALLET',
  DURABLE_STORAGE: 'DURABLE_STORAGE',
  SUBMISSION_AMBIGUITY: 'SUBMISSION_AMBIGUITY',
  FINALIZED_EXECUTION: 'FINALIZED_EXECUTION',
  READBACK_INDEXING: 'READBACK_INDEXING',
});

const LAYER_COPY = Object.freeze({
  [FRESH_V8_ERROR_LAYER.LOCAL_SCHEMA_CONFIG]: Object.freeze({
    title: 'Fresh v8 configuration is unavailable',
    nextAction: 'Verify the complete seven-role runtime and open a supported route.',
  }),
  [FRESH_V8_ERROR_LAYER.STALE_CONTEXT]: Object.freeze({
    title: 'Live chain context changed',
    nextAction: 'Refresh every object, review the quote again, then rebuild.',
  }),
  [FRESH_V8_ERROR_LAYER.ELIGIBILITY]: Object.freeze({
    title: 'This action is not eligible',
    nextAction: 'Refresh lifecycle and listing status before choosing another action.',
  }),
  [FRESH_V8_ERROR_LAYER.CUSTODY_AUTHORITY]: Object.freeze({
    title: 'Custody or authority does not match',
    nextAction: 'Reconnect the correct wallet and reload the exact object references.',
  }),
  [FRESH_V8_ERROR_LAYER.QUOTE_PAYMENT]: Object.freeze({
    title: 'Quote or exact payment changed',
    nextAction: 'Review all quote splits, then rebuild the exact-balance wallet intent from current coins.',
  }),
  [FRESH_V8_ERROR_LAYER.DRY_RUN_MOVE_ABORT]: Object.freeze({
    title: 'The Move dry run rejected this action',
    nextAction: 'Do not sign. Refresh chain state and inspect the abort diagnostic.',
  }),
  [FRESH_V8_ERROR_LAYER.WALLET]: Object.freeze({
    title: 'Wallet action did not complete',
    nextAction: 'Reconnect and confirm the active account and network before retrying.',
  }),
  [FRESH_V8_ERROR_LAYER.DURABLE_STORAGE]: Object.freeze({
    title: 'Signed-state storage is not durable',
    nextAction: 'Do not broadcast. Restore durable browser storage before continuing.',
  }),
  [FRESH_V8_ERROR_LAYER.SUBMISSION_AMBIGUITY]: Object.freeze({
    title: 'Transaction outcome is unknown',
    nextAction: 'Query the saved digest first. Never create a replacement signature.',
  }),
  [FRESH_V8_ERROR_LAYER.FINALIZED_EXECUTION]: Object.freeze({
    title: 'The transaction finalized with failure',
    nextAction: 'Keep the terminal evidence and refresh before preparing a changed action.',
  }),
  [FRESH_V8_ERROR_LAYER.READBACK_INDEXING]: Object.freeze({
    title: 'Final readback is not verified yet',
    nextAction: 'Refresh the saved digest until effects, event, custody, and epochs match.',
  }),
});

function textCandidates(error, seen = new Set()) {
  if (error == null || seen.has(error)) return [];
  if (typeof error === 'string') return [error];
  if (typeof error !== 'object') return [String(error)];
  seen.add(error);
  const values = [
    error.code,
    error.name,
    error.message,
    error.shortMessage,
    typeof error.details === 'string' ? error.details : '',
    typeof error.reason === 'string' ? error.reason : '',
  ];
  if (error.cause) values.push(...textCandidates(error.cause, seen));
  if (error.error) values.push(...textCandidates(error.error, seen));
  if (error.data) values.push(...textCandidates(error.data, seen));
  return values.filter((value) => typeof value === 'string' && value.trim());
}

function detailsFor(error) {
  return [...new Set(textCandidates(error))]
    .join('\n')
    .slice(0, MAX_DETAIL_LENGTH) || 'Unknown fresh v8 client error';
}

function explicitLayer(error) {
  const layer = String(error?.layer || '').toUpperCase();
  if (['CONFIGURATION', 'VALIDATION', 'SHAPE', 'SCHEMA', 'IDENTITY', 'ACTIVATION'].includes(layer)) {
    return FRESH_V8_ERROR_LAYER.LOCAL_SCHEMA_CONFIG;
  }
  if (['CONTEXT', 'LINEAGE', 'BINDING', 'CONCURRENCY'].includes(layer)) {
    return FRESH_V8_ERROR_LAYER.STALE_CONTEXT;
  }
  if (['AUTHORITY', 'CUSTODY'].includes(layer)) return FRESH_V8_ERROR_LAYER.CUSTODY_AUTHORITY;
  if (layer === 'STORAGE') return FRESH_V8_ERROR_LAYER.DURABLE_STORAGE;
  if (layer === 'SIGNING') return FRESH_V8_ERROR_LAYER.WALLET;
  if (['QUERY', 'BROADCAST'].includes(layer)) return FRESH_V8_ERROR_LAYER.SUBMISSION_AMBIGUITY;
  if (layer === 'READBACK') return FRESH_V8_ERROR_LAYER.READBACK_INDEXING;
  if (layer === 'TERMINAL') return FRESH_V8_ERROR_LAYER.FINALIZED_EXECUTION;
  return '';
}

function inferredLayer(error, details) {
  const direct = explicitLayer(error);
  if (direct) return direct;
  const code = String(error?.code || '').toUpperCase();
  const value = `${code}\n${details}`.toUpperCase();
  if (/QUOTE_DRIFT|CONTEXT_DRIFT|SNAPSHOT_DRIFT/.test(code)) {
    return FRESH_V8_ERROR_LAYER.STALE_CONTEXT;
  }
  if (/FINALIZED_(?:FAILURE|EXECUTION)|EXECUTION_FAILURE|TERMINAL_FAILURE/.test(value)) {
    return FRESH_V8_ERROR_LAYER.FINALIZED_EXECUTION;
  }
  if (/READBACK|INDEX(?:ER|ING)|EVENT_MISSING|EFFECTS_MISMATCH/.test(value)) {
    return FRESH_V8_ERROR_LAYER.READBACK_INDEXING;
  }
  if (/OUTCOME_(?:PENDING|UNKNOWN)|QUERY_FAILED|BROADCAST|SUBMISSION|DIGEST_NOT_FOUND/.test(value)) {
    return FRESH_V8_ERROR_LAYER.SUBMISSION_AMBIGUITY;
  }
  if (/STORAGE|INDEXEDDB|DURABLE|CAS_/.test(value)) {
    return FRESH_V8_ERROR_LAYER.DURABLE_STORAGE;
  }
  if (/WALLET|SIGNATURE|SIGNING|USER_REJECT|ACCOUNT|NETWORK_MISMATCH/.test(value)) {
    return FRESH_V8_ERROR_LAYER.WALLET;
  }
  if (/MOVE_ABORT|DRY_RUN|ABORTED|MOVEABORT/.test(value)) {
    return FRESH_V8_ERROR_LAYER.DRY_RUN_MOVE_ABORT;
  }
  if (/STALE|DRIFT|REVISION|EPOCH|COMMITMENT_MISMATCH|CONTEXT/.test(value)) {
    return FRESH_V8_ERROR_LAYER.STALE_CONTEXT;
  }
  if (/QUOTE|PAYMENT|GROSS|COIN_BALANCE|UNDERPAY|OVERPAY/.test(value)) {
    return FRESH_V8_ERROR_LAYER.QUOTE_PAYMENT;
  }
  if (/CUSTODY|AUTHORITY|RECEIVING|OWNER|TYPE_ORIGIN|OBJECT_REF|SOURCE_TREASURY/.test(value)) {
    return FRESH_V8_ERROR_LAYER.CUSTODY_AUTHORITY;
  }
  if (/ELIGIBILITY|LIFECYCLE|LISTING_STATUS|NOT_ELIGIBLE|PROTOCOL_STATE/.test(value)) {
    return FRESH_V8_ERROR_LAYER.ELIGIBILITY;
  }
  return FRESH_V8_ERROR_LAYER.LOCAL_SCHEMA_CONFIG;
}

export function classifyFreshV8Error(error, {
  action = '',
  occurredAt = new Date().toISOString(),
} = {}) {
  const details = detailsFor(error);
  const layer = inferredLayer(error, details);
  const copy = LAYER_COPY[layer];
  const code = typeof error?.code === 'string' && error.code.trim()
    ? error.code.trim()
    : 'FRESH_V8_ACTION_FAILED';
  const retryable = error?.retryable === true || [
    FRESH_V8_ERROR_LAYER.STALE_CONTEXT,
    FRESH_V8_ERROR_LAYER.WALLET,
    FRESH_V8_ERROR_LAYER.SUBMISSION_AMBIGUITY,
    FRESH_V8_ERROR_LAYER.READBACK_INDEXING,
  ].includes(layer);
  return Object.freeze({
    code,
    layer,
    title: copy.title,
    nextAction: copy.nextAction,
    action: String(action || ''),
    occurredAt,
    retryable,
    details,
    diagnostic: [
      copy.title,
      `Layer: ${layer}`,
      `Code: ${code}`,
      action ? `Action: ${action}` : '',
      `Time: ${occurredAt}`,
      '',
      details,
    ].filter((line, index) => line || index === 5).join('\n'),
  });
}

export const classifyChainUiError = classifyFreshV8Error;
