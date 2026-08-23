#!/usr/bin/env node

import { createHash } from 'node:crypto';
import process from 'node:process';

const VERSION = 8n;
const MAX_STYLES = 10_000;
const MAX_COLORS = 5_000;
const OBJECT_RUNTIME_CACHE_LIMIT = 1_000;
const CATEGORY = Object.freeze({
  tracks: 0,
  parts: 1,
  items: 2,
  styles: 3,
  colors: 4,
  rules: 5,
  aggregate: 255,
});
const ORDER = Object.freeze([
  'tracks',
  'parts',
  'items',
  'styles',
  'colors',
  'rules',
  'aggregate',
]);
const encoder = new TextEncoder();

function fail(message) {
  throw new Error(message);
}

function concat(...values) {
  return Buffer.concat(values.map((value) => Buffer.from(value)));
}

function uleb128(value) {
  let remaining = Number(value);
  if (!Number.isSafeInteger(remaining) || remaining < 0) {
    fail(`invalid ULEB128 value: ${value}`);
  }
  const result = [];
  do {
    let byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining !== 0) byte |= 0x80;
    result.push(byte);
  } while (remaining !== 0);
  return Buffer.from(result);
}

function bcsU8(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    fail(`invalid u8: ${value}`);
  }
  return Buffer.from([value]);
}

function bcsU32(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    fail(`invalid u32: ${value}`);
  }
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value);
  return result;
}

function bcsU64(value) {
  const normalized = BigInt(value);
  if (normalized < 0n || normalized > 0xffff_ffff_ffff_ffffn) {
    fail(`invalid u64: ${value}`);
  }
  const result = Buffer.alloc(8);
  result.writeBigUInt64LE(normalized);
  return result;
}

function bcsBool(value) {
  return Buffer.from([value ? 1 : 0]);
}

function bcsBytes(value) {
  const normalized = Buffer.from(value);
  return concat(uleb128(normalized.length), normalized);
}

function bcsString(value) {
  return bcsBytes(encoder.encode(value));
}

