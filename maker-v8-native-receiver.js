const SCHEMA = 'animacraft.native-receiver.v1';
const EXACT_ID = /^0x[0-9a-f]{64}$/;
const NONCE = /^[0-9a-f]{32}$/;
const MAX_BYTES = 512 * 1024;
const encoder = new TextEncoder();
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function scoped(rootId, signer) {
  for (const value of [rootId, signer]) if (!EXACT_ID.test(value ?? '') || /^0x0+$/.test(value)) {
    fail('MAKER_V8_NATIVE_RECEIVER_SCOPE_INVALID', 'An exact Maker and wallet are required.');
  }
}
function targetOrigin(value, development) {
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password
    || (value !== 'https://www.soulidity.ai'
      && !(development && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    fail('MAKER_V8_NATIVE_RECEIVER_ORIGIN_INVALID', 'Soulidity reception must use the configured product origin.');
  }
  return value;
}
function snapshot(value) {
  const text = JSON.stringify(value);
  if (encoder.encode(text).length > MAX_BYTES) fail('MAKER_V8_NATIVE_RECEIVER_SIZE_INVALID', 'The reception request is too large.');
  return JSON.parse(text);
}
function sidecarsOnly(rows) {
  if (!Array.isArray(rows) || rows.length !== 3) fail('MAKER_V8_NATIVE_RECEIVER_CONTENT_INVALID', 'All three native content sidecars are required.');
  const keys = ['version', 'mode', 'sealPackageId', 'documentId', 'encryptedDek', 'iv', 'cipher', 'mimeType', 'fileName', 'contentHash'];
  return rows.map(row => {
    if (!row || Object.keys(row).sort().join() !== 'kind,name,sidecar,versionIndex'
      || !row.sidecar || Object.keys(row.sidecar).some(key => !keys.includes(key))) {
      fail('MAKER_V8_NATIVE_RECEIVER_CONTENT_INVALID', 'Only encrypted content sidecars may be sent to Soulidity.');
    }
    return snapshot(row);
  });
}

/** Exact-origin browser transport only. Soulidity authenticates and verifies chain
 * evidence itself; neither the popup nor this transport performs a Soul mint. */
export function createMakerV8NativeReceiverV8({
  window: win = globalThis.window,
  crypto = globalThis.crypto,
  origin = 'https://www.soulidity.ai',
  development = false,
  timeoutMs = 30000,
  retryMs = 500,
} = {}) {
  targetOrigin(origin, development);
  if (!win || typeof win.open !== 'function' || typeof win.addEventListener !== 'function'
    || typeof crypto?.getRandomValues !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000
    || !Number.isInteger(retryMs) || retryMs < 1) fail('MAKER_V8_NATIVE_RECEIVER_CONFIG_INVALID', 'Browser reception is unavailable.');
  const random = () => [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');
  let active = null;
  const pending = new Map();
  function closePending(code) {
    for (const request of [...pending.values()]) request.reject(Object.assign(new Error('Reopen the Soulidity account page and retry this completion.'), { code }));
  }
  function open({ rootId, signer }) {
    scoped(rootId, signer);
    if (active && active.rootId === rootId && active.signer === signer && !active.popup.closed) {
      active.popup.focus?.();
      return;
    }
    closePending('MAKER_V8_NATIVE_RECEIVER_SCOPE_CHANGED');
    const nonce = random();
    const url = new URL('/integrations/animacraft', origin);
    url.search = new URLSearchParams({ source: 'animacraft-v8', root: rootId, owner: signer,
      returnOrigin: win.location.origin, returnNonce: nonce }).toString();
    // No secrets or content in the URL. Keep opener for the exact-origin bridge.
    const popup = win.open(url.href, `soulidity-native-${nonce}`);
    if (!popup) fail('MAKER_V8_NATIVE_RECEIVER_POPUP_BLOCKED', 'Allow the Soulidity account window, then retry. No new Soul was created by reception.');
    active = { popup, nonce, rootId, signer };
  }
  function message(event) {
    const row = event.data;
    if (!active || event.origin !== origin || event.source !== active.popup
      || !row || row.schemaVersion !== SCHEMA || row.type !== 'RESPONSE'
      || !NONCE.test(row.requestId ?? '') || row.nonce !== active.nonce
      || row.rootId !== active.rootId || row.signer !== active.signer) return;
    const request = pending.get(row.requestId);
    if (!request) return;
    try {
      snapshot(row);
      if (row.error) {
        // Do not forward arbitrary server/extension messages into user UI/logs.
        request.reject(Object.assign(new Error('Soulidity could not receive this request. Check the account page and retry the same completion.'),
          { code: 'MAKER_V8_NATIVE_RECEIVER_NOT_READY' }));
      } else request.resolve(row.result);
    } catch (error) { request.reject(error); }
  }
  win.addEventListener('message', message);
  function request(type, scope, payload) {
    scoped(scope.rootId, scope.signer);
    if (!active || active.rootId !== scope.rootId || active.signer !== scope.signer || active.popup.closed) open(scope);
    const session = active;
    const requestId = random();
    const packet = snapshot({ schemaVersion: SCHEMA, type, requestId, nonce: session.nonce,
      rootId: scope.rootId, signer: scope.signer, ...(payload ? { payload } : {}) });
    return new Promise((resolve, reject) => {
      let retry;
      const cleanup = () => { clearTimeout(timer); clearInterval(retry); pending.delete(requestId); };
      const timer = setTimeout(() => {
        cleanup(); reject(Object.assign(new Error('Soulidity reception timed out. Retry synchronization; do not create another Soul.'),
          { code: 'MAKER_V8_NATIVE_RECEIVER_TIMEOUT' }));
      }, timeoutMs);
      const finish = callback => value => { cleanup(); callback(value); };
      pending.set(requestId, { resolve: finish(resolve), reject: finish(reject) });
      const send = () => {
        if (session.popup.closed) {
          pending.get(requestId)?.reject(Object.assign(new Error('The Soulidity account window was closed. Reopen it and retry.'),
            { code: 'MAKER_V8_NATIVE_RECEIVER_CLOSED' }));
          return;
        }
        try { session.popup.postMessage(packet, origin); } catch (error) { pending.get(requestId)?.reject(error); }
      };
      // Repeated identical GET requests bridge popup startup. Mutating SYNC is
      // sent once; its timeout is recovered from the existing Complete journal.
      if (type === 'PREFLIGHT') retry = setInterval(send, retryMs);
      send();
    });
  }
  async function preflight(scope) {
    const result = await request('PREFLIGHT', scope);
    if (result?.ready !== true || result.rootId !== scope.rootId || result.signer !== scope.signer) {
      fail('MAKER_V8_NATIVE_RECEIVER_NOT_READY', 'Sign in to Soulidity with the same wallet and retry.');
    }
    return Object.freeze({ ready: true });
  }
  return Object.freeze({
    open, preflight,
    async sync({ rootId, signer, action, contentSidecars }) {
      scoped(rootId, signer);
      const event = action?.certificate?.evidence?.certifiedEvent?.fields;
      if (action?.status !== 'FINALIZED_SUCCESS' || action.action !== 'completeOutput'
        || action.certificate?.status !== 'CERTIFIED' || event?.root_id !== rootId || event?.original_holder !== signer
        || !EXACT_ID.test(event.soul_id ?? '') || action.certificate.transactionDigest !== action.transactionDigest
        || typeof action.transactionDigest !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(action.transactionDigest)) {
        fail('MAKER_V8_NATIVE_RECEIVER_COMPLETION_INVALID', 'A finalized native completion is required for reception.');
      }
      const payload = snapshot({ txDigest: action.transactionDigest, soulOnChainId: event.soul_id,
        contentSidecars: sidecarsOnly(contentSidecars) });
      await preflight({ rootId, signer });
      const result = await request('SYNC', { rootId, signer }, payload);
      if (result?.status !== 'COMPLETE' || result.soulId !== payload.soulOnChainId || result.transactionDigest !== payload.txDigest) {
        fail('MAKER_V8_NATIVE_RECEIVER_COMPLETION_INVALID', 'Soulidity returned a different completion; the original record is retained.');
      }
      return Object.freeze({ status: 'COMPLETE', soulId: result.soulId, transactionDigest: result.transactionDigest });
    },
    dispose() { closePending('MAKER_V8_NATIVE_RECEIVER_DISPOSED'); win.removeEventListener('message', message); active = null; },
  });
}
