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
      styles: [{ id: 'windy', name: 'Windy' }],
    }],
  }],
};

test('resolves explicit Part, Item and Style rule owners without falling back', () => {
  assert.equal(ruleOwnerFromDefinition(document, 'hair'), document.parts[0]);
  assert.equal(ruleOwnerFromDefinition(document, 'hair::long'), document.parts[0].items[0]);
  assert.equal(ruleOwnerFromDefinition(document, 'hair::long::windy'), document.parts[0].items[0].styles[0]);
  assert.equal(ruleOwnerFromDefinition(document, 'hair::missing'), null);
  assert.equal(ruleOwnerFromDefinition(document, 'missing'), null);
});
