import { spawn } from 'node:child_process';
import { constants as fsConstants, rmSync } from 'node:fs';
import { access } from 'node:fs/promises';

const DEFAULT_CHROME_CANDIDATES = Object.freeze([
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean));

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function installedChromium(candidates = DEFAULT_CHROME_CANDIDATES) {
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Keep checking the explicit, platform and CI paths in order.
    }
  }
  return null;
}

export function launchChromium(executable, args, {
  timeoutMs = 20_000,
  cleanupPaths = [],
} = {}) {
  const detached = process.platform !== 'win32';
  const child = spawn(executable, args, {
    detached,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let stopped = false;
  let killTimer = null;
  let guardian = null;
  const stop = ({ force = false } = {}) => {
    if (!child.pid) return;
    if (stopped && !force) return;
    stopped = true;
    try {
      if (detached) process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
      else child.kill(force ? 'SIGKILL' : 'SIGTERM');
    } catch {
      // A process which already exited is already stopped.
    }
    if (!force) {
      killTimer = setTimeout(() => {
        try {
          if (detached) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {
          // A process which honored SIGTERM is already stopped.
        }
      }, 2_000);
      killTimer.unref?.();
    }
  };
  const cleanupFilesystem = () => {
    for (const path of cleanupPaths) {
      try { rmSync(path, { recursive: true, force: true }); } catch {
        // Exit/signal cleanup is a final best-effort fallback. The test's
        // awaited finally block verifies normal cleanup exactly.
      }
    }
  };
  const relaySignal = (signal) => {
    stop({ force: true });
    cleanupFilesystem();
    disposeProcessCleanup();
    try { process.kill(process.pid, signal); } catch {
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }
  };
  const onSigint = () => relaySignal('SIGINT');
  const onSigterm = () => relaySignal('SIGTERM');
  const onExit = () => {
    stop({ force: true });
    cleanupFilesystem();
  };
  let processCleanupInstalled = true;
  const disposeProcessCleanup = () => {
    if (!processCleanupInstalled) return;
    processCleanupInstalled = false;
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    process.removeListener('exit', onExit);
    if (guardian?.pid) {
      try { process.kill(guardian.pid, 'SIGKILL'); } catch {
        // The guardian exits by itself when its owner or Chromium disappears.
      }
      guardian = null;
    }
  };
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  process.once('exit', onExit);
  if (child.pid && cleanupPaths.length) {
    // node:test workers can be terminated without receiving their own signal or
    // exit hooks. A tiny detached guardian therefore watches the worker PID and
    // owns the same narrow cleanup list. It has no product/network authority.
    const guardianSource = String.raw`
      const { existsSync, rmSync } = require('node:fs');
      const ownerPid = Number(process.argv[1]);
      const chromiumPid = Number(process.argv[2]);
      const cleanupPaths = JSON.parse(Buffer.from(process.argv[3], 'base64').toString('utf8'));
      const alive = (pid) => {
        try { process.kill(pid, 0); return true; } catch { return false; }
      };
      const groupAlive = (pid) => {
        try {
          if (process.platform === 'win32') process.kill(pid, 0);
          else process.kill(-pid, 0);
          return true;
        } catch { return false; }
      };
      const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const cleanup = async () => {
        try {
          if (process.platform === 'win32') process.kill(chromiumPid, 'SIGKILL');
          else process.kill(-chromiumPid, 'SIGKILL');
        } catch {}
        while (groupAlive(chromiumPid)) await pause(25);
        while (cleanupPaths.some((path) => existsSync(path))) {
          for (const path of cleanupPaths) {
            try { rmSync(path, { recursive: true, force: true }); } catch {}
          }
          if (cleanupPaths.some((path) => existsSync(path))) await pause(50);
        }
      };
      const interval = setInterval(async () => {
        if (alive(ownerPid)) return;
        clearInterval(interval);
        await cleanup();
        process.exit(0);
      }, 100);
      process.once('SIGINT', () => process.exit(130));
      process.once('SIGTERM', () => process.exit(143));
    `;
    guardian = spawn(process.execPath, [
      '-e',
      guardianSource,
      String(process.pid),
      String(child.pid),
      Buffer.from(JSON.stringify(cleanupPaths)).toString('base64'),
    ], {
      detached,
      stdio: 'ignore',
    });
    guardian.unref();
  }
  const closed = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      if (killTimer) clearTimeout(killTimer);
      resolve({ code, signal });
    });
  });
  const devtoolsUrl = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error(
        `Chromium DevTools endpoint timed out after ${timeoutMs} ms.\n${stdout}\n${stderr}`,
      ));
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
  return {
    child,
    closed,
    devtoolsUrl,
    stop,
    disposeProcessCleanup,
    output: () => `${stdout}\n${stderr}`,
  };
}

