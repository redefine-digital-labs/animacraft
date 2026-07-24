import { unzipSync, zipSync } from 'fflate';

export const MAKER_PROJECT_ARCHIVE_SCHEMA = 'animacraft.maker-project.v1';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function clone(value) {
  return structuredClone(value);
}

function safeSegment(value, fallback = 'asset') {
  const normalized = String(value || fallback)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function extensionFor(record, fallback = 'png') {
  const fileName = String(record?.fileName || '');
  const fileExtension = fileName.match(/\.([a-z0-9]+)$/i)?.[1];
  if (fileExtension) return fileExtension.toLowerCase();
  if (String(record?.blob?.type || '').includes('webp')) return 'webp';
  if (String(record?.blob?.type || '').includes('jpeg')) return 'jpg';
  return fallback;
}

function recordFrom(records, assetId) {
  return records instanceof Map ? records.get(assetId) : records?.[assetId];
}

async function bytesFrom(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value.arrayBuffer === 'function') return new Uint8Array(await value.arrayBuffer());
  return null;
}

export async function createMakerProjectArchive(document, runtimeAssets) {
  if (!document || typeof document !== 'object') throw new TypeError('A Maker document is required.');
  const files = {};
  const assetIndex = [];
  for (const descriptor of document.assets || []) {
    const record = recordFrom(runtimeAssets, descriptor.id);
    const sourceBytes = await bytesFrom(record?.blob || record?.file);
    const thumbnailBytes = await bytesFrom(record?.thumbnailBlob);
    const folder = `assets/${safeSegment(descriptor.id)}`;
    const sourcePath = sourceBytes ? `${folder}/source.${extensionFor(record)}` : '';
    const thumbnailPath = thumbnailBytes ? `${folder}/thumbnail.png` : '';
    if (sourcePath) files[sourcePath] = sourceBytes;
    if (thumbnailPath) files[thumbnailPath] = thumbnailBytes;
    assetIndex.push({
      assetId: String(descriptor.id),
      identifier: String(descriptor.identifier || ''),
      fileName: String(record?.fileName || descriptor.identifier || `${descriptor.id}.png`),
      mediaType: String(record?.blob?.type || descriptor.mediaType || 'image/png'),
      thumbnailMediaType: String(record?.thumbnailBlob?.type || 'image/png'),
      width: Number(record?.width || descriptor.width || 0),
      height: Number(record?.height || descriptor.height || 0),
      sourcePath,
      thumbnailPath,
      remoteUrl: sourcePath ? '' : String(record?.url || descriptor.url || ''),
    });
  }
  const project = {
    schemaVersion: MAKER_PROJECT_ARCHIVE_SCHEMA,
    exportedAt: new Date().toISOString(),
    document: clone(document),
    assets: assetIndex,
  };
  files['project.json'] = encoder.encode(JSON.stringify(project, null, 2));
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' });
}

export async function readMakerProjectArchive(input) {
  const archiveBytes = await bytesFrom(input);
  if (!archiveBytes) throw new TypeError('Choose an Animacraft Maker project ZIP.');
  let files;
  try {
    files = unzipSync(archiveBytes);
  } catch {
    throw new Error('This file is not a readable Animacraft Maker project ZIP.');
  }
  if (!files['project.json']) throw new Error('Maker project ZIP is missing project.json.');
  let project;
  try {
    project = JSON.parse(decoder.decode(files['project.json']));
  } catch {
    throw new Error('Maker project.json is not valid JSON.');
  }
  if (project?.schemaVersion !== MAKER_PROJECT_ARCHIVE_SCHEMA || !project.document) {
    throw new Error(`Unsupported Maker project schema: ${project?.schemaVersion || 'unknown'}.`);
  }
  const assets = (project.assets || []).map((entry) => {
    const source = entry.sourcePath ? files[entry.sourcePath] : null;
    const thumbnail = entry.thumbnailPath ? files[entry.thumbnailPath] : null;
    if (entry.sourcePath && !source) throw new Error(`Maker project is missing ${entry.sourcePath}.`);
    if (entry.thumbnailPath && !thumbnail) throw new Error(`Maker project is missing ${entry.thumbnailPath}.`);
    return {
      assetId: String(entry.assetId),
      identifier: String(entry.identifier || ''),
      fileName: String(entry.fileName || `${entry.assetId}.png`),
      width: Number(entry.width || 0),
      height: Number(entry.height || 0),
      blob: source ? new Blob([source], { type: entry.mediaType || 'image/png' }) : null,
      thumbnailBlob: thumbnail ? new Blob([thumbnail], { type: entry.thumbnailMediaType || 'image/png' }) : null,
      url: source ? '' : String(entry.remoteUrl || ''),
      source: source ? 'project-import' : 'remote',
    };
  });
  return {
    document: clone(project.document),
    assets,
    exportedAt: project.exportedAt || null,
  };
}
