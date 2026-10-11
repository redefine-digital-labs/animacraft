import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MANIFEST_LIMITS } from '../manifest-validation.js';

function numericConstant(source, name) {
  const match = source.match(new RegExp(`const ${name}[^=]*=\\s*([0-9_]+)`));
  assert.ok(match, `Missing ${name}`);
  return Number(match[1].replaceAll('_', ''));
}

test('browser and manifest limits remain inside published protocol v3 limits', async () => {
  const [appSource, moveSource] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../move/animacraft/sources/animacraft.move', import.meta.url), 'utf8'),
  ]);

  const moveLimits = {
    parts: numericConstant(moveSource, 'MAX_PARTS'),
    items: numericConstant(moveSource, 'MAX_ITEMS'),
    rules: numericConstant(moveSource, 'MAX_RULES'),
    colors: numericConstant(moveSource, 'MAX_COLORS_PER_PART'),
  };
  const appLimits = {
    parts: numericConstant(appSource, 'MAX_MAKER_PARTS'),
    items: numericConstant(appSource, 'MAX_MAKER_ITEMS'),
    rules: numericConstant(appSource, 'MAX_MAKER_RULES'),
    colors: numericConstant(appSource, 'MAX_COLORS_PER_PART'),
  };

  assert.equal(MANIFEST_LIMITS.maxParts, appLimits.parts);
  assert.equal(MANIFEST_LIMITS.maxItems, appLimits.items);
  assert.equal(MANIFEST_LIMITS.maxRules, appLimits.rules);
  assert.equal(MANIFEST_LIMITS.maxColorsPerPart, appLimits.colors);
  assert.ok(appLimits.parts <= moveLimits.parts);
  assert.ok(appLimits.items <= moveLimits.items);
  assert.ok(appLimits.rules <= moveLimits.rules);
  assert.ok(appLimits.colors <= moveLimits.colors);
  assert.ok(numericConstant(appSource, 'MAX_SINGLE_PUBLISH_RECORDS') <= 450);
});
