import { strToU8, zipSync } from 'fflate';

export const LIVING_CONTENT_SCHEMA = 'animacraft.living-content.v1';
export const LIVING_CONTENT_MAX_FILE_BYTES = 64 * 1024;
export const LIVING_CONTENT_MAX_TOTAL_BYTES = 192 * 1024;

const encoder = new TextEncoder();
const TOKEN_PATTERN = /\{\{(OC_NAME|OC_WORLD|OC_DESCRIPTION|MAKER_NAME|MAKER_STYLE|MAKER_CREATOR)\}\}/g;

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

function skillNameFromMarkdown(source) {
  const match = /^---\s*[\s\S]*?^name:\s*([a-z0-9_-]{1,32})\s*$[\s\S]*?^---\s*$/m.exec(source);
  return match?.[1] || 'character-companion';
}

export function createDefaultLivingContent(maker = {}) {
  const makerName = text(maker.name, 'Untitled OC Maker');
  const makerStyle = text(maker.style, 'Original character');
  const makerCreator = text(maker.creator, 'Animacraft creator');
  const makerDescription = text(maker.description || maker.summary, 'An original character made with Animacraft.');
  const skillName = skillIdentifier(`${makerName}-companion`);

  return {
    schemaVersion: LIVING_CONTENT_SCHEMA,
    soulMd: `# Soul Character

## Identity
- Name: {{OC_NAME}}
- World: {{OC_WORLD}}
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

export function normalizeLivingContent(value, maker = {}) {
  const defaults = createDefaultLivingContent(maker);
  if (!value || typeof value !== 'object') return defaults;
  const normalized = {
    schemaVersion: LIVING_CONTENT_SCHEMA,
    soulMd: typeof value.soulMd === 'string' ? value.soulMd : defaults.soulMd,
    memoryMd: typeof value.memoryMd === 'string' ? value.memoryMd : defaults.memoryMd,
    skillMd: typeof value.skillMd === 'string' ? value.skillMd : defaults.skillMd,
    customized: {
      soulMd: Boolean(value.customized?.soulMd),
      memoryMd: Boolean(value.customized?.memoryMd),
      skillMd: Boolean(value.customized?.skillMd),
    },
  };
  return normalized;
}

export function validateLivingContent(value) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== LIVING_CONTENT_SCHEMA) {
    throw new Error('Living Content uses an unsupported schema version.');
  }
  const files = [
    ['Soul Character', value.soulMd],
    ['Memory', value.memoryMd],
    ['Skills & Docs', value.skillMd],
  ];
  let totalBytes = 0;
  files.forEach(([label, source]) => {
    if (typeof source !== 'string' || !source.trim()) throw new Error(`${label} cannot be empty.`);
    const size = encoder.encode(source).length;
    if (size > LIVING_CONTENT_MAX_FILE_BYTES) throw new Error(`${label} exceeds the 64 KiB launch limit.`);
    totalBytes += size;
  });
  if (totalBytes > LIVING_CONTENT_MAX_TOTAL_BYTES) throw new Error('Living Content exceeds the 192 KiB launch limit.');
  if (!/^---\s*[\s\S]*?\bname:\s*[a-z0-9_-]{1,32}\s*[\s\S]*?---/m.test(value.skillMd)) {
    throw new Error('Skills & Docs must contain SKILL.md frontmatter with a valid lowercase name.');
  }
  return value;
}

export function resolveLivingContent(value, context = {}) {
  const normalized = normalizeLivingContent(value, context.maker);
  const replacements = {
    OC_NAME: text(context.profile?.name, 'Untitled OC'),
    OC_WORLD: text(context.profile?.world, context.maker?.style || 'Original character'),
    OC_DESCRIPTION: text(context.profile?.description, context.maker?.description || context.maker?.summary || 'An original character.'),
    MAKER_NAME: text(context.maker?.name, 'Untitled OC Maker'),
    MAKER_STYLE: text(context.maker?.style, 'Original character'),
    MAKER_CREATOR: text(context.maker?.creator, 'Animacraft creator'),
  };
  const replace = (source) => source.replace(TOKEN_PATTERN, (_, key) => replacements[key]);
  return {
    schemaVersion: LIVING_CONTENT_SCHEMA,
    soulMd: replace(normalized.soulMd),
    memoryMd: replace(normalized.memoryMd),
    skillMd: replace(normalized.skillMd),
  };
}

export function soulidityContentManifest(value, context = {}) {
  const resolved = resolveLivingContent(value, context);
  return {
    schemaVersion: 'animacraft.soulidity-import.v1',
    source: 'animacraft',
    makerId: text(context.makerId),
    files: [
      { kind: 0, kindName: 'soul_doc', name: 'soul', filename: 'soul.md', mimeType: 'text/markdown' },
      { kind: 1, kindName: 'memory', name: 'default', filename: 'memory.md', mimeType: 'text/markdown' },
      { kind: 2, kindName: 'skill', name: skillNameFromMarkdown(resolved.skillMd), filename: 'skills.zip', mimeType: 'application/zip', archiveEntry: 'SKILL.md' },
    ],
    content: resolved,
  };
}

export function createSoulidityImportBundle(value, context = {}) {
  const manifest = soulidityContentManifest(value, context);
  const skillZip = zipSync({ 'SKILL.md': strToU8(manifest.content.skillMd) }, { level: 6 });
  const importJson = context.importJson || createSoulidityImportJson(value, context);
  const hasCover = context.imageBytes instanceof Uint8Array && context.imageBytes.length > 0;
  const files = {
    '00-profile.json': strToU8(JSON.stringify(importJson, null, 2)),
    '02-soul.md': strToU8(manifest.content.soulMd),
    '03-memory.md': strToU8(manifest.content.memoryMd),
    '04-skills.zip': skillZip,
    'animacraft-import-manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'README.txt': strToU8(`Animacraft -> Soulidity Import Kit

Extract this ZIP before opening Soulidity Import Soul.

1. Upload 00-profile.json as the source file.
2. Confirm the mapped Soul name and description.
3. ${hasCover ? 'Upload 01-cover.png as Preview Image.' : 'Choose a PNG cover image as Preview Image.'}
4. Upload 02-soul.md as Soul Character.
5. Upload 03-memory.md as Memory.
6. Upload 04-skills.zip as Skills & Docs (optional but already valid).
7. Review the Animacraft Maker provenance, then sign the Soulidity mint.

Paid Makers require the dedicated Animacraft authorization adapter and cannot use this transitional import kit.
`),
  };
  if (hasCover) {
    files['01-cover.png'] = context.imageBytes;
  }
  const bundle = zipSync(files, { level: 6 });
  return { manifest, bytes: bundle };
}

/** Transitional JSON for Soulidity's generic Import Soul UI. */
export function createSoulidityImportJson(value, context = {}) {
  const manifest = soulidityContentManifest(value, context);
  return {
    name: text(context.profile?.name, 'Untitled OC'),
    description: text(context.profile?.description, context.maker?.description || context.maker?.summary || 'Animacraft original character'),
    avatar: text(context.imageUrl),
    memory: manifest.content.memoryMd,
    skills: manifest.content.skillMd,
    config: manifest.content.soulMd,
    tags: Array.isArray(context.profile?.tags) ? context.profile.tags : [],
    animacraft: {
      makerId: manifest.makerId,
      schemaVersion: manifest.schemaVersion,
      profileUrl: text(context.profileUrl),
      recipeHash: text(context.recipeHash),
    },
  };
}
