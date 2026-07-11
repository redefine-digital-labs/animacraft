export async function responseBytesWithinLimit(response, maxBytes, label) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new Error(`${label} exceeds ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error(`${label} exceeds ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`${label} exceeds ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

export async function responseBlobWithinLimit(response, maxBytes, label) {
  const bytes = await responseBytesWithinLimit(response, maxBytes, label);
  return new Blob([bytes], { type: response.headers.get('content-type') || 'application/octet-stream' });
}
