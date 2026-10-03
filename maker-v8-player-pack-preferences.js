// Local catalog visibility only. These IDs are never proof of a PackPass and
// never contribute to transaction usedPacks unless its Styles are selected.
const ID = /^0x[0-9a-f]{64}$/;

export function assertMakerV8EnabledPackReleaseIds(value, recipe = null) {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length) {
    throw new TypeError('Enabled Pack releases must be a dense array of exact IDs.');
  }
  for (let index = 0; index < value.length; index += 1) {
    const id = value[index];
    if (!Object.hasOwn(value, index) || typeof id !== 'string' || !ID.test(id)
      || (index > 0 && value[index - 1] >= id)) {
      throw new TypeError('Enabled Pack releases must be unique, sorted exact IDs.');
    }
  }
  if (recipe?.selections?.some(selection => selection.source === 'PACK'
    && !value.includes(selection.releaseId))) {
    throw new TypeError('A selected Pack Style must belong to an enabled Pack.');
  }
  return value;
}
