import assert from 'node:assert/strict';
import test from 'node:test';

import { ruleOwnerFromDefinition } from '../maker-workspace.js';

const document = {
  parts: [{
    id: 'hair',
    name: 'Hair',
    items: [{
      id: 'long',
      name: 'Long',
      variants: [{ id: 'windy', name: 'Windy' }],
    }],
  }],
};

test('resolves explicit Part, Item and Variant rule owners without falling back', () => {
  assert.equal(ruleOwnerFromDefinition(document, 'hair'), document.parts[0]);
  assert.equal(ruleOwnerFromDefinition(document, 'hair::long'), document.parts[0].items[0]);
  assert.equal(ruleOwnerFromDefinition(document, 'hair::long::windy'), document.parts[0].items[0].variants[0]);
  assert.equal(ruleOwnerFromDefinition(document, 'hair::missing'), null);
  assert.equal(ruleOwnerFromDefinition(document, 'missing'), null);
});