function bcsOptionString(value) {
  return value === null
    ? uleb128(0)
    : concat(uleb128(1), bcsString(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest();
}

function repeatedHash(byte) {
  return Buffer.alloc(32, byte);
}

function indexedKey(prefix, index) {
  return `${prefix}${String(index).padStart(4, '0')}`;
}

function rollingBytes({ domain, root, category, previous, sequence, rowBytes }) {
  return concat(
    bcsBytes(encoder.encode(domain)),
    bcsU64(VERSION),
    bcsBytes(root),
    bcsU8(category),
    bcsBytes(previous),
    bcsU64(sequence),
    bcsBytes(rowBytes),
  );
}

function emptyCommitment(root, category) {
  return sha256(rollingBytes({
    domain: 'animacraft-v8/base-empty',
    root,
    category,
    previous: Buffer.alloc(0),
    sequence: 0n,
    rowBytes: Buffer.alloc(0),
  }));
}

function advanceCommitment(root, category, previous, sequence, rowBytes) {
  return sha256(rollingBytes({
    domain: 'animacraft-v8/base-append',
    root,
    category,
    previous,
    sequence,
    rowBytes,
  }));
}

function trackRowBytes() {
  return concat(
    bcsU64(0),
    bcsString('track'),
    bcsString('Track'),
    bcsU64(0),
    bcsBytes(repeatedHash(10)),
  );
}

function partRowBytes() {
  return concat(
    bcsU64(1),
    bcsString('part'),
    bcsString('Part'),
    bcsU8(0),
    bcsU64(0),
    bcsBool(true),
    bcsBool(true),
    bcsBytes(repeatedHash(11)),
  );
}

function itemRowBytes() {
  return concat(
    bcsU64(2),
    bcsString('part'),
    bcsString('item'),
    bcsString('Item'),
    bcsU8(0),
    bcsBytes(repeatedHash(12)),
  );
}

function styleRowBytes(index, uniqueColorPerStyle) {
  const colorChannelKey = uniqueColorPerStyle ? indexedKey('c', index) : null;
  const defaultSwatchKey = uniqueColorPerStyle ? 'swatch' : null;
  return concat(
    bcsU64(3 + index),
    bcsString('part'),
    bcsString('item'),
    bcsString(indexedKey('s', index)),
    bcsString('track'),
    bcsOptionString(colorChannelKey),
    bcsOptionString(defaultSwatchKey),
    bcsString('Style'),
    bcsString('style-blob'),
    bcsBytes(repeatedHash(13)),
    bcsBool(false),
    bcsBytes(repeatedHash(14)),
  );
}

function colorRowBytes(styleCount, index) {
  return concat(
    bcsU64(3 + styleCount + index),
    bcsString(indexedKey('c', index)),
    bcsString('swatch'),
    bcsString('Color'),
    bcsU32(0xff00ffff),
    bcsBytes(repeatedHash(15)),
  );
}

function generateCommitments(styleCount, uniqueColorPerStyle) {
  if (!Number.isInteger(styleCount) || styleCount <= 0 || styleCount > MAX_STYLES) {
    fail(`--styles must be an integer in 1..${MAX_STYLES}`);
  }
  const colorCount = uniqueColorPerStyle ? styleCount : 0;
  if (colorCount > MAX_COLORS) {
    fail(`unique-color fixture exceeds Core MAX_COLORS=${MAX_COLORS}`);
  }

  const root = repeatedHash(5);
  const commitments = {};
  for (const name of ORDER) {
    commitments[name] = emptyCommitment(root, CATEGORY[name]);
  }

  const advance = (name, sequence, rowBytes) => {
    commitments[name] = advanceCommitment(
      root,
      CATEGORY[name],
      commitments[name],
      sequence,
      rowBytes,
    );
    commitments.aggregate = advanceCommitment(
      root,
      CATEGORY.aggregate,
      commitments.aggregate,
      sequence,
      rowBytes,
    );
  };

  advance('tracks', 0, trackRowBytes());
  advance('parts', 1, partRowBytes());
  advance('items', 2, itemRowBytes());
  for (let index = 0; index < styleCount; index += 1) {
    advance('styles', 3 + index, styleRowBytes(index, uniqueColorPerStyle));
  }
  for (let index = 0; index < colorCount; index += 1) {
    advance('colors', 3 + styleCount + index, colorRowBytes(styleCount, index));
  }

  return { root, commitments, colorCount };
}

function base64(value) {
  return Buffer.from(value).toString('base64');
}

function hex(value) {
  return `0x${Buffer.from(value).toString('hex')}`;
}

function outputFixture(styleCount, uniqueColorPerStyle) {
  const generated = generateCommitments(styleCount, uniqueColorPerStyle);
  const rendered = Object.fromEntries(ORDER.map((name) => [name, {
    base64: base64(generated.commitments[name]),
    hex: hex(generated.commitments[name]),
    moveArg: [...generated.commitments[name]],
  }]));
  const cachedChildObjects = (2 * styleCount) + generated.colorCount;
  return {
    schema: 'animacraft-v8-seal-cap-fixture.v1',
    styleCount,
    colorCount: generated.colorCount,
    uniqueColorPerStyle,
    rootContentCommitment: {
      base64: base64(generated.root),
      hex: hex(generated.root),
    },
    objectRuntime: {
      cachedChildObjects,
      configuredLimit: OBJECT_RUNTIME_CACHE_LIMIT,
      withinConfiguredLimit: cachedChildObjects <= OBJECT_RUNTIME_CACHE_LIMIT,
    },
    commitments: rendered,
    createRegistryPureArgs: [
      String(styleCount),
      uniqueColorPerStyle,
      ...ORDER.map((name) => [...generated.commitments[name]]),
    ],
  };
}

function runSelfTest() {
  const expected333 = Object.freeze({
    tracks: '0g9P6t+TDfvvYinNn0MYCB/Ijg2qCJ3lLMOyQtZKqj0=',
    parts: 'omE9p+elusQ4y00u6W4DS4z2kSOi4a6ZCgxYkRLYQow=',
    items: 'sM+YpNoib6Q8M9Zo7FbgOcOi2BiIlVqPEI3k3ep74DE=',
    styles: 'c6P9rE6/nUMyA629rZ2JF6FQ5V+LSHzIMdw9byqxki8=',
    colors: 'vhrhPeKcdgGCDb3lwRdL7YoSeGhAjudqL7Ig8XArIqg=',
    rules: 'eC4pUHm1BiEEAdWt/ey3gkKolNfN1K7cX56J8BCLQbI=',
    aggregate: 'SA9dTScJA+R+BgrLgbJE851ghDgyyeO94FWKmTQ91zc=',
  });
  const generated = generateCommitments(333, true);
  for (const name of ORDER) {
    const actual = base64(generated.commitments[name]);
    if (actual !== expected333[name]) {
      fail(`333/333 on-chain fixture mismatch for ${name}: ${actual}`);
    }
  }
  process.stdout.write('ok: offline BCS commitments match the 333/333 on-chain fixture\n');
}

function parseArguments(argv) {
  if (argv.includes('--self-test')) return { selfTest: true };
  const styleIndex = argv.indexOf('--styles');
  if (styleIndex < 0 || styleIndex + 1 >= argv.length) {
    fail('usage: generate_commitments.mjs --styles <count> (--unique-colors | --colorless)');
  }
  const unique = argv.includes('--unique-colors');
  const colorless = argv.includes('--colorless');
  if (unique === colorless) {
    fail('choose exactly one of --unique-colors or --colorless');
  }
  return {
    selfTest: false,
    styleCount: Number(argv[styleIndex + 1]),
    uniqueColorPerStyle: unique,
  };
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) {
    runSelfTest();
  } else {
    process.stdout.write(`${JSON.stringify(
      outputFixture(options.styleCount, options.uniqueColorPerStyle),
      null,
      2,
    )}\n`);
  }
} catch (error) {
  process.stderr.write(`seal-cap commitment generation failed: ${error.message}\n`);
  process.exitCode = 1;
}
