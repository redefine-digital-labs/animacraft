import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGradientColorProcessor,
  gradientMapPixels,
} from '../maker-color.js';

class TestImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

test('gradient-map preserves alpha and deterministically maps dark, mid, light, and transparent pixels', () => {
  const previousImageData = globalThis.ImageData;
  globalThis.ImageData = TestImageData;
  try {
    const source = new TestImageData(new Uint8ClampedArray([
      0, 0, 0, 255,
      128, 128, 128, 200,
      255, 255, 255, 128,
      12, 34, 56, 0,
    ]), 4, 1);
    const result = gradientMapPixels(source, [
      { offset: 0, rgba: [10, 20, 30, 255] },
      { offset: 0.5, rgba: [110, 120, 130, 128] },
      { offset: 1, rgba: [210, 220, 230, 64] },
    ]);

    assert.deepEqual([...result.data.slice(0, 4)], [10, 20, 30, 255]);
    assert.deepEqual([...result.data.slice(4, 7)], [110, 120, 130]);
    assert.equal(result.data[7], Math.round(200 * (128 / 255)));
    assert.deepEqual([...result.data.slice(8, 11)], [210, 220, 230]);
    assert.equal(result.data[11], Math.round(128 * (64 / 255)));
    assert.deepEqual([...result.data.slice(12, 16)], [12, 34, 56, 0]);
    assert.deepEqual([...source.data.slice(0, 4)], [0, 0, 0, 255], 'the source pixels remain immutable');
  } finally {
    globalThis.ImageData = previousImageData;
  }
});

test('gradient-map processor caches one source and preset without leaking across different presets', async () => {
  const previousImageData = globalThis.ImageData;
  const previousDocument = globalThis.document;
  globalThis.ImageData = TestImageData;
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, 'canvas');
      let source = null;
      const canvas = {
        width: 0,
        height: 0,
        output: null,
        getContext() {
          return {
            drawImage(nextSource) {
              source = nextSource;
            },
            getImageData() {
              return new TestImageData(
                new Uint8ClampedArray(source.pixels),
                canvas.width,
                canvas.height,
              );
            },
            putImageData(result) {
              canvas.output = [...result.data];
            },
          };
        },
      };
      return canvas;
    },
  };

  try {
    const source = {
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray([128, 128, 128, 255]),
    };
    const processor = createGradientColorProcessor();
    const redPreset = {
      mode: 'gradient-map',
      valueDefinition: {
        stops: [
          { offset: 0, color: '#000000' },
          { offset: 1, color: '#ff0000' },
        ],
      },
    };
    const bluePreset = {
      mode: 'gradient-map',
      valueDefinition: {
        stops: [
          { offset: 0, color: '#000000' },
          { offset: 1, color: '#0000ff' },
        ],
      },
    };

    const red = await processor({ source, channel: redPreset });
    const redAgain = await processor({ source, channel: redPreset });
    const blue = await processor({ source, channel: bluePreset });

    assert.equal(redAgain.source, red.source, 'the same source and preset reuse their rendered canvas');
    assert.notEqual(blue.source, red.source, 'different presets have isolated cache entries');
    assert.ok(red.source.output[0] > red.source.output[2], 'red preset maps luminance toward red');
    assert.ok(blue.source.output[2] > blue.source.output[0], 'blue preset maps luminance toward blue');
    red.dispose();
    redAgain.dispose();
    blue.dispose();
  } finally {
    globalThis.ImageData = previousImageData;
    globalThis.document = previousDocument;
  }
});

test('gradient-map processor evicts least-recently-used full-size canvases within its pixel budget', async () => {
  const previousImageData = globalThis.ImageData;
  const previousDocument = globalThis.document;
  globalThis.ImageData = TestImageData;
  globalThis.document = {
    createElement() {
      let source = null;
      const canvas = {
        width: 0,
        height: 0,
        output: null,
        getContext() {
          return {
            drawImage(nextSource) {
              source = nextSource;
            },
            getImageData() {
              return new TestImageData(
                new Uint8ClampedArray(source.pixels),
                canvas.width,
                canvas.height,
              );
            },
            putImageData(result) {
              canvas.output = [...result.data];
            },
          };
        },
      };
      return canvas;
    },
  };

  try {
    const source = {
      width: 2,
      height: 1,
      pixels: new Uint8ClampedArray([
        64, 64, 64, 255,
        192, 192, 192, 255,
      ]),
    };
    const preset = (color) => ({
      mode: 'gradient-map',
      valueDefinition: {
        stops: [
          { offset: 0, color: '#000000' },
          { offset: 1, color },
        ],
      },
    });
    const processor = createGradientColorProcessor({ maxCachePixels: 4 });
    const first = await processor({ source, channel: preset('#ff0000') });
    first.dispose();
    const second = await processor({ source, channel: preset('#00ff00') });
    second.dispose();
    const third = await processor({ source, channel: preset('#0000ff') });
    third.dispose();

    assert.equal(first.source.width, 0, 'the least-recently-used canvas releases its backing store');
    assert.equal(first.source.height, 0);
    assert.equal(second.source.width, 2);
    assert.equal(third.source.width, 2);

    processor.clear();
    assert.equal(second.source.width, 0);
    assert.equal(third.source.width, 0);
  } finally {
    globalThis.ImageData = previousImageData;
    globalThis.document = previousDocument;
  }
});
