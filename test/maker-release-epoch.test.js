import test from 'node:test';
import assert from 'node:assert/strict';

import { createMakerV5Document } from '../maker-v4.js';
import {
  CURRENT_MAKER_DATA_EPOCH,
  isCurrentMakerDataEpoch,
  makerDataEpoch,
  stampCurrentMakerDataEpoch,
} from '../maker-release-epoch.js';

test('new Maker documents are stamped with the current clean data epoch', () => {
  const document = createMakerV5Document();
  assert.equal(makerDataEpoch(document), CURRENT_MAKER_DATA_EPOCH);
  assert.equal(isCurrentMakerDataEpoch(document), true);
});

test('legacy documents remain identifiable and can be explicitly restamped', () => {
  const legacy = { extensions: { preserved: true } };
  assert.equal(isCurrentMakerDataEpoch(legacy), false);
  assert.equal(stampCurrentMakerDataEpoch(legacy), legacy);
  assert.equal(legacy.extensions.preserved, true);
  assert.equal(isCurrentMakerDataEpoch(legacy), true);
});
