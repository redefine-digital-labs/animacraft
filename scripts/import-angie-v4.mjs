#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

import { migrateMakerV3ToV4, validateMakerV4Document } from '../maker-v4.js';

export const ANGIE_STRESS_REPORT_SCHEMA = 'animacraft.angie-stress-report.v1';
export const ANGIE_FIXTURE_CLASSIFICATION = 'negative-complex-stress-fixture';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class AngieImportError extends Error {
  constructor(message, code = 'angie-import-error', details = {}) {
    super(message);
    this.name = 'AngieImportError';
    this.code = code;
    this.details = details;
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

/** Inspect the exact PNG format required by the Artist Delivery Specification. */
export function inspectRgbaPng(bytes, identifier = 'image.png') {
  const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (source.length < 33 || !source.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new AngieImportError(`${identifier} is not a PNG file.`, 'invalid-png', { identifier });
  }
  let offset = 8;
  let header = null;
  const imageData = [];
  while (offset + 12 <= source.length) {
    const length = source.readUInt32BE(offset);
    const type = source.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > source.length) {
      throw new AngieImportError(`${identifier} contains a truncated PNG chunk.`, 'invalid-png', { identifier, type });
    }
    const data = source.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      imageData.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }
  if (!header || !imageData.length) {
    throw new AngieImportError(`${identifier} is missing PNG image data.`, 'invalid-png', { identifier });
  }
  if (header.bitDepth !== 8 || header.colorType !== 6 || header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
    throw new AngieImportError(
      `${identifier} must be an 8-bit, non-interlaced RGBA PNG.`,
      'unsupported-png-format',
      { identifier, ...header },
    );
  }

  const bytesPerPixel = 4;
  const stride = header.width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(imageData));
  const expectedLength = (stride + 1) * header.height;
  if (inflated.length !== expectedLength) {
    throw new AngieImportError(`${identifier} has an unexpected decoded byte length.`, 'invalid-png', {
      identifier,
      expectedLength,
      actualLength: inflated.length,
    });
  }

  let previous = Buffer.alloc(stride);
  let cursor = 0;
  let alphaPixels = 0;
  let minX = header.width;
  let minY = header.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < header.height; y += 1) {
    const filterType = inflated[cursor];
    cursor += 1;
    const row = Buffer.allocUnsafe(stride);
    for (let index = 0; index < stride; index += 1) {
      const raw = inflated[cursor + index];
      const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
      const up = previous[index] || 0;
      const upperLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0;
      switch (filterType) {
        case 0: row[index] = raw; break;
        case 1: row[index] = (raw + left) & 0xff; break;
        case 2: row[index] = (raw + up) & 0xff; break;
        case 3: row[index] = (raw + Math.floor((left + up) / 2)) & 0xff; break;
        case 4: row[index] = (raw + paeth(left, up, upperLeft)) & 0xff; break;
        default:
          throw new AngieImportError(`${identifier} uses unsupported PNG filter ${filterType}.`, 'invalid-png-filter', { identifier, filterType });
      }
    }
    cursor += stride;
    for (let x = 0; x < header.width; x += 1) {
      if (row[(x * bytesPerPixel) + 3] === 0) continue;
      alphaPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    previous = row;
  }

  const alphaBounds = alphaPixels ? {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  } : null;
  return {
    ...header,
    alphaPixels,
    alphaCoverage: alphaPixels / (header.width * header.height),
    alphaBounds,
  };
}

function safeAssetPath(sourceRoot, identifier) {
  const value = String(identifier || '');
  if (!value || isAbsolute(value) || value.includes('\\') || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new AngieImportError(`Unsafe Angie asset identifier: ${value || '(empty)'}.`, 'unsafe-asset-identifier', { identifier: value });
  }
  const filePath = resolve(sourceRoot, ...value.split('/'));
  const childPath = relative(sourceRoot, filePath);
  if (!childPath || childPath === '..' || childPath.startsWith(`..${sep}`) || isAbsolute(childPath)) {
    throw new AngieImportError(`Angie asset escapes its release directory: ${value}.`, 'unsafe-asset-identifier', { identifier: value });
  }
  return filePath;
}

function assetUrl(baseUrl, identifier) {
  const encoded = identifier.split('/').map(encodeURIComponent).join('/');
  return `${String(baseUrl).replace(/\/$/, '')}/${encoded}`;
}

