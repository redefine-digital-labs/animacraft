/** Canonical author rules. Matching grants no custody or publication authority. */
export const MAKER_V8_RULE_FIELDS = ['key', 'kind', 'trigger', 'targetMode', 'targets', 'payload'];
export const MAKER_V8_RULE_SELECTOR_FIELDS = ['source', 'sourceKey', 'partKey', 'itemKey', 'styleKey'];
const key = value => typeof value === 'string' && /^(?!0x[0-9a-fA-F]{64}$)[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, fields) => record(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));

export function validateMakerV8Rule(rule, { parts } = {}) {
  const issues = [];
  const add = (path, message) => issues.push({ path, code: 'MAKER_V8_RULE_INVALID', message });
  if (!exact(rule, MAKER_V8_RULE_FIELDS)) { add('', 'Rule must use the canonical trigger/targets schema.'); return issues; }
  if (!key(rule.key)) add('key', 'Invalid rule key.');
  if (!['REQUIRE', 'EXCLUDE'].includes(rule.kind)) add('kind', 'Unknown rule kind.');
  if (!['ALL', 'ANY'].includes(rule.targetMode) || rule.kind === 'EXCLUDE' && rule.targetMode !== 'ANY') add('targetMode', 'EXCLUDE must use ANY; REQUIRE uses ALL or ANY.');
  if (!record(rule.payload)) add('payload', 'Rule payload must be an object.');
  if (!Array.isArray(rule.targets) || rule.targets.length === 0 || rule.targets.length > 32) add('targets', 'Rules require 1 to 32 targets.');
  const selectors = [['trigger', rule.trigger], ...(Array.isArray(rule.targets) ? rule.targets.map((s, i) => [`targets[${i}]`, s]) : [])];
  for (const [path, s] of selectors) {
    if (!exact(s, MAKER_V8_RULE_SELECTOR_FIELDS)) { add(path, 'Invalid selector fields.'); continue; }
    if (!['ANY', 'BASE', 'PACK', 'EXTERNAL'].includes(s.source)) add(`${path}.source`, 'Unknown selector source.');
    const validScope = s.source === 'EXTERNAL'
      ? typeof s.sourceKey === 'string' && /^0x[0-9a-f]{64}$/.test(s.sourceKey) && s.sourceKey !== `0x${'0'.repeat(64)}`
      : s.source === 'PACK' ? key(s.sourceKey) : ['ANY', 'BASE'].includes(s.source) && s.sourceKey === null;
    if (!validScope) add(`${path}.sourceKey`, 'Invalid source scope.');
    if (!key(s.partKey) || s.itemKey !== null && !key(s.itemKey) || s.styleKey !== null && (!key(s.styleKey) || s.itemKey === null)) add(path, 'Invalid selector path.');
    if (parts) {
      const part = parts.find(p => p.key === s.partKey);
      if (!part) { add(path, 'Selector Part does not exist.'); continue; }
      if (s.source === 'BASE' && s.itemKey !== null) {
        const item = part.items.find(i => i.key === s.itemKey && i.status === 'PUBLIC');
        if (!item || s.styleKey !== null && !item.styles.some(style => style.key === s.styleKey)) add(path, 'BASE selector must reference a public Item and exact Style.');
      }
    }
  }
  return issues;
}

export function makerV8RuleSelectorMatches(selector, selection) {
  const source = selection.source ?? 'BASE';
  if (!['BASE', 'PACK', 'EXTERNAL'].includes(source)) return false;
  if (selector.source !== 'ANY' && selector.source !== source) return false;
  const sourceKey = source === 'PACK' ? selection.semanticPackId : source === 'EXTERNAL' ? selection.externalProductId : null;
  if (['PACK', 'EXTERNAL'].includes(selector.source) && selector.sourceKey !== sourceKey) return false;
  return selector.partKey === selection.partKey
    && (selector.itemKey === null || selector.itemKey === selection.itemKey)
    && (selector.styleKey === null || selector.styleKey === selection.styleKey);
}

export function makerV8RuleIssue(rules, selections, matches = makerV8RuleSelectorMatches) {
  for (const rule of rules) {
    const invalid = validateMakerV8Rule(rule);
    if (invalid.length) return invalid[0];
    const selected = selector => selections.some(selection => matches(selector, selection));
    if (!selected(rule.trigger)) continue;
    const hits = rule.targets.map(selected);
    if (rule.kind === 'EXCLUDE' ? hits.some(Boolean) : !(rule.targetMode === 'ALL' ? hits.every(Boolean) : hits.some(Boolean))) {
      return { code: `MAKER_V8_PLAYER_RULE_${rule.kind}_FAILED`, message: `Recipe violates ${rule.kind} rule ${rule.key}.` };
    }
  }
  return null;
}

export function makerV8RuleFromBuilder({ key: ruleKey, kind, type, ownerDefinition, definitions, matchMode, payload = {} }) {
  if (!['all', 'any', 'ALL', 'ANY'].includes(matchMode)) throw new TypeError('Unknown rule match mode.');
  if (!Array.isArray(definitions)) throw new TypeError('Rule targets must be definitions.');
  const selector = definition => {
    const segments = String(definition).split('::');
    if (segments.length > 3 || segments.some(segment => !key(segment))) throw new TypeError('Invalid rule builder definition.');
    return { source: segments.length === 1 ? 'ANY' : 'BASE', sourceKey: null, partKey: segments[0], itemKey: segments[1] ?? null, styleKey: segments[2] ?? null };
  };
  const resolvedKind = kind ?? (type === 'requires' ? 'REQUIRE' : type === 'excludes' ? 'EXCLUDE' : null);
  const targets = [...new Set(definitions)].map(selector);
  const trigger = selector(ownerDefinition);
  if (targets.some(target => target.partKey === trigger.partKey)) throw new TypeError('Rule targets cannot belong to the trigger Part.');
  const targetMode = resolvedKind === 'EXCLUDE' ? 'ANY' : matchMode.toUpperCase();
  if (resolvedKind === 'REQUIRE' && targetMode === 'ANY') {
    if (new Set(targets.map(target => target.partKey)).size > 1) throw new TypeError('ANY targets must belong to one Part.');
    if (targets.some(target => target.styleKey !== null)
      && (targets.some(target => target.styleKey === null) || new Set(targets.map(target => target.itemKey)).size > 1)) throw new TypeError('Style ANY targets must belong to one Item without whole-Item targets.');
  }
  const rule = { key: ruleKey, kind: resolvedKind, trigger, targetMode, targets, payload };
  if (validateMakerV8Rule(rule).length) throw new TypeError('Invalid rule builder.');
  return rule;
}

/** Explicit author-data upgrade only; never invoked by execution/validation. */
export function upgradeAuthorMakerV8RulesV8(rules) {
  return rules.map(rule => {
    if (!exact(rule, ['key', 'kind', 'left', 'right', 'payload'])) throw new TypeError('Expected legacy author rule.');
    const selector = ref => {
      if (!exact(ref, ['partKey', 'itemKey'])) throw new TypeError('Unsupported legacy selector.');
      return { source: 'BASE', sourceKey: null, ...ref, styleKey: null };
    };
    const upgraded = { key: rule.key, kind: rule.kind, trigger: selector(rule.left), targetMode: rule.kind === 'EXCLUDE' ? 'ANY' : 'ALL', targets: [selector(rule.right)], payload: structuredClone(rule.payload) };
    if (validateMakerV8Rule(upgraded).length) throw new TypeError('Invalid legacy author rule.');
    return upgraded;
  });
}
