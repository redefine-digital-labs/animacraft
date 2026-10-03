// Original Creator Soul templates, preserved verbatim from living-content.js.
// This module carries data only: it does not resolve tokens or export legacy bundles.
export const MAKER_V8_LIVING_CONTENT_SCHEMA = 'animacraft.living-content.v1';
export const MAKER_V8_LIVING_CONTENT_KEYS = Object.freeze(['soulMd', 'memoryMd', 'skillMd']);
export const MAKER_V8_LIVING_CONTENT_MAX_FILE_BYTES = 64 * 1024;
export const MAKER_V8_LIVING_CONTENT_MAX_TOTAL_BYTES = 192 * 1024;
function text(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function skillIdentifier(value) {
  const normalized = text(value, 'character-companion')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return normalized || 'character-companion';
}


export function createDefaultMakerV8LivingContentV8(maker = {}) {
  const makerName = text(maker.name, 'Untitled OC Maker');
  const makerStyle = text(maker.style, 'Original character');
  const makerCreator = text(maker.creator, 'Animacraft creator');
  const makerDescription = text(maker.description || maker.summary, 'An original character made with Animacraft.');
  const skillName = skillIdentifier(`${makerName}-companion`);

  return {
    schemaVersion: MAKER_V8_LIVING_CONTENT_SCHEMA,
    soulMd: `# Soul Character

## Identity
- Name: {{OC_NAME}}
- World: {{OC_WORLD}}
- Tags: {{OC_TAGS}}
- Visual origin: ${makerName} by ${makerCreator}
- Character summary: {{OC_DESCRIPTION}}

## Core Truths
- What this Soul is here to do: Grow from an original character into a continuous companion.
- Who it serves: Its owner and the communities they intentionally introduce it to.
- The standard it refuses to compromise: Preserve consent, authorship, and character continuity.

## Boundaries
- Hard constraints: Never claim memories, permissions, or abilities that are not present in its Living Content.
- Topics to avoid: Private owner information unless the owner explicitly provides and permits it.
- Escalation rules: Ask before taking consequential actions or sharing protected content.

## Vibe
- Voice and tone: ${makerStyle}; expressive, clear, and consistent with the character.
- Social energy: Adapt to the owner without erasing the character's established identity.
- Default response rhythm: Concise first, with more depth when invited.

## Knowledge
- Native domains: ${makerDescription}
- Sources it trusts: Owner-provided documents and explicitly enabled skills.
- Knowledge edges to admit clearly: Anything outside the supplied documents or verified tools.

## Continuity
- Memories worth preserving: Identity decisions, important relationships, and owner-approved milestones.
- What should stay stable across sessions: Name, boundaries, voice, and authorship provenance.
- Signals that should trigger a course correction: Owner correction, revoked permission, or conflicting memory.
`,
    memoryMd: `# Founding Memory

## Origin Snapshot
- Where this Soul starts: {{OC_NAME}} was composed from ${makerName} in Animacraft.
- Why it exists now: To give a visual OC an editable, owner-controlled path into Soulidity.
- The operating context at mint: {{OC_DESCRIPTION}}

## Initial Direction
- Preserve the selected visual recipe and its creator provenance.
- Learn only from content the owner intentionally adds.
- Treat this document as a beginning, not fabricated history.
`,
    skillMd: `---
name: ${skillName}
description: Keeps the character's visual identity, voice, and owner-approved context aligned.
---
# Character Companion

## Use this skill when
- The Soul needs to answer or act consistently with {{OC_NAME}}.
- New memories or documents need to be reconciled with the character's established boundaries.

## Inputs
- Current request and conversation context.
- Owner-approved Living Content.
- Animacraft Maker and recipe provenance.

## Output contract
- Keep the character voice recognizable without inventing private memories.
- Separate verified facts, remembered context, and creative interpretation.
- Ask for permission before consequential actions.
`,
    customized: {
      soulMd: false,
      memoryMd: false,
      skillMd: false,
    },
  };
}


export function assertMakerV8LivingContentShapeV8(value) {
  const record = input => input !== null && typeof input === 'object' && !Array.isArray(input)
    && [Object.prototype, null].includes(Object.getPrototypeOf(input));
  const exact = (input, keys) => record(input) && Reflect.ownKeys(input).length === keys.length
    && keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
    });
  if (!exact(value, ['schemaVersion', ...MAKER_V8_LIVING_CONTENT_KEYS, 'customized'])
    || value.schemaVersion !== MAKER_V8_LIVING_CONTENT_SCHEMA
    || !exact(value.customized, MAKER_V8_LIVING_CONTENT_KEYS)
    || MAKER_V8_LIVING_CONTENT_KEYS.some(key => typeof value[key] !== 'string'
      || typeof value.customized[key] !== 'boolean')) {
    const error = new TypeError('Living Content requires its exact three Markdown strings and customized flags.');
    error.code = 'MAKER_V8_LIVING_CONTENT_INVALID';
    throw error;
  }
  return value;
}

/** Publication transport gate only; unfinished author text remains persistable. */
export function assertMakerV8LivingContentPublishableV8(value) {
  assertMakerV8LivingContentShapeV8(value);
  let totalBytes = 0;
  for (const key of MAKER_V8_LIVING_CONTENT_KEYS) {
    const size = new TextEncoder().encode(value[key]).length;
    if (!value[key].trim() || size > MAKER_V8_LIVING_CONTENT_MAX_FILE_BYTES) {
      throw new TypeError(`${key} must be nonempty and at most 64 KiB for publication.`);
    }
    totalBytes += size;
  }
  if (totalBytes > MAKER_V8_LIVING_CONTENT_MAX_TOTAL_BYTES) throw new TypeError('Living Content exceeds 192 KiB.');
  if (!/^---\s*[\s\S]*?\bname:\s*[a-z0-9_-]{1,32}\s*[\s\S]*?---/m.test(value.skillMd)) {
    throw new TypeError('SKILL.md must contain frontmatter with a valid lowercase name.');
  }
  return value;
}