function partAssetIdentifiers(v3Part) {
  return new Set((v3Part.items || []).flatMap((item) => (item.images || []).map((image) => String(image.identifier || '')).filter(Boolean)));
}

function alignmentDiagnostics(v3Manifest, metrics, canvas) {
  const diagnostics = [];
  const metricByIdentifier = new Map(metrics.map((entry) => [entry.identifier, entry]));
  (v3Manifest.parts || []).forEach((part) => {
    const identifiers = [...partAssetIdentifiers(part)];
    const visible = identifiers.map((identifier) => metricByIdentifier.get(identifier)).filter((entry) => entry?.alphaBounds);
    if (visible.length > 1) {
      const centersX = visible.map((entry) => entry.alphaBounds.centerX);
      const centersY = visible.map((entry) => entry.alphaBounds.centerY);
      const spreadX = Math.max(...centersX) - Math.min(...centersX);
      const spreadY = Math.max(...centersY) - Math.min(...centersY);
      const warningThreshold = Math.max(8, Math.min(canvas.width, canvas.height) * 0.01);
      if (spreadX > warningThreshold || spreadY > warningThreshold) {
        diagnostics.push({
          severity: 'warning',
          code: 'internal-alignment-spread',
          partId: part.key,
          message: `${part.label || part.key} visible bounds move by ${spreadX.toFixed(1)}px × ${spreadY.toFixed(1)}px across Items; equal PNG dimensions do not prove alignment.`,
          spreadX,
          spreadY,
          threshold: warningThreshold,
        });
      }
    }
    if (['hair', 'outfit'].includes(part.key) && (part.layers || []).length === 1) {
      diagnostics.push({
        severity: 'warning',
        code: 'single-composite-layer',
        partId: part.key,
        message: `${part.label || part.key} is a complex visual stored on one Layer; front/back occlusion cannot be independently controlled.`,
      });
    }
    if ((part.items || []).every((item) => !item.iconIdentifier)) {
      diagnostics.push({
        severity: 'info',
        code: 'auto-thumbnail-only',
        partId: part.key,
        message: `${part.label || part.key} has no artist-supplied Item thumbnails; the UI must alpha-crop runtime art.`,
      });
    }
  });
  return diagnostics;
}

export function resolveDefaultAngieReleaseRoot(cwd = process.cwd()) {
  const candidates = [
    process.env.ANGIE_RELEASE_ROOT,
    resolve(cwd, '../angie-soulidity/releases/astral-courier'),
    resolve(cwd, '../../angie-soulidity/releases/astral-courier'),
    resolve(SCRIPT_DIR, '../../../angie-soulidity/releases/astral-courier'),
  ].filter(Boolean).map((candidate) => resolve(candidate));
  return candidates.find((candidate) => existsSync(resolve(candidate, 'animacraft-manifest.json'))) || candidates.at(-1);
}

/**
 * Convert Angie's existing v3 release into a local v4 stress fixture and an
 * evidence report. This intentionally does not repair the art: alignment,
 * empty-placeholder and composite-layer problems must remain observable.
 */
