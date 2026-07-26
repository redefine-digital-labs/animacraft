function jsonSuiId(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{')) {
      try {
        return jsonSuiId(JSON.parse(trimmed));
      } catch {
        return '';
      }
    }
    return /^0x[0-9a-f]+$/i.test(trimmed) ? trimmed : '';
  }
  if (!value || typeof value !== 'object') return '';
  return jsonSuiId(value.id || value.bytes || value.address || value.fields);
}

function normalizedEventText(value) {
  return String(value || '').trim().toLowerCase();
}

export function publishedMakerFromIntentEvent(event, { creator, manifestBlobId } = {}) {
  const json = event?.contents?.json || {};
  const eventCreator = normalizedEventText(json.creator);
  const eventManifestBlobId = String(json.manifest_blob_id ?? json.manifestBlobId ?? '');
  if (!eventCreator
    || eventCreator !== normalizedEventText(creator)
    || !eventManifestBlobId
    || eventManifestBlobId !== String(manifestBlobId || '')) {
    return null;
  }
  const makerObjectId = jsonSuiId(json.maker_id || json.makerId);
  if (!makerObjectId) return null;
  return {
    makerObjectId,
    digest: String(
      event?.transaction?.digest
        || event?.transactionBlock?.digest
        || event?.transaction_block?.digest
        || '',
    ),
    creator: String(json.creator || ''),
    manifestBlobId: eventManifestBlobId,
  };
}
