import { bcs } from '@mysten/sui/bcs';

export const recipeSlotBcs = bcs.struct('RecipeSlot', {
  part_key: bcs.string(),
  item_key: bcs.string(),
  color_hex: bcs.string(),
  render_order: bcs.u64(),
});

export function recipeValue(recipe) {
  return recipe.map((slot) => ({
    part_key: slot.partKey,
    item_key: slot.itemKey,
    color_hex: slot.colorHex,
    render_order: BigInt(slot.renderOrder),
  }));
}

export function recipeBytes(recipe) {
  return bcs.vector(recipeSlotBcs).serialize(recipeValue(recipe)).toBytes();
}

export async function hashRecipe(recipe) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', recipeBytes(recipe)));
}
