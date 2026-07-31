import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OC_OUTPUT_PREVIEW_MAX_EDGE,
  fitOcOutputPreviewDimensionsV5,
} from '../oc-output-preview-v5.js';

test('public OC previews retain aspect ratio without enlarging source art', () => {
  assert.deepEqual(
    fitOcOutputPreviewDimensionsV5(2048, 1024),
    { width: 512, height: 256, scale: 0.25 },
  );
  assert.deepEqual(
    fitOcOutputPreviewDimensionsV5(320, 480),
    { width: 320, height: 480, scale: 1 },
  );
  assert.equal(OC_OUTPUT_PREVIEW_MAX_EDGE, 512);
});

test('preview dimension validation fails closed', () => {
  assert.throws(
    () => fitOcOutputPreviewDimensionsV5(0, 512),
    /invalid/,
  );
  assert.throws(
    () => fitOcOutputPreviewDimensionsV5(512, 512, 32),
    /invalid/,
  );
});
