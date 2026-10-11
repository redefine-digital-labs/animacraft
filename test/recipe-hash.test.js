import test from 'node:test';
import assert from 'node:assert/strict';
import { hashRecipe, recipeBytes } from '../recipe-hash.js';

const fixture = [{
  partKey: 'eyes',
  itemKey: 'bright',
  colorHex: '#2db7a3',
  renderOrder: 0,
}];

test('serializes and hashes RecipeSlot exactly like Sui Move BCS', async () => {
  assert.equal(
    Buffer.from(recipeBytes(fixture)).toString('hex'),
    '0104657965730662726967687407233264623761330000000000000000',
  );
  assert.equal(
    Buffer.from(await hashRecipe(fixture)).toString('hex'),
    '176621d82d82b8e8e9068bcd59de9fdbb69170115e87609ba097fe3ea738d46d',
  );
});
