/**
 * Shared Maker definition-editor sections.
 *
 * Maker Studio and Expansion Pack Studio intentionally consume this same
 * registry so Part / Item / Style structure, Layer Tracks, Smart Color,
 * combination rules and wardrobe policies keep one vocabulary and ordering.
 * Each host supplies its own permission adapter: a Maker may edit the whole
 * document, while a Pack may only edit its additive overlay.
 */

export const MAKER_DEFINITION_EDITOR_SECTION_IDS = Object.freeze({
  STRUCTURE: 'structure',
  LAYERS: 'layers',
  COLORS: 'colors',
  RULES: 'rules',
  WARDROBE: 'wardrobe',
});

const SECTION_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: MAKER_DEFINITION_EDITOR_SECTION_IDS.STRUCTURE,
    labelKey: 'partsItems',
    makerRoute: 'structure',
    packRoute: 'structure',
  }),
  Object.freeze({
    id: MAKER_DEFINITION_EDITOR_SECTION_IDS.LAYERS,
    labelKey: 'layerTracks',
    makerRoute: 'layers',
    packRoute: 'layers',
  }),
  Object.freeze({
    id: MAKER_DEFINITION_EDITOR_SECTION_IDS.COLORS,
    labelKey: 'smartColor',
    makerRoute: 'colors',
    packRoute: 'colors',
  }),
  Object.freeze({
    id: MAKER_DEFINITION_EDITOR_SECTION_IDS.RULES,
    labelKey: 'rules',
    makerRoute: 'rules',
    packRoute: 'rules',
  }),
  Object.freeze({
    id: MAKER_DEFINITION_EDITOR_SECTION_IDS.WARDROBE,
    labelKey: 'composableItems',
    makerRoute: 'composable',
    packRoute: 'wardrobe',
  }),
]);

export const MAKER_DEFINITION_EDITOR_SECTIONS = SECTION_DEFINITIONS;

export function normalizeMakerDefinitionEditorSection(value, fallback = 'structure') {
  const candidate = String(value || '').trim();
  if (SECTION_DEFINITIONS.some((section) => section.id === candidate)) return candidate;
  return SECTION_DEFINITIONS.some((section) => section.id === fallback)
    ? fallback
    : MAKER_DEFINITION_EDITOR_SECTION_IDS.STRUCTURE;
}

export function makerDefinitionEditorSections(translate = (key) => key, options = {}) {
  const scope = options.scope === 'pack' ? 'pack' : 'maker';
  const routeField = scope === 'pack' ? 'packRoute' : 'makerRoute';
  return SECTION_DEFINITIONS.map((section) => Object.freeze({
    id: section.id,
    route: section[routeField],
    labelKey: section.labelKey,
    label: String(translate(section.labelKey) || section.labelKey),
  }));
}