export async function buildAngieV4StressFixture({
  sourceRoot = resolveDefaultAngieReleaseRoot(),
  assetBaseUrl = '',
  attachLocalPaths = true,
} = {}) {
  const root = resolve(sourceRoot);
  const manifestPath = resolve(root, 'animacraft-manifest.json');
  let manifestBytes;
  try {
    manifestBytes = await readFile(manifestPath);
  } catch (error) {
    throw new AngieImportError(`Could not read Angie release manifest at ${manifestPath}.`, 'missing-angie-release', { manifestPath, cause: error.message });
  }
  let sourceManifest;
  try {
    sourceManifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    throw new AngieImportError('Angie release manifest is not valid JSON.', 'invalid-angie-manifest', { manifestPath, cause: error.message });
  }
  if (sourceManifest.schemaVersion !== 'animacraft.creator-template.v3') {
    throw new AngieImportError('Angie stress importer requires an animacraft.creator-template.v3 manifest.', 'unsupported-angie-schema', {
      schemaVersion: sourceManifest.schemaVersion,
    });
  }

  const sourceMakerId = String(sourceManifest.template?.id || 'angie-maker');
  const stressMakerId = `${sourceMakerId}-stress-v4`;
  const document = migrateMakerV3ToV4(sourceManifest, {
    makerId: stressMakerId,
    rootMakerId: stressMakerId,
  });
  document.metadata.name = `[Stress Fixture] ${document.metadata.name}`;
  document.metadata.summary = `Negative/complex editor stress fixture; not a visual gold standard. ${document.metadata.summary}`.trim();
  document.metadata.disclosures = {
    aiAssisted: /\bAI[- ]assisted\b/i.test(String(sourceManifest.template?.licenseNote || '')),
    statement: String(sourceManifest.template?.licenseNote || ''),
    verification: 'source-declared-not-independently-verified',
  };
  document.publication.mintingEnabled = false;
  document.publication.mintFeeEnabled = false;
  document.publication.mintPriceAtomic = 0;

  const metrics = [];
  const diagnostics = [];
  for (const asset of document.assets) {
    const identifier = String(asset.identifier || '');
    const filePath = safeAssetPath(root, identifier);
    let bytes;
    let fileStat;
    try {
      [bytes, fileStat] = await Promise.all([readFile(filePath), stat(filePath)]);
    } catch (error) {
      throw new AngieImportError(`Missing Angie asset: ${identifier}.`, 'missing-angie-asset', { identifier, filePath, cause: error.message });
    }
    const png = inspectRgbaPng(bytes, identifier);
    asset.width = png.width;
    asset.height = png.height;
    asset.byteLength = fileStat.size;
    asset.sha256 = sha256(bytes);
    if (assetBaseUrl) asset.url = assetUrl(assetBaseUrl, identifier);
    else if (attachLocalPaths) asset.url = pathToFileURL(filePath).href;
    if (attachLocalPaths) asset.localPath = filePath;
    const metric = {
      assetId: asset.id,
      identifier,
      byteLength: fileStat.size,
      sha256: asset.sha256,
      width: png.width,
      height: png.height,
      alphaPixels: png.alphaPixels,
      alphaCoverage: png.alphaCoverage,
      alphaBounds: png.alphaBounds,
    };
    metrics.push(metric);
    if (png.width !== document.canvas.width || png.height !== document.canvas.height) {
      diagnostics.push({
        severity: 'error',
        code: 'canvas-size-mismatch',
        assetId: asset.id,
        identifier,
        message: `${identifier} is ${png.width}×${png.height}; expected ${document.canvas.width}×${document.canvas.height}.`,
      });
    }
    if (!png.alphaPixels) {
      diagnostics.push({
        severity: 'warning',
        code: 'empty-alpha-placeholder',
        assetId: asset.id,
        identifier,
        message: `${identifier} is fully transparent. Optional None should normally be recipe state, not an empty PNG Item.`,
      });
    }
  }

  diagnostics.push(...alignmentDiagnostics(sourceManifest, metrics, document.canvas));
  diagnostics.push({
    severity: 'warning',
    code: 'cover-provenance-unverified',
    assetId: document.metadata.coverAssetId,
    message: 'The legacy cover is an independent source file; this importer cannot prove it was rendered from the default Recipe.',
  });
  const knownLimitations = [
    'Angie is intentionally a negative/complex stress fixture, not approved visual reference art.',
    'The release contains flattened runtime PNGs but no PSD/PSB authoring structure or creator-approved positioning evidence.',
    'Hair and outfit use one composite layer each, so front/back occlusion cannot be repaired by metadata alone.',
    'Alpha-bound centers diagnose suspicious movement but cannot decide artistic intent or automatically realign anatomy.',
    'The v3 cover cannot be proven pixel-identical to the shared v4 renderer without its original render recipe.',
    'The source declares AI assistance; this importer records the statement but cannot verify training data or rights provenance.',
  ];
  const report = {
    schemaVersion: ANGIE_STRESS_REPORT_SCHEMA,
    classification: ANGIE_FIXTURE_CLASSIFICATION,
    doNotPublish: true,
    doNotUseAsVisualGold: true,
    source: {
      releaseRoot: attachLocalPaths ? root : null,
      manifest: 'animacraft-manifest.json',
      manifestSha256: sha256(manifestBytes),
      schemaVersion: sourceManifest.schemaVersion,
      makerId: sourceMakerId,
    },
    summary: {
      partCount: document.parts.length,
      itemCount: document.parts.reduce((total, part) => total + part.items.length, 0),
      variantCount: document.parts.reduce((total, part) => total + part.items.reduce((itemTotal, item) => itemTotal + item.variants.length, 0), 0),
      layerTrackCount: document.layerTracks.length,
      assetCount: document.assets.length,
      errorCount: diagnostics.filter((entry) => entry.severity === 'error').length,
      warningCount: diagnostics.filter((entry) => entry.severity === 'warning').length,
    },
    diagnostics,
    assetMetrics: metrics,
    knownLimitations,
  };
  document.extensions.stressTest = {
    classification: report.classification,
    doNotPublish: true,
    doNotUseAsVisualGold: true,
    sourceManifestSha256: report.source.manifestSha256,
    sourceMakerId,
    reportSchemaVersion: report.schemaVersion,
    diagnosticCounts: {
      errors: report.summary.errorCount,
      warnings: report.summary.warningCount,
    },
    knownLimitations,
    originalPublication: migrateMakerV3ToV4(sourceManifest).publication,
  };

  validateMakerV4Document(document, { mode: 'publish' });
  return { manifest: document, report };
}

