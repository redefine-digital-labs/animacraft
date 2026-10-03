import { MAKER_V8_RULE_SELECTOR_FIELDS, validateMakerV8Rule, makerV8RuleSelectorMatches } from './maker-v8-rules.js';

export const MAKER_V8_VISIBILITY_LIMITS = Object.freeze({ leaves: 32, depth: 8, tokens: 288 });
const selectorOf = node => Object.fromEntries(MAKER_V8_RULE_SELECTOR_FIELDS.map(key => [key, node[key]]));
const exact = (value, fields) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).length === fields.length
  && fields.every(key => Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const conditionArray = value => Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype
  && value.length > 0 && value.length <= 32 && Reflect.ownKeys(value).length === value.length + 1
  && Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index)))
    .every(descriptor => descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value'));

/** One finite author AST, also used by the compiler and recipe evaluator. */
export function validateMakerV8Visibility(condition, { parts, subject } = {}) {
  if (condition === null || condition === undefined) return [];
  const issues = [];
  const add = (path, suffix, message) => issues.push({ path, code: `MAKER_V8_VISIBILITY_${suffix}`, message });
  const seen = new WeakSet();
  let leaves = 0;
  let tokens = 0;
  const owner = parts?.find(part => part.key === subject?.partKey)?.items?.find(item => item.key === subject?.itemKey);
  const visit = (node, path, depth) => {
    if (++tokens > 288 || depth > 8) { add(path, 'LIMIT', 'Visibility requires at most 32 leaves, depth 8 and 288 tokens.'); return; }
    if (!node || typeof node !== 'object' || Array.isArray(node) || seen.has(node)) {
      add(path, 'INVALID', 'Visibility requires a finite canonical condition tree.'); return;
    }
    seen.add(node);
    const op = Object.getOwnPropertyDescriptor(node, 'op')?.value;
    const fields = op === 'selected' ? ['op', ...MAKER_V8_RULE_SELECTOR_FIELDS]
      : op === 'not' ? ['op', 'condition'] : ['all', 'any'].includes(op) ? ['op', 'conditions'] : null;
    if (!fields || !exact(node, fields)) { add(path, 'INVALID', 'Visibility condition fields must match selected, not, all or any exactly.'); return; }
    if (op === 'selected') {
      if (++leaves > 32) add(path, 'LIMIT', 'Visibility accepts at most 32 selected leaves.');
      const selector = selectorOf(node);
      const invalid = validateMakerV8Rule({ key: 'visibility', kind: 'REQUIRE', trigger: selector, targetMode: 'ALL', targets: [selector], payload: {} });
      if (invalid.length) { add(path, 'SELECTOR_INVALID', invalid[0].message); return; }
      if (!parts) return;
      const part = parts.find(part => part.key === node.partKey);
      if (!part) { add(path, 'TARGET_UNKNOWN', 'Visibility target Part does not exist.'); return; }
      if (subject?.partKey === part.key) add(path, 'SAME_PART', 'Visibility targets must belong to another Part.');
      if (node.itemKey === null && part.required && node.source === 'ANY') add(path, 'REQUIRED_PART', 'A required whole Part is always selected. Choose an Item or Style.');
      if (['BASE', 'ANY'].includes(node.source) && node.itemKey !== null) {
        const item = part.items?.find(item => item.key === node.itemKey);
        if (node.source === 'BASE' && (!item || node.styleKey !== null && !item.styles?.some(style => style.key === node.styleKey))) {
          add(path, 'TARGET_UNKNOWN', 'Visibility target Item or Style does not exist.');
        }
        if (item?.status !== 'PUBLIC' && item && owner?.status === 'PUBLIC') add(path, 'TARGET_PRIVATE', 'A public Style cannot depend on an unpublished Item.');
      }
    } else if (op === 'not') visit(node.condition, `${path}${path ? '.' : ''}condition`, depth + 1);
    else {
      if (!conditionArray(node.conditions)) {
        add(path, 'INVALID', 'Visibility all/any needs 1 to 32 conditions.'); return;
      }
      node.conditions.forEach((child, index) => visit(child, `${path}${path ? '.' : ''}conditions[${index}]`, depth + 1));
    }
  };
  visit(condition, '', 1);
  return issues;
}

function assertCondition(condition, options) {
  const issues = validateMakerV8Visibility(condition, options);
  if (issues.length) { const error = new TypeError(issues[0].message); error.code = issues[0].code; error.issues = issues; throw error; }
}

export function evaluateMakerV8Visibility(condition, selections, matches = makerV8RuleSelectorMatches) {
  return evaluateVisibility(condition, selections, matches);
}

function evaluateVisibility(condition, selections, matches) {
  assertCondition(condition);
  const evaluate = node => node == null ? true : node.op === 'selected'
    ? selections.some(selection => matches(node, selection))
    : node.op === 'not' ? !evaluate(node.condition)
      : node.op === 'all' ? node.conditions.every(evaluate) : node.conditions.some(evaluate);
  return evaluate(condition);
}

/** Postfix semantic tokens. BCS field names and enum mapping belong to the compiler. */
export function makerV8VisibilityTokens(condition) {
  assertCondition(condition);
  const tokens = [];
  const visit = node => {
    if (node == null) return;
    if (node.op === 'selected') tokens.push({ opcode: 0, selector: selectorOf(node), arity: 0 });
    else if (node.op === 'not') { visit(node.condition); tokens.push({ opcode: 1, selector: null, arity: 1 }); }
    else { node.conditions.forEach(visit); tokens.push({ opcode: node.op === 'all' ? 2 : 3, selector: null, arity: node.conditions.length }); }
  };
  visit(condition);
  return tokens;
}

function builderError(suffix, message) { const error = new TypeError(message); error.code = `MAKER_V8_VISIBILITY_${suffix}`; throw error; }

function builderShapeIssue(selectors, logic, polarity, parts) {
  if (logic === 'any' && new Set(selectors.map(row => row.partKey)).size > 1) return ['ANY_SAME_PART', 'ANY visibility targets must belong to one Part.'];
  if (logic === 'any' && polarity === 'not-selected' && selectors.length > 1) return ['ANY_NOT_SELECTED', 'Not-selected ANY accepts one target.'];
  if (logic === 'all' && polarity === 'selected') {
    for (const partKey of new Set(selectors.map(row => row.partKey))) {
      const rows = selectors.filter(row => row.partKey === partKey && row.itemKey !== null);
      const exact = new Set(rows.filter(row => row.styleKey !== null).map(row => `${row.itemKey}/${row.styleKey}`));
      const coveredItems = new Set(rows.filter(row => row.styleKey !== null).map(row => row.itemKey));
      const wholeItems = new Set(rows.filter(row => row.styleKey === null && !coveredItems.has(row.itemKey)).map(row => row.itemKey));
      if (exact.size + wholeItems.size > (parts?.find(part => part.key === partKey)?.capacity ?? 1)) return ['IMPOSSIBLE_ALL', 'ALL targets cannot be selected together within the Part capacity.'];
    }
  }
  return null;
}

export function makerV8VisibilityFromBuilder({ document, partKey, itemKey, styleKey, logic, polarity, definitions }) {
  if (!['all', 'any'].includes(logic) || !['selected', 'not-selected'].includes(polarity)) builderError('BUILDER_INVALID', 'Choose a visibility match mode and polarity.');
  if (!Array.isArray(definitions) || !definitions.length) builderError('TARGET_REQUIRED', 'Choose at least one visibility target.');
  const owner = document.parts.find(part => part.key === partKey)?.items.find(item => item.key === itemKey)?.styles.find(style => style.key === styleKey);
  if (!owner) builderError('SUBJECT_UNKNOWN', 'Select an existing Style first.');
  if (owner.payload?.animacraftEditor?.styleLocked === true) builderError('STYLE_LOCKED', 'Unlock the Style before editing its visibility.');
  const selectors = [...new Set(definitions)].map(definition => {
    if (typeof definition !== 'string') builderError('BUILDER_INVALID', 'Invalid visibility target.');
    const segments = definition.split('::');
    if (segments.length > 3 || segments.some(value => !/^(?!0x[0-9a-fA-F]{64}$)[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))) builderError('BUILDER_INVALID', 'Invalid visibility target.');
    return { op: 'selected', source: segments.length === 1 ? 'ANY' : 'BASE', sourceKey: null, partKey: segments[0], itemKey: segments[1] ?? null, styleKey: segments[2] ?? null };
  });
  const conditions = selectors.map(condition => polarity === 'selected' ? condition : { op: 'not', condition });
  const result = conditions.length === 1 ? conditions[0] : { op: logic, conditions };
  assertCondition(result, { parts: document.parts, subject: { partKey, itemKey, styleKey } });
  const invalid = builderShapeIssue(selectors, logic, polarity, document.parts);
  if (invalid) builderError(...invalid);
  return result;
}

export function makerV8VisibilityEditorModel(condition, { parts } = {}) {
  const model = { advanced: false, logic: 'all', polarity: 'selected', definitions: [] };
  if (condition == null) return model;
  if (validateMakerV8Visibility(condition).length) return { ...model, advanced: true };
  const children = ['all', 'any'].includes(condition.op) ? condition.conditions : [condition];
  if (['all', 'any'].includes(condition.op)) model.logic = condition.op;
  let polarity;
  const selectors = [];
  for (const child of children) {
    const negative = child.op === 'not';
    const row = negative ? child.condition : child;
    const nextPolarity = negative ? 'not-selected' : 'selected';
    if (row.op !== 'selected' || row.source !== (row.itemKey === null ? 'ANY' : 'BASE')
      || row.sourceKey !== null || polarity && polarity !== nextPolarity) return { ...model, advanced: true, definitions: [] };
    polarity = nextPolarity;
    selectors.push(row);
    model.definitions.push([row.partKey, row.itemKey, row.styleKey].filter(value => value !== null).join('::'));
  }
  model.polarity = polarity;
  if (builderShapeIssue(selectors, model.logic, polarity, parts)) return { ...model, advanced: true, definitions: [] };
  model.definitions = [...new Set(model.definitions)];
  return model;
}
