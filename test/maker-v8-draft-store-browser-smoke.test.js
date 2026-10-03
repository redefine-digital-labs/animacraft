import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createServer as createViteServer } from 'vite';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const fixturePath = '/test/fixtures/maker-v8-draft-store-browser-smoke.html';
const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

async function installedChrome() {
  for (const candidate of chromeCandidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

function launchChrome(executable, args, timeoutMs = 15_000) {
  const detached = process.platform !== 'win32';
  const child = spawn(executable, args, { detached, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const stop = () => {
    if (!child.pid) return;
    try {
      if (detached) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {}
  };
  const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  const devtoolsUrl = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`Chromium DevTools endpoint timed out after ${timeoutMs} ms.\n${stdout}\n${stderr}`));
    }, timeoutMs);
    const inspect = (chunk, stream) => {
      if (stream === 'stdout') stdout += chunk;
      else stderr += chunk;
      const match = `${stdout}\n${stderr}`.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => inspect(chunk, 'stdout'));
    child.stderr.on('data', (chunk) => inspect(chunk, 'stderr'));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return { child, closed, devtoolsUrl, stop, output: () => `${stdout}\n${stderr}` };
}

async function pageWebSocket(browserDevtoolsUrl, expectedUrl, timeoutMs = 15_000) {
  const endpoint = new URL(browserDevtoolsUrl);
  const listUrl = `http://${endpoint.host}/json/list`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(listUrl).then((response) => response.json());
      const page = targets.find((target) => target.type === 'page' && target.url === expectedUrl);
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Chromium did not expose a page target for ${expectedUrl}.`);
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let requestId = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(`${message.error.code}: ${message.error.message}`));
    else resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, send };
}

async function waitForTerminalBody(send, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const evaluation = await send('Runtime.evaluate', {
      expression: `({
        status: document.body?.dataset.status || null,
        restoredRevision: document.body?.dataset.restoredRevision || null,
        restoredBytes: document.body?.dataset.restoredBytes || null,
        finalRevision: document.body?.dataset.finalRevision || null,
        versionCount: document.body?.dataset.versionCount || null,
        assetVersionCount: document.body?.dataset.assetVersionCount || null,
        blobCount: document.body?.dataset.blobCount || null,
        errorName: document.body?.dataset.errorName || null,
        errorCode: document.body?.dataset.errorCode || null,
        result: document.querySelector('#result')?.textContent || null,
        html: document.documentElement?.outerHTML || null,
      })`,
      returnByValue: true,
    });
    const state = evaluation.result?.value;
    if (state?.status === 'pass' || state?.status === 'fail') return state;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Chromium fixture did not reach a terminal state.');
}

test('real Chromium IndexedDB keeps SHA work outside transactions and restores same-length bytes', {
  timeout: 60_000,
}, async (context) => {
  const chrome = await installedChrome();
  if (!chrome) {
    context.skip('No installed Chromium executable; the smoke does not download a browser.');
    return;
  }

  const profile = await mkdtemp(join(tmpdir(), 'maker-v8-chromium-'));
  let chromeProcess;
  const vite = await createViteServer({
    root: repositoryRoot,
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  try {
    await vite.listen();
    const address = vite.httpServer?.address();
    assert.ok(address && typeof address === 'object', 'Vite did not expose its local address.');
    const url = `http://127.0.0.1:${address.port}${fixturePath}`;
    const args = [
      '--headless=new',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-gpu',
      '--no-default-browser-check',
      '--no-first-run',
      '--no-proxy-server',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      url,
    ];
    if (typeof process.getuid === 'function' && process.getuid() === 0) args.unshift('--no-sandbox');

    chromeProcess = launchChrome(chrome, args);
    const browserDevtoolsUrl = await chromeProcess.devtoolsUrl;
    const pageSocketUrl = await pageWebSocket(browserDevtoolsUrl, url);
    const cdp = await connectCdp(pageSocketUrl);
    try {
      await cdp.send('Runtime.enable');
      const state = await waitForTerminalBody(cdp.send);
      assert.equal(state.status, 'pass', JSON.stringify(state, null, 2));
      assert.equal(state.restoredRevision, '4');
      assert.equal(state.restoredBytes, 'EQ==');
      assert.equal(state.finalRevision, '103');
      assert.equal(state.versionCount, '100');
      assert.equal(state.assetVersionCount, '100');
      assert.equal(state.blobCount, '1');
      assert.doesNotMatch(state.html, /TransactionInactiveError/);
    } finally {
      cdp.socket.close();
    }
  } finally {
    chromeProcess?.stop();
    if (chromeProcess) await chromeProcess.closed;
    await vite.close();
    await rm(profile, { recursive: true, force: true });
  }
});