export async function copyAngieFixtureAssets(manifest, sourceRoot, destinationRoot) {
  const source = resolve(sourceRoot);
  const destination = resolve(destinationRoot);
  for (const asset of manifest.assets || []) {
    const identifier = String(asset.identifier || '');
    const inputPath = safeAssetPath(source, identifier);
    const outputPath = safeAssetPath(destination, identifier);
    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(inputPath, outputPath);
  }
}

function usage() {
  return `Usage: node scripts/import-angie-v4.mjs [options]\n\nOptions:\n  --source PATH          Angie astral-courier release directory\n  --output FILE          Write v4 stress manifest; default: stdout\n  --report FILE          Write diagnostic report\n  --asset-base-url URL   Browser URL prefix for copied/source assets\n  --copy-assets DIR      Copy referenced assets while preserving identifiers\n  --portable             Omit absolute local paths and file:// URLs\n  --help                 Show this help\n\nThis importer never edits Angie source files. The result is a negative stress fixture and must not be published as approved art.\n`;
}

function parseArgs(argv) {
  const result = { sourceRoot: '', output: '-', report: '', assetBaseUrl: '', copyAssets: '', attachLocalPaths: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') result.help = true;
    else if (argument === '--portable') result.attachLocalPaths = false;
    else if (['--source', '--output', '--report', '--asset-base-url', '--copy-assets'].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new AngieImportError(`${argument} needs a value.`, 'invalid-cli-arguments');
      index += 1;
      if (argument === '--source') result.sourceRoot = value;
      else if (argument === '--output') result.output = value;
      else if (argument === '--report') result.report = value;
      else if (argument === '--asset-base-url') result.assetBaseUrl = value;
      else result.copyAssets = value;
    } else {
      throw new AngieImportError(`Unknown argument: ${argument}.`, 'invalid-cli-arguments');
    }
  }
  return result;
}

async function writeJson(destination, value) {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  if (!destination || destination === '-') process.stdout.write(json);
  else {
    const outputPath = resolve(destination);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, json);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (options.output === '-' && options.report === '-') {
    throw new AngieImportError('Manifest and report cannot both use stdout.', 'invalid-cli-arguments');
  }
  const sourceRoot = options.sourceRoot || resolveDefaultAngieReleaseRoot();
  const result = await buildAngieV4StressFixture({
    sourceRoot,
    assetBaseUrl: options.assetBaseUrl,
    attachLocalPaths: options.attachLocalPaths,
  });
  if (options.copyAssets) await copyAngieFixtureAssets(result.manifest, sourceRoot, options.copyAssets);
  await writeJson(options.output, result.manifest);
  if (options.report) await writeJson(options.report, result.report);
  process.stderr.write(
    `Angie v4 stress fixture: ${result.report.summary.partCount} Parts, ${result.report.summary.itemCount} Items, ${result.report.summary.assetCount} assets, ${result.report.summary.errorCount} errors, ${result.report.summary.warningCount} warnings.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.name || 'Error'} [${error.code || 'unknown'}]: ${error.message}\n`);
    process.exitCode = 1;
  });
}
