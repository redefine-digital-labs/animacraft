import test from 'node:test';
import assert from 'node:assert/strict';
import { responseBlobWithinLimit, responseBytesWithinLimit } from '../remote-read.js';

test('reads a bounded remote response as a typed Blob', async () => {
  const response = new Response(new Uint8Array([1, 2, 3, 4]), {
    headers: { 'content-type': 'image/png' },
  });
  const blob = await responseBlobWithinLimit(response, 4, 'Remote image');
  assert.equal(blob.size, 4);
  assert.equal(blob.type, 'image/png');
});

test('rejects an oversized declared response before reading it', async () => {
  const response = new Response('small body', {
    headers: { 'content-length': '100' },
  });
  await assert.rejects(responseBytesWithinLimit(response, 8, 'Remote file'), /exceeds/);
});

test('stops a chunked response when its streamed bytes exceed the limit', async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4]));
      controller.close();
    },
  }));
  await assert.rejects(responseBytesWithinLimit(response, 3, 'Remote file'), /exceeds/);
});
