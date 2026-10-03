// Wire schema shared with Soulidity's soul-public-preview SDK codec. This
// browser-only peer has no account/storage access or private-content fallback.
export const MAKER_V8_PUBLIC_PREVIEW_KEY = 'soul_public_preview_v1';
const schema = 'soulidity.soul-public-preview.v1';
const enc = new TextEncoder();
function check(value) {
  if (!value) throw Object.assign(new Error('Invalid public Soul preview metadata.'), { code: 'MAKER_V8_PUBLIC_PREVIEW_INVALID' });
}
function url(value) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 2048
    && new TextDecoder().decode(enc.encode(value)) === value && !/[\s\u0000-\u001f\u007f\\]/.test(value));
  let parsed;
  try { parsed = new URL(value); } catch { check(false); }
  check(['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.hash
    && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(parsed.hostname)
    && !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(parsed.hostname));
  for (const key of parsed.searchParams.keys()) check(!/^(?:access[_-]?token|token|auth|authorization|api[_-]?key|key|password|secret|jwt|sig|signature|x-amz-.+|x-goog-.+)$/i.test(key));
  return value;
}
export function encodeMakerV8PublicPreviewV8(value) {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 3 && value.schema === schema
    && ['schema', 'tags', 'previewImages'].every(key => Object.hasOwn(value, key))
    && Array.isArray(value.tags) && value.tags.length <= 12
    && Array.isArray(value.previewImages) && value.previewImages.length <= 8);
  const tags = [];
  for (const raw of value.tags) {
    check(typeof raw === 'string' && raw.trim().length <= 50 && !/[\u0000-\u001f\u007f]/.test(raw)
      && new TextDecoder().decode(enc.encode(raw)) === raw);
    const tag = raw.trim().toLowerCase(); check(tag.length <= 50);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  const previewImages = Array.from(value.previewImages, url);
  const encoded = JSON.stringify({ schema, tags, previewImages });
  check(enc.encode(encoded).length <= 65536);
  return encoded;
}
export function decodeMakerV8PublicPreviewV8(text) {
  check(typeof text === 'string' && enc.encode(text).length <= 65536);
  let value;
  try { value = JSON.parse(text); } catch { check(false); }
  check(encodeMakerV8PublicPreviewV8(value) === text);
  return Object.freeze({ schema, tags: Object.freeze([...value.tags]), previewImages: Object.freeze([...value.previewImages]) });
}