export async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let requestId = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.code}: ${message.error.message}`));
      else resolve(message.result);
      return;
    }
    listeners.forEach((listener) => listener(message));
  });
  const send = (method, params = {}, sessionId = undefined) => new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const onEvent = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const close = () => {
    for (const { reject } of pending.values()) reject(new Error('CDP socket closed.'));
    pending.clear();
    socket.close();
  };
  const session = (sessionId) => ({
    sessionId,
    send: (method, params = {}) => send(method, params, sessionId),
    onEvent(listener) {
      return onEvent((message) => {
        if (message.sessionId === sessionId) listener(message);
      });
    },
    close() {},
  });
  return { socket, send, onEvent, close, session };
}

function devtoolsHttpOrigin(browserDevtoolsUrl) {
  const endpoint = new URL(browserDevtoolsUrl);
  return `http://${endpoint.host}`;
}

export async function createRemotePage(browserDevtoolsUrl) {
  const response = await fetch(
    `${devtoolsHttpOrigin(browserDevtoolsUrl)}/json/new?${encodeURIComponent('about:blank')}`,
    { method: 'PUT' },
  );
  if (!response.ok) throw new Error(`Unable to create Chromium page target: ${response.status}.`);
  const target = await response.json();
  if (!target.webSocketDebuggerUrl) throw new Error('Chromium page target has no CDP socket.');
  return connectCdp(target.webSocketDebuggerUrl);
}

export async function closeRemotePage(browserDevtoolsUrl, targetId) {
  if (!targetId) return;
  try {
    await fetch(`${devtoolsHttpOrigin(browserDevtoolsUrl)}/json/close/${encodeURIComponent(targetId)}`);
  } catch {
    // Browser shutdown is the final cleanup fallback.
  }
}

export async function enablePage(cdp) {
  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('Network.enable'),
    cdp.send('Log.enable'),
  ]);
}

export async function navigatePage(cdp, url, { timeoutMs = 30_000 } = {}) {
  const loaded = new Promise((resolve) => {
    const unsubscribe = cdp.onEvent((message) => {
      if (message.method !== 'Page.loadEventFired') return;
      unsubscribe();
      resolve();
    });
  });
  const navigation = await cdp.send('Page.navigate', { url });
  if (navigation.errorText) throw new Error(`Chromium navigation failed: ${navigation.errorText}.`);
  let timeout;
  try {
    await Promise.race([
      loaded,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Chromium navigation timed out after ${timeoutMs} ms: ${url}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function evaluate(cdp, expression, {
  awaitPromise = true,
  returnByValue = true,
} = {}) {
  const evaluation = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue,
    userGesture: true,
  });
  if (evaluation.exceptionDetails) {
    const description = evaluation.exceptionDetails.exception?.description
      || evaluation.exceptionDetails.text
      || 'Unknown browser evaluation failure.';
    throw new Error(description);
  }
  return evaluation.result?.value;
}

export async function waitForExpression(cdp, expression, {
  timeoutMs = 30_000,
  intervalMs = 25,
  label = expression,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(cdp, expression);
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await pause(intervalMs);
  }
  throw new Error(`Chromium timed out waiting for ${label}. Last value: ${String(last)}.`);
}

export async function setViewport(cdp, viewport) {
  const width = Number(viewport.width);
  const height = Number(viewport.height);
  const mobile = viewport.mobile === true;
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
    positionX: 0,
    positionY: 0,
    dontSetVisibleSize: false,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', mobile
    ? { enabled: true, maxTouchPoints: 1 }
    : { enabled: false });
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
}

export async function capturePng(cdp, { clip, captureBeyondViewport = Boolean(clip) } = {}) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport,
    ...(clip ? {
      clip: {
        x: Number(clip.x),
        y: Number(clip.y),
        width: Number(clip.width),
        height: Number(clip.height),
        scale: 1,
      },
    } : {}),
  });
  return Buffer.from(result.data, 'base64');
}
