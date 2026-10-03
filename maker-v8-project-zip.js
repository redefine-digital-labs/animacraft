export const MAKER_V8_PROJECT_ZIP_ENTRY = 'animacraft-project.json';
export const MAKER_V8_PROJECT_ZIP_MAX_BYTES = 64 * 1024 * 1024;

export class MakerV8ProjectZipError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MakerV8ProjectZipError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new MakerV8ProjectZipError(code, message);
}

function bytes(value) {
  if (!(value instanceof Uint8Array) || value.byteLength < 1
    || value.byteLength > MAKER_V8_PROJECT_ZIP_MAX_BYTES) {
    fail('MAKER_V8_PROJECT_ZIP_BYTES_INVALID', 'Project ZIP bytes must be a bounded Uint8Array.');
  }
  return value;
}

function u16(view, offset, value) { view.setUint16(offset, value, true); }
function u32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

function crc32(input) {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(...parts) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}

export function encodeMakerV8ProjectZip(bundle) {
  let json;
  try { json = `${JSON.stringify(bundle)}\n`; } catch { fail('MAKER_V8_PROJECT_ZIP_BUNDLE_INVALID', 'Project bundle must be JSON serializable.'); }
  const payload = new TextEncoder().encode(json);
  return encodeMakerV8StoredFileZip(MAKER_V8_PROJECT_ZIP_ENTRY, payload);
}

/** Shared deterministic single-file ZIP writer; project decode remains exact. */
export function encodeMakerV8StoredFileZip(fileName, input) {
  if (typeof fileName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(fileName)
    || fileName.includes('..')) fail('MAKER_V8_PROJECT_ZIP_ENTRY_INVALID', 'ZIP requires one safe filename.');
  const payload = bytes(input);
  const name = new TextEncoder().encode(fileName);
  const size = payload.byteLength;
  const checksum = crc32(payload);
  const local = new Uint8Array(30);
  const localView = new DataView(local.buffer);
  u32(localView, 0, 0x04034b50); u16(localView, 4, 20); u16(localView, 6, 0x0800);
  u16(localView, 8, 0); u16(localView, 10, 0); u16(localView, 12, 0);
  u32(localView, 14, checksum); u32(localView, 18, size); u32(localView, 22, size);
  u16(localView, 26, name.byteLength); u16(localView, 28, 0);
  const centralOffset = local.byteLength + name.byteLength + payload.byteLength;
  const central = new Uint8Array(46);
  const centralView = new DataView(central.buffer);
  u32(centralView, 0, 0x02014b50); u16(centralView, 4, 20); u16(centralView, 6, 20);
  u16(centralView, 8, 0x0800); u16(centralView, 10, 0); u16(centralView, 12, 0); u16(centralView, 14, 0);
  u32(centralView, 16, checksum); u32(centralView, 20, size); u32(centralView, 24, size);
  u16(centralView, 28, name.byteLength); u16(centralView, 30, 0); u16(centralView, 32, 0);
  u16(centralView, 34, 0); u16(centralView, 36, 0); u32(centralView, 38, 0); u32(centralView, 42, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  u32(endView, 0, 0x06054b50); u16(endView, 4, 0); u16(endView, 6, 0);
  u16(endView, 8, 1); u16(endView, 10, 1); u32(endView, 12, central.byteLength + name.byteLength);
  u32(endView, 16, centralOffset); u16(endView, 20, 0);
  const output = concat(local, name, payload, central, name, end);
  if (output.byteLength > MAKER_V8_PROJECT_ZIP_MAX_BYTES) {
    fail('MAKER_V8_PROJECT_ZIP_LIMIT', 'Project ZIP exceeds the 64 MiB product limit.');
  }
  return output;
}

export function decodeMakerV8ProjectZip(input) {
  const archive = bytes(input);
  if (archive.byteLength < 30 + 22) fail('MAKER_V8_PROJECT_ZIP_INVALID', 'Project ZIP is truncated.');
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const endOffset = archive.byteLength - 22;
  if (view.getUint32(endOffset, true) !== 0x06054b50
    || view.getUint16(endOffset + 8, true) !== 1
    || view.getUint16(endOffset + 10, true) !== 1
    || view.getUint16(endOffset + 20, true) !== 0) {
    fail('MAKER_V8_PROJECT_ZIP_INVALID', 'Project ZIP must contain exactly one canonical entry.');
  }
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (centralOffset + centralSize !== endOffset || view.getUint32(centralOffset, true) !== 0x02014b50) {
    fail('MAKER_V8_PROJECT_ZIP_INVALID', 'Project ZIP central directory is invalid.');
  }
  const compression = view.getUint16(centralOffset + 10, true);
  const checksum = view.getUint32(centralOffset + 16, true);
  const compressedSize = view.getUint32(centralOffset + 20, true);
  const uncompressedSize = view.getUint32(centralOffset + 24, true);
  const nameLength = view.getUint16(centralOffset + 28, true);
  const extraLength = view.getUint16(centralOffset + 30, true);
  const commentLength = view.getUint16(centralOffset + 32, true);
  const localOffset = view.getUint32(centralOffset + 42, true);
  if (compression !== 0 || compressedSize !== uncompressedSize || localOffset !== 0
    || extraLength !== 0 || commentLength !== 0 || centralSize !== 46 + nameLength) {
    fail('MAKER_V8_PROJECT_ZIP_INVALID', 'Project ZIP uses unsupported or non-canonical features.');
  }
  const name = new TextDecoder('utf-8', { fatal: true }).decode(archive.subarray(centralOffset + 46, centralOffset + 46 + nameLength));
  if (name !== MAKER_V8_PROJECT_ZIP_ENTRY || name.includes('/') || name.includes('\\') || name.includes('..')) {
    fail('MAKER_V8_PROJECT_ZIP_ENTRY_INVALID', 'Project ZIP entry name is not canonical.');
  }
  if (view.getUint32(0, true) !== 0x04034b50 || view.getUint16(8, true) !== 0
    || view.getUint16(26, true) !== nameLength || view.getUint16(28, true) !== 0
    || view.getUint32(14, true) !== checksum || view.getUint32(18, true) !== compressedSize
    || view.getUint32(22, true) !== uncompressedSize) {
    fail('MAKER_V8_PROJECT_ZIP_INVALID', 'Project ZIP local entry does not match its directory.');
  }
  const localName = new TextDecoder('utf-8', { fatal: true }).decode(archive.subarray(30, 30 + nameLength));
  const payloadStart = 30 + nameLength;
  const payloadEnd = payloadStart + uncompressedSize;
  if (localName !== name || payloadEnd !== centralOffset) fail('MAKER_V8_PROJECT_ZIP_INVALID', 'Project ZIP entry boundaries are invalid.');
  const payload = archive.subarray(payloadStart, payloadEnd);
  if (crc32(payload) !== checksum) fail('MAKER_V8_PROJECT_ZIP_CRC_MISMATCH', 'Project ZIP failed its CRC-32 check.');
  let bundle;
  try { bundle = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)); }
  catch { fail('MAKER_V8_PROJECT_ZIP_JSON_INVALID', 'Project ZIP does not contain valid UTF-8 JSON.'); }
  return bundle;
}
