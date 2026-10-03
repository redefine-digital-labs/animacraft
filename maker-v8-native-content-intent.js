import { sha256 } from '@noble/hashes/sha2.js';
import { toBase64, toHex } from '@mysten/sui/utils';
import { encodeMakerV8StoredFileZip } from './maker-v8-project-zip.js';
import { encodeMakerV8PublicPreviewV8, decodeMakerV8PublicPreviewV8 } from './maker-v8-public-preview.js';

const enc = new TextEncoder();
function invalid(message) {
  throw Object.assign(new Error(message), { code: 'MAKER_V8_NATIVE_CONTENT_INTENT_INVALID' });
}
function literal(value, label, maximum, nonempty = true) {
  if (typeof value !== 'string' || (nonempty && !value.trim())
    || enc.encode(value).length > maximum) invalid(`${label} is missing or exceeds its byte limit.`);
  // TextEncoder replaces lone UTF-16 surrogates; rejecting prevents unnoticed
  // alterations of the submitted document during UTF-8 upload.
  if (new TextDecoder().decode(enc.encode(value)) !== value) invalid(`${label} is not lossless UTF-8 text.`);
  return value;
}

/** Player has public tags but no separate public preview upload field. Its
 * render may be encrypted, so never copy render URLs or private documents into
 * the public preview record. Same schema/normalization as Soulidity's writer. */
export function buildMakerV8NativePublicPreviewV8(profile) {
  if (typeof profile?.tags !== 'string') invalid('The Player public tags field is required.');
  try { return decodeMakerV8PublicPreviewV8(encodeMakerV8PublicPreviewV8({ schema: 'soulidity.soul-public-preview.v1',
    tags: profile.tags.split(','), previewImages: [] })); }
  catch { invalid('Public tags exceed their text bounds or are not lossless text.'); }
}

/** Uses exactly the values shown by Player soulDocumentState. No interpolation,
 * owner marker, trimming, regenerated template, or executable Markdown. */
export function buildMakerV8NativeContentIntentV8(project) {
  if (!project || project.schemaVersion !== 'animacraft.local-player-project.v8'
    || !project.profile || !project.soul) invalid('The submitted Player project is required.');
  const imageExport = project.imageExport;
  if (!imageExport || Object.getPrototypeOf(imageExport) !== Object.prototype
    || Reflect.ownKeys(imageExport).length !== 2
    || Reflect.ownKeys(imageExport).some(key => !['sizeMode', 'transparent'].includes(key))
    || Object.values(Object.getOwnPropertyDescriptors(imageExport)).some(field => !Object.hasOwn(field, 'value') || !field.enumerable)
    || !['standard', 'original'].includes(imageExport.sizeMode) || typeof imageExport.transparent !== 'boolean') {
    invalid('The selected final image export settings are required and must be exact.');
  }
  const name = literal(project.profile.name, 'Soul name', 256);
  const description = literal(project.profile.description, 'Soul description', 4096, false);
  const publicPreview = buildMakerV8NativePublicPreviewV8(project.profile);
  const source = project.soul;
  const documents = source.documents ?? source;
  const defaults = source.defaults ?? {};
  const values = ['soulMd', 'memoryMd', 'skillMd'].map(key =>
    literal(documents[key] ?? defaults[key], key, 65536));
  const frontmatter = /^---[ \t]*\r?\n([\s\S]*?)^---[ \t]*\r?$/m.exec(values[2]);
  const names = frontmatter ? [...frontmatter[1].matchAll(/^name:[ \t]*([a-z0-9_-]{1,32})[ \t]*\r?$/gm)] : [];
  const skillName = names.length === 1 ? names[0][1] : null;
  if (!skillName) invalid('SKILL.md requires valid name frontmatter.');
  const specs = [
    { kind: 0, name: 'soul', fileName: 'soul.md', mimeType: 'text/markdown' },
    { kind: 1, name: 'default', fileName: 'memory.md', mimeType: 'text/markdown' },
    { kind: 2, name: skillName, fileName: 'skills.zip', mimeType: 'application/zip' },
  ];
  const files = specs.map((spec, index) => {
    const text = enc.encode(values[index]);
    const bytes = index === 2 ? encodeMakerV8StoredFileZip('SKILL.md', text) : text;
    return Object.freeze({ ...spec, bytesBase64: toBase64(bytes), sha256: toHex(sha256(bytes)) });
  });
  // Bind all submitted choices as well as exact text/ZIP hashes. A text-identical
  // attempt for a different visual result is not a shared completion session.
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const commitment = toHex(sha256(enc.encode(JSON.stringify(canonical({
    domain: 'animacraft-native-content-intent/v2', name, description, publicPreview,
    profile: project.profile, recipe: project.recipe, render: project.render, imageExport,
    files: files.map(({ bytesBase64: _, ...metadata }) => metadata),
  })))));
  return Object.freeze({ name, description, publicPreview, commitment, files: Object.freeze(files) });
}
