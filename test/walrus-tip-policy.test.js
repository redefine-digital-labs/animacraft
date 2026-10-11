import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ANIMACRAFT_MAX_WALRUS_RELAY_TIP_MIST,
  ANIMACRAFT_MAX_WALRUS_UPLOAD_BYTES,
  DEFAULT_RUNTIME_CONFIG,
} from '../runtime-config.js';

test('quotes the exact Walrus relay tip before registration and after recovery', async () => {
  const source = await readFile(new URL('../chain-runtime.js', import.meta.url), 'utf8');
  const quoteCalls = source.match(/calculateUploadRelayTip\(\{\s*size: encoded\.unencodedSize,\s*\}\)/g) || [];

  assert.equal(quoteCalls.length, 2, 'prepare and resume must both refresh the relay quote');
  assert.match(source, /relayTipMist: Number\(relayTipMist\)/);
  assert.match(source, /walrusRelayMaxTipMist[\s\S]*\?\? ANIMACRAFT_MAX_WALRUS_RELAY_TIP_MIST/);
  assert.doesNotMatch(source, /walrusRelayMaxTipMist \|\|/);
});

test('the relay spend ceiling covers the documented Animacraft upload limit', () => {
  assert.equal(ANIMACRAFT_MAX_WALRUS_UPLOAD_BYTES, 500 * 1024 * 1024);
  assert.equal(ANIMACRAFT_MAX_WALRUS_RELAY_TIP_MIST, 100_000_000);
  assert.equal(
    DEFAULT_RUNTIME_CONFIG.walrusRelayMaxTipMist,
    ANIMACRAFT_MAX_WALRUS_RELAY_TIP_MIST,
  );
});
