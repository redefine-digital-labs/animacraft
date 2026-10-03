import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createServer as createViteServer } from 'vite';

import {
  capturePng,
  connectCdp,
  evaluate,
  installedChromium,
  launchChromium,
  navigatePage,
  setViewport,
  waitForExpression,
} from './helpers/chromium-cdp.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const fixtureRelativePath = 'test/fixtures/approved-product-browser.html';
const manifestRelativePath = 'test/fixtures/approved-product-browser-manifest.json';
const fixtureUrlPath = '/__acceptance_target_probe__.html';
const manifest = JSON.parse(await readFile(
  new URL('./fixtures/approved-product-browser-manifest.json', import.meta.url),
  'utf8',
));
const expectedCreatorTabs = Object.freeze([
  'structure', 'info', 'layers', 'colors', 'rules', 'expansions',
  'composable', 'commerce', 'soul', 'validate',
]);
const semanticProbeMarker = '__animacraft_acceptance_semantic_probe__=';
const grpcServiceInfoReadBody = 'AAAAAAA=';
const grpcListOwnedReadBody = 'AAAAAEQKQjB4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OA==';
const isSemanticProbeUrl = (url) => String(url || '').includes(semanticProbeMarker);
const isPreloadProbeUrl = (url) => String(url || '').includes('/__acceptance_write_probe__/')
  || String(url || '').includes(`${semanticProbeMarker}preload-`);
const isCdpProbeUrl = (url) => String(url || '').includes('/__acceptance_cdp_probe__/')
  || String(url || '').includes(`${semanticProbeMarker}cdp-`);

function isSafeNetworkMethod(method) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase());
}

function graphqlUnicodeScalarWidth(source, index) {
  const first = source.charCodeAt(index);
  if (first >= 0xd800 && first <= 0xdbff) {
    const second = source.charCodeAt(index + 1);
    return second >= 0xdc00 && second <= 0xdfff ? 2 : 0;
  }
  return first >= 0xdc00 && first <= 0xdfff ? 0 : 1;
}

function tokenizeGraphqlDocument(source) {
  if (typeof source !== 'string' || !source.trim() || source.length > 1_048_576) return null;
  const tokens = [];
  for (let index = 0; index < source.length;) {
    const character = source[index];
    if (/[,\u0009\u000A\u000D\u0020\uFEFF]/u.test(character)) { index += 1; continue; }
    if (character === '#') {
      while (index < source.length && !['\n', '\r'].includes(source[index])) {
        const width = graphqlUnicodeScalarWidth(source, index);
        if (!width || (source.charCodeAt(index) < 0x20 && source[index] !== '\t')) return null;
        index += width;
      }
      continue;
    }
    if (source.startsWith('"""', index)) {
      index += 3;
      let closed = false;
      while (index < source.length) {
        if (source.startsWith('\\"""', index)) { index += 4; continue; }
        if (source.startsWith('"""', index)) { index += 3; closed = true; break; }
        const width = graphqlUnicodeScalarWidth(source, index);
        if (!width) return null;
        const code = source.charCodeAt(index);
        if (code < 0x20 && !['\t', '\n', '\r'].includes(source[index])) return null;
        index += width;
      }
      if (!closed) return null;
      tokens.push({ kind: 'STRING', value: '' });
      continue;
    }
    if (character === '"') {
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === '\\') {
          const escape = source[index + 1];
          if ('"\\/bfnrt'.includes(escape)) { index += 2; continue; }
          if (escape !== 'u') return null;
          if (source[index + 2] === '{') {
            const end = source.indexOf('}', index + 3);
            const scalar = end < 0 ? '' : source.slice(index + 3, end);
            const value = /^[0-9A-Fa-f]{1,6}$/.test(scalar) ? Number.parseInt(scalar, 16) : -1;
            if (value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return null;
            index = end + 1;
            continue;
          }
          const escapedCode = source.slice(index + 2, index + 6);
          if (!/^[0-9A-Fa-f]{4}$/.test(escapedCode)) return null;
          const escapedValue = Number.parseInt(escapedCode, 16);
          if (escapedValue >= 0xd800 && escapedValue <= 0xdbff) {
            const lowCode = source.slice(index + 8, index + 12);
            const lowValue = /^[0-9A-Fa-f]{4}$/.test(lowCode)
              ? Number.parseInt(lowCode, 16) : -1;
            if (source[index + 6] !== '\\' || source[index + 7] !== 'u'
              || lowValue < 0xdc00 || lowValue > 0xdfff) return null;
            index += 12;
            continue;
          }
          if (escapedValue >= 0xdc00 && escapedValue <= 0xdfff) return null;
          index += 6;
          continue;
        }
        if (source[index] === '"') { index += 1; closed = true; break; }
        const width = graphqlUnicodeScalarWidth(source, index);
        if (!width) return null;
        if (source.charCodeAt(index) < 0x20) return null;
        index += width;
      }
      if (!closed) return null;
      tokens.push({ kind: 'STRING', value: '' });
      continue;
    }
    const name = source.slice(index).match(/^[_A-Za-z][_0-9A-Za-z]*/)?.[0];
    if (name) {
      tokens.push({ kind: 'NAME', value: name });
      index += name.length;
      continue;
    }
    const number = source.slice(index).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/)?.[0];
    if (number) {
      const following = source[index + number.length] || '';
      if (/[_0-9A-Za-z.]/.test(following)) return null;
      tokens.push({
        kind: /[.eE]/.test(number) ? 'FLOAT' : 'INT',
        value: number,
      });
      index += number.length;
      continue;
    }
    if (source.startsWith('...', index)) {
      tokens.push({ kind: 'PUNCTUATOR', value: '...' });
      index += 3;
      continue;
    }
    if ('!$():=@[]{|}&'.includes(character)) {
      tokens.push({ kind: 'PUNCTUATOR', value: character });
      index += 1;
      continue;
    }
    return null;
  }
  return tokens.length && tokens.length <= 100_000 ? tokens : null;
}

function parseGraphqlExecutableDocument(source) {
  const tokens = tokenizeGraphqlDocument(source);
  if (!tokens) return null;
  let cursor = 0;
  const operations = [];
  const fragments = new Map();
  const token = (offset = 0) => tokens[cursor + offset] || null;
  const punctuator = (value) => token()?.kind === 'PUNCTUATOR' && token().value === value;
  const name = (value) => token()?.kind === 'NAME'
    && (value === undefined || token().value === value);
  const takePunctuator = (value) => {
    if (!punctuator(value)) return false;
    cursor += 1;
    return true;
  };
  const takeName = (value) => {
    if (!name(value)) return null;
    const result = token().value;
    cursor += 1;
    return result;
  };
  const parseValue = (constant, depth = 0) => {
    if (depth > 256) return false;
    if (takePunctuator('$')) return !constant && takeName() !== null;
    if (['INT', 'FLOAT', 'STRING'].includes(token()?.kind)) {
      cursor += 1;
      return true;
    }
    if (takeName() !== null) return true;
    if (takePunctuator('[')) {
      while (!punctuator(']')) {
        if (!token() || !parseValue(constant, depth + 1)) return false;
      }
      return takePunctuator(']');
    }
    if (takePunctuator('{')) {
      while (!punctuator('}')) {
        if (!token() || takeName() === null || !takePunctuator(':')
          || !parseValue(constant, depth + 1)) return false;
      }
      return takePunctuator('}');
    }
    return false;
  };
  const parseArguments = (constant = false) => {
    if (!takePunctuator('(')) return false;
    let count = 0;
    while (!punctuator(')')) {
      if (!token() || takeName() === null || !takePunctuator(':')
        || !parseValue(constant)) return false;
      count += 1;
    }
    return count > 0 && takePunctuator(')');
  };
  const parseDirectives = (constant = false) => {
    while (takePunctuator('@')) {
      if (takeName() === null || (punctuator('(') && !parseArguments(constant))) return false;
    }
    return true;
  };
  const parseType = (depth = 0) => {
    if (depth > 256) return false;
    if (takePunctuator('[')) {
      if (!parseType(depth + 1) || !takePunctuator(']')) return false;
    } else if (takeName() === null) return false;
    takePunctuator('!');
    return true;
  };
  const parseVariableDefinitions = () => {
    if (!takePunctuator('(')) return false;
    const variables = new Set();
    let count = 0;
    while (!punctuator(')')) {
      if (!token() || !takePunctuator('$')) return false;
      const variableName = takeName();
      if (variableName === null || variables.has(variableName)) return false;
      variables.add(variableName);
      if (!takePunctuator(':') || !parseType()) return false;
      if (takePunctuator('=') && !parseValue(true)) return false;
      if (!parseDirectives(true)) return false;
      count += 1;
    }
    return count > 0 && takePunctuator(')');
  };
  const parseSelectionSet = (spreads, depth = 0) => {
    if (depth > 256 || !takePunctuator('{')) return false;
    let count = 0;
    while (!punctuator('}')) {
      if (!token()) return false;
      if (takePunctuator('...')) {
        if (takeName('on') !== null) {
          if (takeName() === null || !parseDirectives()
            || !parseSelectionSet(spreads, depth + 1)) return false;
        } else if (name()) {
          const fragmentName = takeName();
          if (fragmentName === 'on' || !parseDirectives()) return false;
          spreads.push(fragmentName);
        } else {
          if (!parseDirectives() || !parseSelectionSet(spreads, depth + 1)) return false;
        }
      } else {
        if (!name()) return false;
        takeName();
        if (takePunctuator(':') && takeName() === null) return false;
        if (punctuator('(') && !parseArguments()) return false;
        if (!parseDirectives()) return false;
        if (punctuator('{') && !parseSelectionSet(spreads, depth + 1)) return false;
      }
      count += 1;
    }
    return count > 0 && takePunctuator('}');
  };
  while (cursor < tokens.length) {
    if (operations.length + fragments.size >= 4_096) return null;
    if (punctuator('{')) {
      const spreads = [];
      if (!parseSelectionSet(spreads)) return null;
      operations.push({ operation: 'query', name: null, spreads });
      continue;
    }
    if (name('fragment')) {
      takeName('fragment');
      const fragmentName = takeName();
      if (fragmentName === null || fragmentName === 'on' || fragments.has(fragmentName)
        || takeName('on') === null || takeName() === null) return null;
      const spreads = [];
      if (!parseDirectives() || !parseSelectionSet(spreads)) return null;
      fragments.set(fragmentName, spreads);
      continue;
    }
    if (!['query', 'mutation', 'subscription'].includes(token()?.value)
      || token()?.kind !== 'NAME') return null;
    const operation = takeName();
    const operationName = name() ? takeName() : null;
    if (punctuator('(') && !parseVariableDefinitions()) return null;
    const spreads = [];
    if (!parseDirectives() || !parseSelectionSet(spreads)) return null;
    operations.push({ operation, name: operationName, spreads });
  }
  const referencedFragments = new Set();
  const visiting = new Set();
  const visitFragment = (fragmentName, depth = 0) => {
    if (depth > 256 || !fragments.has(fragmentName) || visiting.has(fragmentName)) return false;
    if (referencedFragments.has(fragmentName)) return true;
    visiting.add(fragmentName);
    for (const dependency of fragments.get(fragmentName)) {
      if (!visitFragment(dependency, depth + 1)) return false;
    }
    visiting.delete(fragmentName);
    referencedFragments.add(fragmentName);
    return true;
  };
  for (const operation of operations) {
    for (const fragmentName of operation.spreads) {
      if (!visitFragment(fragmentName)) return null;
    }
  }
  if (referencedFragments.size !== fragments.size) return null;
  return { operations, fragmentCount: fragments.size };
}

function singleGraphqlOperationKind(source, operationName = null) {
  let document;
  try { document = parseGraphqlExecutableDocument(source); } catch { return 'invalid'; }
  if (!document || document.operations.length !== 1) return 'invalid';
  const operation = document.operations[0];
  if (operationName !== null && (
    typeof operationName !== 'string'
    || !/^[_A-Za-z][_0-9A-Za-z]*$/.test(operationName)
    || operation.name !== operationName
  )) return 'invalid';
  return operation.operation;
}

function graphqlRequestOperationKind(request) {
  const method = String(request?.method || 'GET').toUpperCase();
  let target;
  try { target = new URL(String(request?.url || ''), 'http://acceptance.invalid'); } catch { return ''; }
  if (target.pathname !== '/graphql') return '';
  if (method === 'GET' || method === 'HEAD') return 'invalid';
  if (method !== 'POST') return '';
  const rawBody = Object.prototype.hasOwnProperty.call(request || {}, 'body')
    ? request.body : request?.postData;
  if (typeof rawBody !== 'string') return 'invalid';
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return 'invalid'; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'invalid';
  const keys = Object.keys(payload);
  if (!keys.includes('query')
    || keys.some((key) => !['query', 'variables', 'operationName'].includes(key))
    || typeof payload.query !== 'string'
    || (Object.hasOwn(payload, 'variables') && payload.variables !== null
      && (typeof payload.variables !== 'object' || Array.isArray(payload.variables)))
    || (Object.hasOwn(payload, 'operationName') && payload.operationName !== null
      && (typeof payload.operationName !== 'string' || !payload.operationName))) {
    return 'invalid';
  }
  return singleGraphqlOperationKind(payload.query, payload.operationName ?? null);
}

function grpcWebTextPayload(request) {
  const rawBody = Object.prototype.hasOwnProperty.call(request || {}, 'body')
    ? request.body : request?.postData;
  if (typeof rawBody !== 'string'
    || rawBody.length < 8
    || rawBody.length > 1_048_576
    || rawBody.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(rawBody)) {
    return null;
  }
  let binary;
  try {
    binary = globalThis.atob(rawBody);
    if (globalThis.btoa(binary) !== rawBody) return null;
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length < 5 || bytes[0] !== 0) return null;
  const declaredLength = (bytes[1] * 16_777_216)
    + (bytes[2] * 65_536) + (bytes[3] * 256) + bytes[4];
  return declaredLength === bytes.length - 5 ? bytes.subarray(5) : null;
}

function readCanonicalProtobufVarint(bytes, start, maximum) {
  let value = 0;
  let multiplier = 1;
  for (let index = start; index < bytes.length && index < start + 5; index += 1) {
    const byte = bytes[index];
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) {
      if (index > start && byte === 0) return null;
      return value <= maximum ? { value, next: index + 1 } : null;
    }
    multiplier *= 128;
  }
  return null;
}

function strictUtf8(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}

function validFieldMaskPayload(bytes) {
  let cursor = 0;
  let paths = 0;
  while (cursor < bytes.length) {
    if (bytes[cursor] !== 0x0a) return false;
    const length = readCanonicalProtobufVarint(bytes, cursor + 1, bytes.length);
    if (!length || length.value < 1 || length.next + length.value > bytes.length) return false;
    const path = strictUtf8(bytes.subarray(length.next, length.next + length.value));
    if (!path || !/^[A-Za-z][A-Za-z0-9_.]*$/.test(path)) return false;
    cursor = length.next + length.value;
    paths += 1;
  }
  return paths > 0;
}

function validListOwnedObjectsPayload(bytes) {
  let cursor = 0;
  const seen = new Set();
  while (cursor < bytes.length) {
    const tag = bytes[cursor];
    const field = ({ 0x0a: 1, 0x10: 2, 0x1a: 3, 0x22: 4, 0x2a: 5 })[tag];
    if (!field || seen.has(field)) return false;
    seen.add(field);
    cursor += 1;
    if (field === 2) {
      const pageSize = readCanonicalProtobufVarint(bytes, cursor, 1_000);
      if (!pageSize || pageSize.value < 1) return false;
      cursor = pageSize.next;
      continue;
    }
    const length = readCanonicalProtobufVarint(bytes, cursor, bytes.length);
    if (!length || length.next + length.value > bytes.length) return false;
    const value = bytes.subarray(length.next, length.next + length.value);
    if (field === 1) {
      const owner = strictUtf8(value);
      if (!owner || !/^0x[0-9a-fA-F]{64}$/.test(owner)) return false;
    } else if (field === 3) {
      if (value.length < 1) return false;
    } else if (field === 4) {
      if (!validFieldMaskPayload(value)) return false;
    } else if (field === 5) {
      const objectType = strictUtf8(value);
      if (!objectType || objectType.length > 2_048 || /[\u0000-\u001f\u007f]/.test(objectType)) return false;
    }
    cursor = length.next + length.value;
  }
  return seen.has(1);
}

function semanticNetworkReadKind(request) {
  const method = String(request?.method || 'GET').toUpperCase();
  if (method !== 'POST') return '';
  let target;
  try { target = new URL(String(request?.url || ''), 'http://acceptance.invalid'); } catch { return ''; }
  if (!['http:', 'https:'].includes(target.protocol)) return '';
  const graphqlKind = graphqlRequestOperationKind(request);
  if (graphqlKind === 'query') return 'graphql-query';
  if (graphqlKind) return '';
  if (![
    '/sui.rpc.v2.LedgerService/GetServiceInfo',
    '/sui.rpc.v2.StateService/ListOwnedObjects',
  ].includes(target.pathname)) return '';
  const payload = grpcWebTextPayload(request);
  if (!payload) return '';
  if (target.pathname === '/sui.rpc.v2.LedgerService/GetServiceInfo') {
    return payload.length === 0 ? 'grpc-read' : '';
  }
  if (!validListOwnedObjectsPayload(payload)) return '';
  return 'grpc-read';
}

function suspiciousNetworkRequest(request) {
  const url = String(request?.url || '');
  const method = String(request?.method || 'GET').toUpperCase();
  const rawBody = Object.prototype.hasOwnProperty.call(request || {}, 'body')
    ? request.body : request?.postData;
  const body = typeof rawBody === 'string' ? rawBody : '';
  const aggregate = (url + '\n' + body).toLowerCase();
  const staticGet = method === 'GET'
    && /\.(?:m?js|css|png|jpe?g|gif|svg|woff2?|ico)(?:[?#]|$)/i.test(url);
  if (/^wss?:/i.test(url)) return 'websocket';
  if (!staticGet && (/\bjsonrpc\b|"jsonrpc"|(?:^|[/?_.-])json-rpc(?:[/?_.\s-]|$)/i.test(aggregate))) return 'jsonrpc';
  if (!staticGet && (/executetransaction|signandexecutetransaction|(?:^|[/?_.-])execute(?:[/?_.\s-]|$)/i.test(aggregate))) return 'execute';
  const graphqlKind = graphqlRequestOperationKind(request);
  if (graphqlKind === 'mutation') return 'graphql-mutation';
  if (graphqlKind === 'subscription') return 'graphql-subscription';
  if (graphqlKind === 'invalid') return 'network-write';
  if (!isSafeNetworkMethod(method)
    && /walrus|publisher|v1\/blobs|store[_-]?blob|write[_-]?blob/i.test(aggregate)) return 'walrus-write';
  return '';
}

function forbiddenNetworkRequest(request, allowedOrigins) {
  const suspicious = suspiciousNetworkRequest(request);
  if (suspicious) return suspicious;
  const method = String(request?.method || 'GET').toUpperCase();
  if (!isSafeNetworkMethod(method)) {
    return semanticNetworkReadKind(request) ? 'external-network-read' : 'network-write';
  }
  try {
    const target = new URL(String(request?.url || ''));
    const allowed = allowedOrigins instanceof Set
      ? allowedOrigins : new Set([].concat(allowedOrigins || []));
    if (['http:', 'https:'].includes(target.protocol) && !allowed.has(target.origin)) {
      return 'external-network';
    }
  } catch {
    // Non-network schemes continue through the normal request classifier.
  }
  return '';
}

function networkClassifierSource() {
  return [
    isSafeNetworkMethod,
    graphqlUnicodeScalarWidth,
    tokenizeGraphqlDocument,
    parseGraphqlExecutableDocument,
    singleGraphqlOperationKind,
    graphqlRequestOperationKind,
    grpcWebTextPayload,
    readCanonicalProtobufVarint,
    strictUtf8,
    validFieldMaskPayload,
    validListOwnedObjectsPayload,
    semanticNetworkReadKind,
    suspiciousNetworkRequest,
    forbiddenNetworkRequest,
  ].map((implementation) => implementation.toString()).join('\n');
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonicalJson = (value) => JSON.stringify(value);
const cleanName = (value) => String(value).replace(/[^A-Za-z0-9._-]+/g, '_');
const staleAcceptanceResourceAgeMs = 5 * 60 * 1_000;
const acceptanceTempPrefixes = Object.freeze([
  'animacraft-approved-browser-run-',
  'animacraft-approved-chromium-',
  'animacraft-approved-vite-',
]);

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: options.stdio || ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(' ')} failed (${code ?? signal}).\n${stdout}\n${stderr}`));
    });
  });
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function processRecord(pid) {
  try {
    const { stdout } = await runProcess('ps', [
      '-p', String(pid), '-o', 'pgid=', '-o', 'command=',
    ]);
    const match = stdout.trim().match(/^(\d+)\s+([\s\S]+)$/);
    return match ? { pid, pgid: Number(match[1]), command: match[2] } : null;
  } catch {
    return null;
  }
}

async function processesReferencing(path) {
  const { stdout } = await runProcess('ps', ['-axo', 'pid=', '-o', 'pgid=', '-o', 'command=']);
  return stdout.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\s\S]+)$/);
    if (!match || Number(match[1]) === process.pid || !match[3].includes(path)) return [];
    return [{ pid: Number(match[1]), pgid: Number(match[2]), command: match[3] }];
  });
}

async function waitForProcessExit(pid, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return true;
    await pause(50);
  }
  return !processIsAlive(pid);
}

async function cleanupStaleAcceptanceResources() {
  const temporaryRoot = tmpdir();
  const entries = await readdir(temporaryRoot, { withFileTypes: true });
  const evidence = {
    killedPids: [],
    removedRoots: [],
    skippedFreshRoots: [],
    skippedUnsafeRoots: [],
  };
  for (const entry of entries) {
    if (!entry.isDirectory()
      || !acceptanceTempPrefixes.some((prefix) => entry.name.startsWith(prefix))) continue;
    const root = join(temporaryRoot, entry.name);
    let metadata;
    try { metadata = await stat(root); } catch { continue; }
    if (Date.now() - metadata.mtimeMs < staleAcceptanceResourceAgeMs) {
      evidence.skippedFreshRoots.push(root);
      continue;
    }
    const profileRoot = entry.name.startsWith('animacraft-approved-chromium-')
      ? root
      : join(root, 'chromium-profile');
    let chromiumPid = null;
    try {
      const lockTarget = await readlink(join(profileRoot, 'SingletonLock'));
      chromiumPid = Number(lockTarget.match(/-(\d+)$/)?.[1] || 0) || null;
    } catch {
      // A missing lock means Chromium is already gone; the stale root can be removed.
    }
    if (chromiumPid) {
      const record = await processRecord(chromiumPid);
      if (record) {
        const ownsExactProfile = record.command.includes(`--user-data-dir=${profileRoot}`);
        const isChromium = /(?:Google Chrome|Chromium)/.test(record.command);
        const isDetachedLeader = record.pgid === chromiumPid;
        if (!ownsExactProfile || !isChromium || !isDetachedLeader) {
          evidence.skippedUnsafeRoots.push({ root, chromiumPid, record });
          continue;
        }
        try { process.kill(-chromiumPid, 'SIGTERM'); } catch {
          // The verified process may exit between ps and signal delivery.
        }
        if (!await waitForProcessExit(chromiumPid)) {
          try { process.kill(-chromiumPid, 'SIGKILL'); } catch {}
          assert.equal(
            await waitForProcessExit(chromiumPid),
            true,
            `Stale detached Chromium group ${chromiumPid} survived SIGKILL.`,
          );
        }
        evidence.killedPids.push(chromiumPid);
      }
    }
    const activeReferences = await processesReferencing(root);
    if (activeReferences.length) {
      evidence.skippedUnsafeRoots.push({ root, activeReferences });
      continue;
    }
    await rm(root, { recursive: true, force: true });
    assert.equal(await pathExists(root), false, `Stale acceptance resource survived cleanup: ${root}`);
    evidence.removedRoots.push(root);
  }
  return evidence;
}


async function startFixtureServer(root, cacheDir) {
  const requestLog = [];
  const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const exactPublicDir = join(root, 'public-v8');
  const optimizeCandidates = [
    ...Object.keys(rootPackage.dependencies || {}),
    '@nanostores/lit',
    'dataloader',
    'poseidon-lite',
  ];
  const optimizeIncludes = [];
  for (const dependency of [...new Set(optimizeCandidates)].sort()) {
    const packagePath = join(root, 'node_modules', dependency, 'package.json');
    if (!(await pathExists(packagePath))) continue;
    const dependencyPackage = JSON.parse(await readFile(packagePath, 'utf8'));
    const exportsField = dependencyPackage.exports;
    const hasRootExport = exportsField === undefined
      || typeof exportsField === 'string'
      || Array.isArray(exportsField)
      || (exportsField && typeof exportsField === 'object'
        && (Object.hasOwn(exportsField, '.')
          || Object.keys(exportsField).every((key) => !key.startsWith('.'))));
    if (hasRootExport) optimizeIncludes.push(dependency);
  }
  for (const subpath of [
    '@mysten/dapp-kit-core/web',
    '@mysten/sui/bcs',
    '@mysten/sui/grpc',
    '@mysten/sui/transactions',
    '@mysten/sui/utils',
  ]) {
    const packageName = subpath.split('/').slice(0, 2).join('/');
    const packagePath = join(root, 'node_modules', packageName, 'package.json');
    if (!(await pathExists(packagePath))) continue;
    const dependencyPackage = JSON.parse(await readFile(packagePath, 'utf8'));
    if (dependencyPackage.exports
      && Object.hasOwn(dependencyPackage.exports, `./${subpath.split('/').slice(2).join('/')}`)) {
      optimizeIncludes.push(subpath);
    }
  }
  const server = await createViteServer({
    root,
    configFile: false,
    // Execute the current production entry and its actual public configuration.
    publicDir: exactPublicDir,
    cacheDir,
    logLevel: 'silent',
    appType: 'spa',
    optimizeDeps: {
      // The raw fixture deliberately performs deep dynamic imports after
      // navigation. Discovery-time optimizer invalidation would otherwise
      // turn a valid exact dependency into Vite's transient 504 "Outdated
      // Optimize Dep" response. Serve each tree's own ESM graph directly.
      noDiscovery: true,
      // CommonJS transitive dependencies require Vite's named-export interop;
      // each server optimizes only the graph rooted in its own exact manifest.
      include: optimizeIncludes,
    },
    plugins: [{
      name: 'animacraft-approved-browser-raw-fixture',
      enforce: 'pre',
      transformIndexHtml: {
        order: 'post',
        handler(html) {
          // Keep every script from the checked-in product document. Remove
          // only Vite's injected development HMR client: it is not part of
          // either production entry and otherwise opens an infrastructure WS.
          return html.replace(
            /\s*<script type="module" src="\/@vite\/client"><\/script>\s*/g,
            '\n',
          );
        },
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          const requestUrl = String(request.url || '/');
          const pathname = new URL(requestUrl, 'http://127.0.0.1').pathname;
          const method = String(request.method || 'GET').toUpperCase();
          if (!['GET', 'HEAD', 'OPTIONS'].includes(method)
            || pathname.startsWith('/__acceptance_write_probe__/')
            || pathname.startsWith('/__acceptance_cdp_probe__/')
            || requestUrl.includes(semanticProbeMarker)) {
            requestLog.push({ method, pathname });
          }
          if (pathname.startsWith('/__acceptance_write_probe__/')
            || pathname.startsWith('/__acceptance_cdp_probe__/')) {
            response.statusCode = 204;
            response.end();
            return;
          }
          if (pathname === '/__acceptance_target_service_worker__.js') {
            response.statusCode = 200;
            response.setHeader('content-type', 'text/javascript; charset=utf-8');
            response.setHeader('cache-control', 'no-store');
            response.setHeader('service-worker-allowed', '/');
            response.end(`
              ${deterministicPreload(manifest.fixedSeed)}
              self.addEventListener('install', () => self.skipWaiting());
              self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
              self.addEventListener('message', (event) => {
                const waitForCdpBarrier = async () => {
                  for (let attempt = 0; attempt < 500; attempt += 1) {
                    if (globalThis.__ANIMACRAFT_CDP_TARGET_PROTECTED__ === true) return;
                    await new Promise((resolve) => setTimeout(resolve, 10));
                  }
                  throw new Error('ANIMACRAFT_ACCEPTANCE_CDP_TARGET_BARRIER_MISSING');
                };
                const result = waitForCdpBarrier()
                  .then(() => fetch('/__acceptance_write_probe__/target-service_worker', {
                    method: 'POST', body: 'service_worker',
                  }))
                  .then(() => ({ kind: 'service_worker', blocked: false }))
                  .catch((error) => ({
                    kind: 'service_worker', blocked: String(error?.message || error),
                  }));
                event.waitUntil(result.then((value) => {
                  if (event.ports?.[0]) event.ports[0].postMessage(value);
                  else event.source?.postMessage(value);
                }));
              });
            `);
            return;
          }
          if (pathname !== fixtureUrlPath) {
            next();
            return;
          }
          try {
            const fixturePath = join(root, fixtureRelativePath);
            const bytes = await readFile(fixturePath);
            response.statusCode = 200;
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.setHeader('cache-control', 'no-store');
            response.end(bytes);
          } catch (error) {
            next(error);
          }
        });
      },
    }],
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      hmr: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address === 'object', 'Vite did not expose a local address.');
  return { server, origin: `http://127.0.0.1:${address.port}`, requestLog };
}

function deterministicPreload(seed) {
  return `(() => {
    ${networkClassifierSource()}
    const seed = Object.freeze(${JSON.stringify(seed)});
    Object.defineProperty(globalThis, '__ANIMACRAFT_ACCEPTANCE_SEED__', {
      value: seed, configurable: false, enumerable: false, writable: false,
    });
    const authority = Object.freeze({
      schemaVersion: 'animacraft.web-execution.v8',
      network: 'mainnet',
      chainIdentifier: '35834a8a',
      allowWalletSignature: false,
      allowBroadcast: false,
    });
    Object.defineProperty(globalThis, '__ANIMACRAFT_ACCEPTANCE_AUTHORITY__', {
      value: authority, configurable: false, enumerable: false, writable: false,
    });

    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      const walletEvents = new Set();
      const account = Object.freeze({
        address: String(seed.creator).toLowerCase(),
        publicKey: new Uint8Array(32).fill(8),
        chains: Object.freeze(['sui:mainnet']),
        features: Object.freeze(['sui:signTransaction', 'sui:signPersonalMessage']),
        label: 'Approved Browser Account',
        icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiM3YzU1ZjYiLz48L3N2Zz4=',
      });
      const signingDisabled = async () => {
        throw new Error('ANIMACRAFT_ACCEPTANCE_WALLET_SIGNING_DISABLED');
      };
      const wallet = Object.freeze({
        id: 'animacraft-approved-browser-wallet',
        name: 'Approved Browser Wallet',
        icon: account.icon,
        version: '1.0.0',
        chains: Object.freeze(['sui:mainnet']),
        accounts: Object.freeze([account]),
        features: Object.freeze({
          'standard:connect': Object.freeze({
            version: '1.0.0',
            connect: async () => Object.freeze({ accounts: Object.freeze([account]) }),
          }),
          'standard:disconnect': Object.freeze({ version: '1.0.0', disconnect: async () => {} }),
          'standard:events': Object.freeze({
            version: '1.0.0',
            on(event, listener) {
              if (event === 'change' && typeof listener === 'function') walletEvents.add(listener);
              return () => walletEvents.delete(listener);
            },
          }),
          'sui:signTransaction': Object.freeze({ version: '2.0.0', signTransaction: signingDisabled }),
          'sui:signPersonalMessage': Object.freeze({
            version: '1.1.0', signPersonalMessage: signingDisabled,
          }),
        }),
      });
      const register = ({ register: accept }) => accept(wallet);
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
      window.addEventListener('wallet-standard:app-ready', ({ detail }) => register(detail));
      Object.defineProperty(globalThis, '__ANIMACRAFT_ACCEPTANCE_WALLET__', {
        value: wallet, configurable: false, enumerable: false, writable: false,
      });
    }

    const OriginalDate = Date;
    class FixedDate extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [seed.epochMilliseconds])); }
      static now() { return seed.epochMilliseconds; }
    }
    FixedDate.parse = OriginalDate.parse;
    FixedDate.UTC = OriginalDate.UTC;
    Object.defineProperty(globalThis, 'Date', { value: FixedDate, configurable: false });
    let randomState = seed.randomSeed >>> 0;
    Math.random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 4294967296;
    };
    let uuidSequence = 555555555554;
    try {
      Object.defineProperty(crypto, 'randomUUID', {
        configurable: true,
        value: () => '11111111-2222-4333-8444-' + String(++uuidSequence).padStart(12, '0'),
      });
      Object.defineProperty(crypto, 'getRandomValues', {
        configurable: true,
        value: (array) => {
          for (let index = 0; index < array.length; index += 1) {
            randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
            array[index] = randomState & 255;
          }
          return array;
        },
      });
    } catch {}

    const attempts = [];
    const errors = [];
    const bodyType = (body) => {
      if (body === undefined || body === null) return 'none';
      if (typeof body === 'string') return 'string';
      if (body instanceof Blob) return 'Blob';
      if (body instanceof URLSearchParams) return 'URLSearchParams';
      if (body instanceof FormData) return 'FormData';
      if (body instanceof ArrayBuffer) return 'ArrayBuffer';
      if (ArrayBuffer.isView(body)) return body.constructor?.name || 'ArrayBufferView';
      return Object.prototype.toString.call(body).slice(8, -1);
    };
    const requestDetails = (urlValue, init = {}) => ({
      url: String(urlValue?.url || urlValue || ''),
      method: String(init.method || urlValue?.method || 'GET').toUpperCase(),
      body: Object.prototype.hasOwnProperty.call(init, 'body') ? init.body : urlValue?.body,
    });
    const classify = (urlValue, init = {}) => {
      const details = requestDetails(urlValue, init);
      return forbiddenNetworkRequest(details, [location.origin]);
    };
    const block = (kind, urlValue, method, body) => {
      const record = Object.freeze({
        kind,
        url: String(urlValue || ''),
        method: String(method || 'GET').toUpperCase(),
        bodyType: bodyType(body),
      });
      attempts.push(record);
      return new TypeError('ANIMACRAFT_ACCEPTANCE_NETWORK_WRITE_BLOCKED:' + kind);
    };
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init = {}) => {
      const kind = classify(input, init);
      if (kind) {
        const details = requestDetails(input, init);
        return Promise.reject(block(kind, details.url, details.method, details.body));
      }
      return nativeFetch(input, init);
    };
    const NativeXMLHttpRequest = globalThis.XMLHttpRequest;
    if (typeof NativeXMLHttpRequest === 'function') {
      globalThis.XMLHttpRequest = class AcceptanceXMLHttpRequest extends NativeXMLHttpRequest {
        open(method, url, ...rest) {
          this.__acceptanceRequest = { method, url };
          return super.open(method, url, ...rest);
        }
        send(body) {
          const request = this.__acceptanceRequest || {};
          const kind = classify(request.url, { method: request.method, body });
          if (kind) throw block(kind, request.url, request.method, body);
          return super.send(body);
        }
      };
    }
    const nativeBeacon = navigator.sendBeacon?.bind(navigator);
    if (nativeBeacon) {
      Object.defineProperty(navigator, 'sendBeacon', {
        configurable: true,
        value: (url, data) => {
          const kind = classify(url, { method: 'POST', body: data }) || 'network-write';
          block(kind, url, 'POST', data);
          return false;
        },
      });
    }
    const NativeWebSocket = globalThis.WebSocket;
    class AcceptanceWebSocket {
      constructor(url) { throw block('websocket', url, 'CONNECT', null); }
      static CONNECTING = NativeWebSocket?.CONNECTING ?? 0;
      static OPEN = NativeWebSocket?.OPEN ?? 1;
      static CLOSING = NativeWebSocket?.CLOSING ?? 2;
      static CLOSED = NativeWebSocket?.CLOSED ?? 3;
    }
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: false, enumerable: true, writable: false, value: AcceptanceWebSocket,
    });
    if (typeof globalThis.WebTransport === 'function') {
      Object.defineProperty(globalThis, 'WebTransport', {
        configurable: false,
        enumerable: true,
        writable: false,
        value: class AcceptanceWebTransport {
          constructor(url) { throw block('webtransport', url, 'CONNECT', null); }
        },
      });
    }
    const formRequest = (form, submitter) => ({
      url: submitter?.formAction || form.action || location.href,
      method: String(submitter?.formMethod || form.method || 'GET').toUpperCase(),
    });
    if (typeof HTMLFormElement === 'function') {
      for (const methodName of ['submit', 'requestSubmit']) {
        const native = HTMLFormElement.prototype[methodName];
        if (typeof native !== 'function') continue;
        Object.defineProperty(HTMLFormElement.prototype, methodName, {
          configurable: true,
          value: function acceptanceFormSubmission(submitter) {
            const request = formRequest(this, submitter);
            const kind = classify(request.url, { method: request.method });
            if (kind) throw block(kind, request.url, request.method, null);
            return native.apply(this, arguments);
          },
        });
      }
    }
    globalThis.addEventListener('error', (event) => {
      errors.push(String(event.error?.stack || event.message || event.error || 'window error'));
    });
    globalThis.addEventListener('unhandledrejection', (event) => {
      errors.push(String(event.reason?.stack || event.reason || 'unhandled rejection'));
    });
    Object.defineProperty(globalThis, '__ANIMACRAFT_NETWORK_TRIPWIRE__', {
      configurable: false,
      enumerable: false,
      value: Object.freeze({ attempts, errors }),
      writable: false,
    });
    if (typeof document !== 'undefined' && typeof Element === 'function') {
      const styleProperties = Object.freeze([
        'display', 'visibility', 'position', 'inset', 'top', 'right', 'bottom', 'left',
        'box-sizing', 'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
        'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
        'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
        'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
        'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
        'border-radius', 'background-color', 'background-image', 'box-shadow',
        'color', 'font-family', 'font-size', 'font-style', 'font-weight', 'line-height',
        'letter-spacing', 'text-align', 'text-transform', 'text-decoration-line',
        'white-space', 'word-break', 'overflow', 'overflow-x', 'overflow-y',
        'opacity', 'transform', 'transform-origin', 'z-index', 'pointer-events',
        'flex', 'flex-basis', 'flex-direction', 'flex-grow', 'flex-shrink', 'flex-wrap',
        'align-content', 'align-items', 'align-self', 'justify-content', 'justify-items',
        'gap', 'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows',
        'object-fit', 'object-position', 'cursor',
      ]);
      const rounded = (value) => Math.round(Number(value) * 64) / 64;
      const deepestActiveElement = () => {
        let active = document.activeElement;
        const visited = new Set();
        while (active instanceof Element && !visited.has(active)) {
          visited.add(active);
          const nested = active.shadowRoot?.activeElement;
          if (!(nested instanceof Element)) break;
          active = nested;
        }
        return active;
      };
      const elementPath = (node) => {
        const segments = [];
        let current = node;
        while (current instanceof Element) {
          const root = current.getRootNode();
          const id = current.id ? '#' + CSS.escape(current.id) : '';
          let segment = current.localName + id;
          if (!id) {
            const siblings = [...(current.parentElement?.children || [])]
              .filter((candidate) => candidate.localName === current.localName);
            if (siblings.length > 1) segment += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
          }
          segments.unshift(segment);
          if (root instanceof ShadowRoot) {
            segments.unshift('::shadow');
            current = root.host;
          } else current = current.parentElement;
        }
        return segments.join('>');
      };
      const canonicalAttributes = (element) => [...element.attributes]
        .map((attribute) => [attribute.name, attribute.value])
        .sort(([left], [right]) => left.localeCompare(right));
      const canonicalText = (node) => {
        const preserve = ['PRE', 'TEXTAREA'].includes(node.parentElement?.tagName);
        const value = String(node.data || '');
        return preserve ? value : value.replace(/\\s+/g, ' ').trim();
      };
      const canonicalChildren = (parent) => [...parent.childNodes].flatMap((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) return [canonicalElement(node)];
        if (node.nodeType === Node.TEXT_NODE) {
          const value = canonicalText(node);
          return value ? [{ kind: 'text', value }] : [];
        }
        return [];
      });
      const canonicalElement = (element) => {
        const rect = element.getBoundingClientRect();
        const computed = getComputedStyle(element);
        const aria = {};
        [...element.attributes].filter(({ name }) => name.startsWith('aria-'))
          .sort((left, right) => left.name.localeCompare(right.name))
          .forEach(({ name, value }) => { aria[name] = value; });
        const record = {
          kind: 'element',
          tag: element.localName,
          attributes: canonicalAttributes(element),
          bounds: {
            x: rounded(rect.x), y: rounded(rect.y),
            width: rounded(rect.width), height: rounded(rect.height),
          },
          computed: Object.fromEntries(styleProperties.map((property) => (
            [property, computed.getPropertyValue(property)]
          ))),
          state: {
            focused: deepestActiveElement() === element,
            inert: element.inert === true || element.hasAttribute('inert'),
            hidden: element.hidden === true,
            disabled: 'disabled' in element ? element.disabled === true : false,
            tabIndex: element.tabIndex,
            role: element.getAttribute('role'),
            aria,
          },
          children: canonicalChildren(element),
        };
        if (element.shadowRoot?.mode === 'open') {
          record.shadow = {
            kind: 'shadow-root', mode: 'open',
            delegatesFocus: element.shadowRoot.delegatesFocus === true,
            children: canonicalChildren(element.shadowRoot),
          };
        }
        return record;
      };
      Object.defineProperty(globalThis, '__ANIMACRAFT_ACCEPTANCE_INSPECTOR__', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: Object.freeze({
          deepestActiveElement,
          inspect(expectedSelectors = []) {
            return {
              expected: expectedSelectors.map((selector) => ({
                selector, count: document.querySelectorAll(selector).length,
              })),
              writeAuthority: globalThis.__ANIMACRAFT_ACCEPTANCE_AUTHORITY__ || null,
              bodyStatus: document.readyState,
            };
          },
          snapshot(rootSelector) {
            const root = document.querySelector(rootSelector);
            if (!root) throw new Error('Acceptance root not found: ' + rootSelector);
            return {
              schemaVersion: 'animacraft.approved-product-browser-snapshot.v1',
              viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
              rootSelector,
              activeElement: elementPath(deepestActiveElement()),
              tree: canonicalElement(root),
            };
          },
        }),
      });
    }
  })();`;
}

function suspiciousCdpRequest(request) {
  return suspiciousNetworkRequest({
    url: request?.url,
    method: request?.method,
    postData: request?.postData,
  });
}

function forbiddenCdpRequest(request, allowedOrigins) {
  return forbiddenNetworkRequest({
    url: request?.url,
    method: request?.method,
    postData: request?.postData,
  }, allowedOrigins);
}

async function installRecursiveBrowserFirewall(browser, {
  preloadSource,
  allowedOrigins,
} = {}) {
  const origins = new Set(allowedOrigins || []);
  const rootTargetFilter = Object.freeze([
    Object.freeze({ type: 'page', exclude: false }),
    // Chromium exposes SharedWorker as a browser-level target rather than a
    // child of the page which constructed it.
    Object.freeze({ type: 'shared_worker', exclude: false }),
    Object.freeze({ exclude: true }),
  ]);
  const childTargetFilter = Object.freeze([
    Object.freeze({ type: 'iframe', exclude: false }),
    Object.freeze({ type: 'worker', exclude: false }),
    Object.freeze({ type: 'shared_worker', exclude: false }),
    Object.freeze({ type: 'service_worker', exclude: false }),
    Object.freeze({ exclude: true }),
  ]);
  const records = [];
  const recordsBySession = new Map();
  const protectionTasks = new Set();
  const commandTasks = new Set();
  const errors = [];
  const rootPaused = [];
  const rootBlocked = [];
  const rootPending = new Set();
  const rootRecord = { errors: [] };
  let closed = false;

  const observeCommand = (task, record) => {
    commandTasks.add(task);
    task.catch((error) => {
      const message = String(error?.stack || error);
      record.errors.push(message);
      errors.push(message);
    }).finally(() => commandTasks.delete(task));
  };

  const protect = async (message) => {
    const { sessionId, targetInfo = {}, waitingForDebugger } = message.params || {};
    if (!sessionId || recordsBySession.has(sessionId)) return;
    const session = browser.session(sessionId);
    const record = {
      sessionId,
      parentSessionId: message.sessionId || null,
      targetId: targetInfo.targetId,
      openerId: targetInfo.openerId || null,
      type: targetInfo.type,
      url: targetInfo.url,
      waitingForDebugger: waitingForDebugger === true,
      preloadInstalled: false,
      fetchInstalled: false,
      networkBlockInstalled: false,
      cdpFirewallKind: '',
      observerInstalled: false,
      recursiveAutoAttachInstalled: false,
      bootstrapResumed: false,
      resumed: false,
      protectionStage: 'attached',
      paused: [],
      blocked: [],
      requests: [],
      failures: [],
      exceptions: [],
      errors: [],
      pending: new Set(),
      unsubscribe: null,
      session,
    };
    records.push(record);
    recordsBySession.set(sessionId, record);
    const protectedSend = async (method, params = {}) => {
      record.protectionStage = method;
      let timer;
      try {
        return await Promise.race([
          session.send(method, params),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(
              `${record.type} target protection timed out at ${method}.`,
            )), 8_000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    record.unsubscribe = session.onEvent((event) => {
      if (event.method === 'Fetch.requestPaused') {
        const request = event.params?.request || {};
        const blockedKind = forbiddenCdpRequest(request, origins);
        const requestRecord = {
          requestId: event.params?.requestId,
          method: request.method,
          url: request.url,
          kind: blockedKind,
          targetType: record.type,
          targetId: record.targetId,
        };
        record.paused.push(requestRecord);
        const task = (blockedKind
          ? session.send('Fetch.failRequest', {
            requestId: requestRecord.requestId,
            errorReason: 'BlockedByClient',
          }).then(() => { record.blocked.push(requestRecord); })
          : session.send('Fetch.continueRequest', { requestId: requestRecord.requestId }));
        record.pending.add(task);
        observeCommand(task.finally(() => record.pending.delete(task)), record);
      } else if (event.method === 'Network.requestWillBeSent') {
        record.requests.push(event.params?.request || {});
      } else if (event.method === 'Network.loadingFailed') {
        record.failures.push(event.params || {});
      } else if (event.method === 'Runtime.exceptionThrown') {
        record.exceptions.push(event.params?.exceptionDetails || event.params);
      }
    });

    // Every attached target can itself create a related target. Install the
    // next auto-attach layer while this target is still paused; limiting this
    // to pages/iframes lets a worker-created nested worker run unprotected.
    await protectedSend('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: childTargetFilter,
    });
    record.recursiveAutoAttachInstalled = true;

    const embeddedServiceWorkerPreload = record.type === 'service_worker'
      && String(record.url).includes('/__acceptance_target_service_worker__.js');
    if (record.type === 'service_worker' && waitingForDebugger === true) {
      if (!embeddedServiceWorkerPreload) {
        throw new Error(`Uncontrolled service worker target cannot be resumed: ${record.url}`);
      }
      // Chromium 151 deadlocks Runtime.enable while a ServiceWorker target is
      // waiting for the debugger. This controlled probe has the exact preload
      // as the first script statement, so resume lets that fail-closed guard
      // install before the probe registers any event handler or attempts I/O.
      record.preloadInstalled = true;
      await protectedSend('Runtime.runIfWaitingForDebugger');
      record.bootstrapResumed = true;
    }
    await protectedSend('Runtime.enable');
    await protectedSend('Network.enable');
    record.observerInstalled = true;
    if (['page', 'iframe'].includes(record.type)) {
      await protectedSend('Page.enable');
      await protectedSend('Log.enable');
      await protectedSend('Page.addScriptToEvaluateOnNewDocument', { source: preloadSource });
      // A newly-created OOPIF can be paused before it owns a default execution
      // context. The new-document hook is nevertheless registered while the
      // target is paused and therefore runs before its first document script.
      record.preloadInstalled = true;
    }
    if (!embeddedServiceWorkerPreload) {
      try {
        await protectedSend('Runtime.evaluate', {
          expression: preloadSource,
          awaitPromise: true,
          returnByValue: true,
        });
        record.preloadInstalled = true;
      } catch (error) {
        const noDefaultContext = String(error?.message || error).includes(
          'Cannot find default execution context',
        );
        if (!record.preloadInstalled || !noDefaultContext) throw error;
      }
    }
    try {
      await protectedSend('Fetch.enable', {
        patterns: [{ urlPattern: '*', requestStage: 'Request' }],
      });
      record.fetchInstalled = true;
      record.cdpFirewallKind = 'Fetch';
    } catch (error) {
      const fetchDomainUnavailable = String(error?.message || error).includes(
        "'Fetch.enable' wasn't found",
      );
      if (!fetchDomainUnavailable
        || !['worker', 'shared_worker', 'service_worker'].includes(record.type)) throw error;
      // Chromium does not expose the Fetch domain on worker targets. Install
      // the target-local Network-domain hard block before resuming instead;
      // the preload still performs method/body-aware fail-closed rejection.
      await protectedSend('Network.setBlockedURLs', {
        urls: [
          '*__acceptance_write_probe__*',
          '*__acceptance_cdp_probe__*',
          '*json-rpc*',
          '*jsonrpc*',
          '*graphql*',
          '*executeTransaction*',
          '*walrus*',
          '*v1/blobs*',
        ],
      });
      record.networkBlockInstalled = true;
      record.cdpFirewallKind = 'Network.setBlockedURLs';
    }
    if (embeddedServiceWorkerPreload) {
      await protectedSend('Runtime.evaluate', {
        expression: `Object.defineProperty(globalThis, '__ANIMACRAFT_CDP_TARGET_PROTECTED__', {
          configurable: false, enumerable: false, writable: false, value: true,
        }); true`,
        returnByValue: true,
      });
    }
    if (!record.bootstrapResumed) {
      try {
        await protectedSend('Runtime.runIfWaitingForDebugger');
      } catch (error) {
        if (waitingForDebugger === true) throw error;
      }
    }
    record.resumed = true;
    record.protectionStage = 'complete';
  };

  const unsubscribe = browser.onEvent((message) => {
    if (closed) return;
    if (message.method === 'Fetch.requestPaused' && !message.sessionId) {
      const request = message.params?.request || {};
      const blockedKind = forbiddenCdpRequest(request, origins);
      const requestRecord = {
        requestId: message.params?.requestId,
        method: request.method,
        url: request.url,
        kind: blockedKind,
        targetType: 'browser',
        targetId: null,
      };
      rootPaused.push(requestRecord);
      const task = (blockedKind
        ? browser.send('Fetch.failRequest', {
          requestId: requestRecord.requestId,
          errorReason: 'BlockedByClient',
        }).then(() => { rootBlocked.push(requestRecord); })
        : browser.send('Fetch.continueRequest', { requestId: requestRecord.requestId }));
      rootPending.add(task);
      observeCommand(task.finally(() => rootPending.delete(task)), rootRecord);
      return;
    }
    if (message.method !== 'Target.attachedToTarget') return;
    const task = protect(message);
    protectionTasks.add(task);
    task.catch((error) => errors.push(String(error?.stack || error)))
      .finally(() => protectionTasks.delete(task));
  });
  // Browser-scope Fetch is available even where Chromium omits the Fetch
  // domain from worker sessions. Install it before creating either product
  // page, so every descendant has a hard network barrier before attachment.
  await browser.send('Fetch.enable', {
    patterns: [{ urlPattern: '*', requestStage: 'Request' }],
  });
  await browser.send('Target.setDiscoverTargets', { discover: true });
  await browser.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
    filter: rootTargetFilter,
  });

  const waitForIdle = async () => {
    while (protectionTasks.size || commandTasks.size || rootPending.size
      || records.some(({ pending }) => pending.size)) {
      await Promise.allSettled([
        ...protectionTasks,
        ...commandTasks,
        ...rootPending,
        ...records.flatMap(({ pending }) => [...pending]),
      ]);
    }
    assert.deepEqual(errors, [], 'Recursive browser target firewall failed.');
  };
  const waitForTarget = async (predicate, label, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await waitForIdle();
      const record = records.find((candidate) => predicate(candidate));
      if (record?.resumed) return record;
      await pause(25);
    }
    throw new Error(`Timed out waiting for protected browser target: ${label}. `
      + JSON.stringify(records.map(({ targetId, type, url, resumed, errors: targetErrors }) => ({
        targetId, type, url, resumed, errors: targetErrors,
      }))));
  };
  const close = async () => {
    closed = true;
    await waitForIdle();
    unsubscribe();
    for (const record of records) {
      record.unsubscribe?.();
      if (record.fetchInstalled) await record.session.send('Fetch.disable').catch(() => {});
    }
    await browser.send('Fetch.disable').catch(() => {});
    await browser.send('Target.setAutoAttach', {
      autoAttach: false, waitForDebuggerOnStart: false, flatten: true,
    }).catch(() => {});
  };
  return {
    records,
    recordsBySession,
    errors,
    rootPaused,
    rootBlocked,
    waitForIdle,
    waitForTarget,
    close,
  };
}

async function runPageWriteAttackMatrix(cdp, firewall, server, side) {
  await firewall.waitForIdle();
  const before = new Map(firewall.records.map((record) => [record.sessionId, {
    paused: record.paused.length,
    blocked: record.blocked.length,
  }]));
  const rootBefore = {
    paused: firewall.rootPaused.length,
    blocked: firewall.rootBlocked.length,
  };
  const externalOrigin = server.origin.replace('127.0.0.1', 'localhost');
  assert.notEqual(externalOrigin, server.origin, `${side} external-origin POST probe is not cross-origin.`);
  const externalOpaqueProbeUrl = `${externalOrigin}/__acceptance_write_probe__/external-opaque-post`;
  const semanticProbeUrls = Object.freeze({
    graphqlQuery: `${externalOrigin}/graphql?${semanticProbeMarker}preload-graphql-query`,
    graphqlMutation: `${externalOrigin}/graphql?${semanticProbeMarker}preload-graphql-mutation`,
    graphqlOpaque: `${externalOrigin}/graphql?${semanticProbeMarker}preload-graphql-opaque`,
    grpcUnknown: `${externalOrigin}/sui.rpc.v2.StateService/GetObject?${semanticProbeMarker}preload-grpc-unknown`,
    grpcServiceInfo: `${externalOrigin}/sui.rpc.v2.LedgerService/GetServiceInfo?${semanticProbeMarker}preload-grpc-service-info`,
    grpcListOwned: `${externalOrigin}/sui.rpc.v2.StateService/ListOwnedObjects?${semanticProbeMarker}preload-grpc-list-owned`,
  });
  const graphqlInvalidPostDefinitions = Object.freeze([
    Object.freeze({ label: 'graphql-empty-selection', query: 'query AcceptanceRead {}' }),
    Object.freeze({
      label: 'graphql-garbage-token',
      query: 'query AcceptanceRead garbage { chainIdentifier }',
    }),
    Object.freeze({
      label: 'graphql-unclosed-argument',
      query: 'query AcceptanceRead { chainIdentifier(arg: 1 }',
    }),
    Object.freeze({
      label: 'graphql-bad-fragment',
      query: 'query AcceptanceRead { ...Fields } fragment Fields on { chainIdentifier }',
    }),
    Object.freeze({
      label: 'graphql-bad-directive',
      query: 'query AcceptanceRead { chainIdentifier @include(if:) }',
    }),
    Object.freeze({
      label: 'graphql-raw-high-surrogate',
      query: 'query AcceptanceRead { field(arg: "\ud800") }',
    }),
    Object.freeze({
      label: 'graphql-raw-low-surrogate',
      query: 'query AcceptanceRead { field(arg: "\udc00") }',
    }),
    Object.freeze({
      label: 'graphql-block-lone-surrogate',
      query: 'query AcceptanceRead { field(arg: """\ud800""") }',
    }),
    Object.freeze({
      label: 'graphql-escaped-high-surrogate',
      query: 'query AcceptanceRead { field(arg: "\\uD800") }',
    }),
    Object.freeze({
      label: 'graphql-escaped-low-surrogate',
      query: 'query AcceptanceRead { field(arg: "\\uDC00") }',
    }),
  ]);
  const graphqlGetDefinitions = Object.freeze([
    Object.freeze({
      label: 'graphql-get-mutation',
      query: 'mutation AcceptanceWrite { publish }',
      operationName: 'AcceptanceWrite',
    }),
    Object.freeze({
      label: 'graphql-get-subscription',
      query: 'subscription AcceptanceEvents { events }',
      operationName: 'AcceptanceEvents',
    }),
    Object.freeze({
      label: 'graphql-get-multiple-operations',
      query: 'query AcceptanceRead { chainIdentifier } query Other { chainIdentifier }',
      operationName: 'AcceptanceRead',
    }),
    Object.freeze({
      label: 'graphql-get-persisted',
      extensions: JSON.stringify({ persistedQuery: { sha256Hash: '00' } }),
    }),
  ]);
  const graphqlProbeUrl = (phase, definition) => {
    const target = new URL('/graphql', externalOrigin);
    target.searchParams.set(semanticProbeMarker.slice(0, -1), `${phase}-${definition.label}`);
    for (const key of ['query', 'operationName', 'extensions']) {
      if (Object.hasOwn(definition, key)) target.searchParams.set(key, definition[key]);
    }
    return target.href;
  };
  const preloadGraphqlInvalidPostProbes = Object.freeze(graphqlInvalidPostDefinitions.map((entry) => ({
    label: entry.label,
    url: graphqlProbeUrl('preload', entry),
    body: JSON.stringify({
      query: entry.query, operationName: 'AcceptanceRead', variables: {},
    }),
  })));
  const preloadGraphqlGetProbes = Object.freeze(graphqlGetDefinitions.map((entry) => ({
    label: entry.label,
    url: graphqlProbeUrl('preload', entry),
  })));
  const result = await evaluate(cdp, `(async () => {
    const results = [];
    const probeRoot = location.origin + '/__acceptance_write_probe__/';
    const externalOpaqueProbeUrl = ${JSON.stringify(externalOpaqueProbeUrl)};
    const semanticProbeUrls = ${JSON.stringify(semanticProbeUrls)};
    const graphqlInvalidPostProbes = ${JSON.stringify(preloadGraphqlInvalidPostProbes)};
    const graphqlGetProbes = ${JSON.stringify(preloadGraphqlGetProbes)};
    const grpcServiceInfoReadBody = ${JSON.stringify(grpcServiceInfoReadBody)};
    const grpcListOwnedReadBody = ${JSON.stringify(grpcListOwnedReadBody)};
    const tripwire = globalThis.__ANIMACRAFT_NETWORK_TRIPWIRE__;
    const initialAttemptCount = tripwire.attempts.length;
    const probe = async (label, operation, { falseMeansBlocked = false } = {}) => {
      const before = tripwire.attempts.length;
      let value;
      let error = '';
      try { value = await operation(); } catch (caught) { error = String(caught?.message || caught); }
      const after = tripwire.attempts.length;
      results.push({
        label,
        blocked: after === before + 1 && (
          error.includes('ANIMACRAFT_ACCEPTANCE_NETWORK_WRITE_BLOCKED')
          || (falseMeansBlocked && value === false)
        ),
        before,
        after,
        error,
        value: value === undefined ? null : value,
      });
    };
    const bodyFactories = [
      ['Blob', () => new Blob(['mutation Write { publish }'], { type: 'application/json' })],
      ['URLSearchParams', () => new URLSearchParams({ jsonrpc: '2.0' })],
      ['ArrayBuffer', () => new TextEncoder().encode('executeTransaction').buffer],
      ['FormData', () => { const body = new FormData(); body.append('mutation', 'publish'); return body; }],
      ['Uint8Array', () => new TextEncoder().encode('walrus write blob')],
      ['DataView', () => new DataView(new TextEncoder().encode('executeTransaction').buffer)],
    ];
    await probe('fetch:init:string', () => fetch(probeRoot + 'fetch-string', {
      method: 'POST', body: '{"jsonrpc":"2.0"}',
    }));
    await probe('fetch:Request', () => fetch(new Request(probeRoot + 'fetch-request', {
      method: 'POST', body: new Blob(['executeTransaction']),
    })));
    await probe('fetch:external-opaque-Uint8Array', () => fetch(externalOpaqueProbeUrl, {
      method: 'POST', body: new Uint8Array([0, 255, 19, 128, 1]),
    }));
    await probe('fetch:semantic:graphql-query', () => fetch(semanticProbeUrls.graphqlQuery, {
      method: 'POST', body: JSON.stringify({
        query: 'query AcceptanceRead { ...ChainFields } fragment ChainFields on Query { chainIdentifier }',
        operationName: 'AcceptanceRead',
        variables: {},
      }),
    }));
    await probe('fetch:semantic:graphql-mutation', () => fetch(semanticProbeUrls.graphqlMutation, {
      method: 'POST', body: JSON.stringify({
        query: 'mutation AcceptanceWrite { publish }',
        operationName: 'AcceptanceWrite',
        variables: {},
      }),
    }));
    await probe('fetch:semantic:graphql-opaque', () => fetch(semanticProbeUrls.graphqlOpaque, {
      method: 'POST', body: new Uint8Array([0, 255, 19, 128, 1]),
    }));
    await probe('fetch:semantic:grpc-unknown', () => fetch(semanticProbeUrls.grpcUnknown, {
      method: 'POST', body: grpcServiceInfoReadBody,
    }));
    await probe('fetch:semantic:grpc-service-info', () => fetch(semanticProbeUrls.grpcServiceInfo, {
      method: 'POST', body: grpcServiceInfoReadBody,
    }));
    await probe('fetch:semantic:grpc-list-owned', () => fetch(semanticProbeUrls.grpcListOwned, {
      method: 'POST', body: grpcListOwnedReadBody,
    }));
    for (const graphqlProbe of graphqlInvalidPostProbes) {
      await probe('fetch:semantic:' + graphqlProbe.label, () => fetch(graphqlProbe.url, {
        method: 'POST', body: graphqlProbe.body,
      }));
    }
    for (const graphqlProbe of graphqlGetProbes) {
      await probe('fetch:semantic:' + graphqlProbe.label, () => fetch(graphqlProbe.url, {
        method: 'GET',
      }));
    }
    for (const [name, factory] of bodyFactories) {
      await probe('fetch:' + name, () => fetch(probeRoot + 'fetch-' + name, {
        method: 'POST', body: factory(),
      }));
    }
    for (const [name, factory] of [['string', () => '{"jsonrpc":"2.0"}'], ...bodyFactories]) {
      await probe('xhr:' + name, () => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', probeRoot + 'xhr-' + name);
        xhr.send(factory());
      });
    }
    for (const [name, factory] of [['string', () => '{"jsonrpc":"2.0"}'], ...bodyFactories]) {
      await probe('beacon:' + name, () => navigator.sendBeacon(
        probeRoot + 'beacon-' + name,
        factory(),
      ), { falseMeansBlocked: true });
    }
    await probe('WebSocket', () => new WebSocket(
      'ws://127.0.0.1:9/__acceptance_write_probe__/websocket',
    ));
    if (typeof WebTransport === 'function') {
      await probe('WebTransport', () => new WebTransport(
        'https://127.0.0.1:9/__acceptance_write_probe__/webtransport',
      ));
    }
    await probe('HTMLFormElement.requestSubmit', () => {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = probeRoot + 'form';
      document.body.append(form);
      try { form.requestSubmit(); } finally { form.remove(); }
    });
    await probe('HTMLFormElement.submit', () => {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = probeRoot + 'form-submit';
      document.body.append(form);
      try { form.submit(); } finally { form.remove(); }
    });

    const signingResults = [];
    for (const [feature, method, input] of [
      ['sui:signTransaction', 'signTransaction', { transaction: new Uint8Array([1]) }],
      ['sui:signPersonalMessage', 'signPersonalMessage', { message: new Uint8Array([1]) }],
    ]) {
      let error = '';
      try {
        await globalThis.__ANIMACRAFT_ACCEPTANCE_WALLET__.features[feature][method](input);
      } catch (caught) {
        error = String(caught?.message || caught);
      }
      signingResults.push({ feature, method, error });
    }

    return {
      results,
      signingResults,
      attempts: tripwire.attempts.slice(initialAttemptCount),
      webTransportSupported: typeof WebTransport === 'function',
    };
  })()`);
  const isolatedTripwireBefore = await evaluate(
    cdp,
    `globalThis.__ANIMACRAFT_NETWORK_TRIPWIRE__.attempts.length`,
  );
  const frameTree = await cdp.send('Page.getFrameTree');
  const frameId = frameTree.frameTree?.frame?.id;
  assert.ok(frameId, `${side} production page has no main frame for the CDP POST probe.`);
  const isolatedWorld = await cdp.send('Page.createIsolatedWorld', {
    frameId,
    worldName: `animacraft-cdp-unsafe-post-${side}`,
    grantUniveralAccess: false,
  });
  assert.ok(
    isolatedWorld.executionContextId,
    `${side} could not create an isolated CDP POST probe world.`,
  );
  const cdpProbeUrls = Object.freeze({
    sameOrigin: `${server.origin}/__acceptance_cdp_probe__/unsafe-post`,
    externalOpaque: `${externalOrigin}/__acceptance_cdp_probe__/external-opaque-post`,
    graphqlQuery: `${externalOrigin}/graphql?${semanticProbeMarker}cdp-graphql-query`,
    graphqlMutation: `${externalOrigin}/graphql?${semanticProbeMarker}cdp-graphql-mutation`,
    graphqlOpaque: `${externalOrigin}/graphql?${semanticProbeMarker}cdp-graphql-opaque`,
    grpcUnknown: `${externalOrigin}/sui.rpc.v2.StateService/GetObject?${semanticProbeMarker}cdp-grpc-unknown`,
    grpcServiceInfo: `${externalOrigin}/sui.rpc.v2.LedgerService/GetServiceInfo?${semanticProbeMarker}cdp-grpc-service-info`,
    grpcListOwned: `${externalOrigin}/sui.rpc.v2.StateService/ListOwnedObjects?${semanticProbeMarker}cdp-grpc-list-owned`,
  });
  const cdpGraphqlInvalidPostProbes = Object.freeze(graphqlInvalidPostDefinitions.map((entry) => ({
    label: entry.label,
    url: graphqlProbeUrl('cdp', entry),
    method: 'POST',
    body: JSON.stringify({
      query: entry.query, operationName: 'AcceptanceRead', variables: {},
    }),
    mode: 'no-cors',
  })));
  const cdpGraphqlGetProbes = Object.freeze(graphqlGetDefinitions.map((entry) => ({
    label: entry.label,
    url: graphqlProbeUrl('cdp', entry),
    method: 'GET',
    mode: 'no-cors',
  })));
  const cdpProbeEvaluation = await cdp.send('Runtime.evaluate', {
    contextId: isolatedWorld.executionContextId,
    expression: `(async () => {
      const evidence = {
        preloadTripwirePresent: Boolean(globalThis.__ANIMACRAFT_NETWORK_TRIPWIRE__),
        results: [],
      };
      const adversarialGraphqlProbes = ${JSON.stringify([
    ...cdpGraphqlInvalidPostProbes,
    ...cdpGraphqlGetProbes,
  ])};
      for (const probe of [
        {
          label: 'same-origin-string',
          url: ${JSON.stringify(cdpProbeUrls.sameOrigin)},
          body: 'isolated-world-unsafe-post',
        },
        {
          label: 'external-opaque-Uint8Array',
          url: ${JSON.stringify(cdpProbeUrls.externalOpaque)},
          body: new Uint8Array([0, 255, 19, 128, 1]),
          mode: 'no-cors',
        },
        {
          label: 'graphql-query',
          url: ${JSON.stringify(cdpProbeUrls.graphqlQuery)},
          body: JSON.stringify({ query: 'query AcceptanceRead { ...ChainFields } fragment ChainFields on Query { chainIdentifier }', operationName: 'AcceptanceRead', variables: {} }),
          mode: 'no-cors',
        },
        {
          label: 'graphql-mutation',
          url: ${JSON.stringify(cdpProbeUrls.graphqlMutation)},
          body: JSON.stringify({ query: 'mutation AcceptanceWrite { publish }', operationName: 'AcceptanceWrite', variables: {} }),
          mode: 'no-cors',
        },
        {
          label: 'graphql-opaque',
          url: ${JSON.stringify(cdpProbeUrls.graphqlOpaque)},
          body: new Uint8Array([0, 255, 19, 128, 1]),
          mode: 'no-cors',
        },
        {
          label: 'grpc-unknown',
          url: ${JSON.stringify(cdpProbeUrls.grpcUnknown)},
          body: ${JSON.stringify(grpcServiceInfoReadBody)},
          mode: 'no-cors',
        },
        {
          label: 'grpc-service-info',
          url: ${JSON.stringify(cdpProbeUrls.grpcServiceInfo)},
          body: ${JSON.stringify(grpcServiceInfoReadBody)},
          mode: 'no-cors',
        },
        {
          label: 'grpc-list-owned',
          url: ${JSON.stringify(cdpProbeUrls.grpcListOwned)},
          body: ${JSON.stringify(grpcListOwnedReadBody)},
          mode: 'no-cors',
        },
        ...adversarialGraphqlProbes,
      ]) {
        const result = {
          label: probe.label,
          url: probe.url,
          method: probe.method || 'POST',
          blocked: false,
          error: '',
          status: null,
        };
        try {
          const init = { method: result.method, mode: probe.mode };
          if (Object.hasOwn(probe, 'body')) init.body = probe.body;
          const response = await fetch(probe.url, init);
          result.status = response.status;
        } catch (error) {
          result.blocked = true;
          result.error = String(error?.message || error);
        }
        evidence.results.push(result);
      }
      return evidence;
    })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (cdpProbeEvaluation.exceptionDetails) {
    throw new Error(`${side} isolated CDP POST probe failed to execute: ${JSON.stringify(
      cdpProbeEvaluation.exceptionDetails,
    )}`);
  }
  const cdpProbe = cdpProbeEvaluation.result?.value;
  assert.equal(
    cdpProbe?.preloadTripwirePresent,
    false,
    `${side} CDP POST probe did not bypass the main-world preload.`,
  );
  assert.deepEqual(
    cdpProbe?.results?.map(({ label, method, blocked }) => ({ label, method, blocked })),
    [
      { label: 'same-origin-string', method: 'POST', blocked: true },
      { label: 'external-opaque-Uint8Array', method: 'POST', blocked: true },
      { label: 'graphql-query', method: 'POST', blocked: true },
      { label: 'graphql-mutation', method: 'POST', blocked: true },
      { label: 'graphql-opaque', method: 'POST', blocked: true },
      { label: 'grpc-unknown', method: 'POST', blocked: true },
      { label: 'grpc-service-info', method: 'POST', blocked: true },
      { label: 'grpc-list-owned', method: 'POST', blocked: true },
      ...cdpGraphqlInvalidPostProbes.map(({ label }) => ({
        label, method: 'POST', blocked: true,
      })),
      ...cdpGraphqlGetProbes.map(({ label }) => ({
        label, method: 'GET', blocked: true,
      })),
    ],
    `${side} isolated unsafe POST matrix escaped the CDP barrier.`,
  );
  assert.equal(
    await evaluate(cdp, `globalThis.__ANIMACRAFT_NETWORK_TRIPWIRE__.attempts.length`),
    isolatedTripwireBefore,
    `${side} isolated CDP POST probe was counted by the main-world preload.`,
  );
  await firewall.waitForIdle();
  const newPaused = [
    ...firewall.rootPaused.slice(rootBefore.paused),
    ...firewall.records.flatMap((record) => record.paused.slice(
      before.get(record.sessionId)?.paused || 0,
    )),
  ];
  const newBlocked = [
    ...firewall.rootBlocked.slice(rootBefore.blocked),
    ...firewall.records.flatMap((record) => record.blocked.slice(
      before.get(record.sessionId)?.blocked || 0,
    )),
  ];
  const escapedPreload = newPaused.filter(({ url }) => isPreloadProbeUrl(url));
  const hardBarrier = newBlocked.filter(({ url }) => isCdpProbeUrl(url));
  const bodyNames = ['Blob', 'URLSearchParams', 'ArrayBuffer', 'FormData', 'Uint8Array', 'DataView'];
  const expectedLabels = [
    'fetch:init:string',
    'fetch:Request',
    'fetch:external-opaque-Uint8Array',
    'fetch:semantic:graphql-query',
    'fetch:semantic:graphql-mutation',
    'fetch:semantic:graphql-opaque',
    'fetch:semantic:grpc-unknown',
    'fetch:semantic:grpc-service-info',
    'fetch:semantic:grpc-list-owned',
    ...preloadGraphqlInvalidPostProbes.map(({ label }) => `fetch:semantic:${label}`),
    ...preloadGraphqlGetProbes.map(({ label }) => `fetch:semantic:${label}`),
    ...bodyNames.map((name) => `fetch:${name}`),
    ...['string', ...bodyNames].map((name) => `xhr:${name}`),
    ...['string', ...bodyNames].map((name) => `beacon:${name}`),
    'WebSocket',
    ...(result.webTransportSupported ? ['WebTransport'] : []),
    'HTMLFormElement.requestSubmit',
    'HTMLFormElement.submit',
  ];
  assert.deepEqual(
    result.results.map(({ label }) => label),
    expectedLabels,
    `${side} active write-API/body attack matrix is incomplete.`,
  );
  assert.equal(
    result.attempts.length,
    expectedLabels.length,
    `${side} preload tripwire did not record exactly one block for every active attack.`,
  );
  assert.deepEqual(
    result.results.filter(({ blocked }) => !blocked),
    [],
    `${side} preload firewall did not block every active write API/body before native network.`,
  );
  const externalOpaquePreloadBlocks = result.attempts.filter(({ url }) => (
    String(url) === externalOpaqueProbeUrl
  ));
  assert.deepEqual(
    externalOpaquePreloadBlocks.map(({ kind, method, bodyType }) => ({ kind, method, bodyType })),
    [{ kind: 'network-write', method: 'POST', bodyType: 'Uint8Array' }],
    `${side} external opaque-byte POST was not classified as an unsafe write.`,
  );
  const semanticPreloadBlocks = result.attempts.filter(({ url }) => isSemanticProbeUrl(url));
  assert.deepEqual(
    semanticPreloadBlocks.map(({ url, kind, method, bodyType }) => ({ url, kind, method, bodyType })),
    [
      { url: semanticProbeUrls.graphqlQuery, kind: 'external-network-read', method: 'POST', bodyType: 'string' },
      { url: semanticProbeUrls.graphqlMutation, kind: 'graphql-mutation', method: 'POST', bodyType: 'string' },
      { url: semanticProbeUrls.graphqlOpaque, kind: 'network-write', method: 'POST', bodyType: 'Uint8Array' },
      { url: semanticProbeUrls.grpcUnknown, kind: 'network-write', method: 'POST', bodyType: 'string' },
      { url: semanticProbeUrls.grpcServiceInfo, kind: 'external-network-read', method: 'POST', bodyType: 'string' },
      { url: semanticProbeUrls.grpcListOwned, kind: 'external-network-read', method: 'POST', bodyType: 'string' },
      ...preloadGraphqlInvalidPostProbes.map(({ url }) => ({
        url, kind: 'network-write', method: 'POST', bodyType: 'string',
      })),
      ...preloadGraphqlGetProbes.map(({ url }) => ({
        url, kind: 'network-write', method: 'GET', bodyType: 'none',
      })),
    ],
    `${side} preload semantic read allowlist was not fail-closed.`,
  );
  assert.deepEqual(
    result.signingResults.map(({ feature, method, error }) => ({ feature, method, error })),
    [
      {
        feature: 'sui:signTransaction',
        method: 'signTransaction',
        error: 'ANIMACRAFT_ACCEPTANCE_WALLET_SIGNING_DISABLED',
      },
      {
        feature: 'sui:signPersonalMessage',
        method: 'signPersonalMessage',
        error: 'ANIMACRAFT_ACCEPTANCE_WALLET_SIGNING_DISABLED',
      },
    ],
    `${side} acceptance wallet exposed signing authority.`,
  );
  assert.deepEqual(escapedPreload, [], `${side} a preload write probe reached CDP Fetch.`);
  assert.equal(
    hardBarrier.length,
    Object.keys(cdpProbeUrls).length
      + cdpGraphqlInvalidPostProbes.length + cdpGraphqlGetProbes.length,
    `${side} CDP Fetch hard barrier was not actively proven: ${JSON.stringify({
      newPaused,
      newBlocked,
      serverRequests: server.requestLog,
    })}`,
  );
  assert.deepEqual(
    hardBarrier.map(({ url, kind, method }) => ({ url, kind, method }))
      .sort((left, right) => left.url.localeCompare(right.url)),
    [
      { url: cdpProbeUrls.sameOrigin, kind: 'network-write', method: 'POST' },
      { url: cdpProbeUrls.externalOpaque, kind: 'network-write', method: 'POST' },
      { url: cdpProbeUrls.graphqlQuery, kind: 'external-network-read', method: 'POST' },
      { url: cdpProbeUrls.graphqlMutation, kind: 'graphql-mutation', method: 'POST' },
      { url: cdpProbeUrls.graphqlOpaque, kind: 'network-write', method: 'POST' },
      { url: cdpProbeUrls.grpcUnknown, kind: 'network-write', method: 'POST' },
      { url: cdpProbeUrls.grpcServiceInfo, kind: 'external-network-read', method: 'POST' },
      { url: cdpProbeUrls.grpcListOwned, kind: 'external-network-read', method: 'POST' },
      ...cdpGraphqlInvalidPostProbes.map(({ url }) => ({
        url, kind: 'network-write', method: 'POST',
      })),
      ...cdpGraphqlGetProbes.map(({ url }) => ({
        url, kind: 'network-write', method: 'GET',
      })),
    ]
      .sort((left, right) => left.url.localeCompare(right.url)),
    `${side} CDP probes were blocked for the wrong reason.`,
  );
  assert.deepEqual(server.requestLog, [], `${side} active attack reached the fixture HTTP server.`);
  return Object.freeze({
    apiProbeCount: result.results.length,
    preloadBlockedCount: result.attempts.length,
    signingBlockedCount: result.signingResults.length,
    cdpBlockedCount: hardBarrier.length,
    cdpProbe,
    externalOpaquePreloadBlocks,
    semanticPreloadBlocks,
    serverRequestCount: server.requestLog.length,
  });
}

function visibleElementExpression(selector) {
  return `(() => {
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
    };
    return [...document.querySelectorAll(${JSON.stringify(selector)})].find(visible) || null;
  })()`;
}

function deepTextElementExpression(text) {
  return `(() => {
    const needle = ${JSON.stringify(String(text).toLowerCase())};
    const candidates = [];
    const seen = new Set();
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const visit = (root, depth = 0) => {
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot?.mode === 'open') visit(element.shadowRoot, depth + 1);
        const content = String(element.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        if (!content.includes(needle)) continue;
        const clickable = element.closest?.('button,[role="button"],internal-button,[tabindex]')
          || (element.matches?.('button,[role="button"],internal-button,[tabindex]') ? element : null);
        if (!clickable || seen.has(clickable) || !visible(clickable)) continue;
        seen.add(clickable);
        const rect = clickable.getBoundingClientRect();
        candidates.push({ element: clickable, depth, area: rect.width * rect.height });
      }
    };
    visit(document);
    candidates.sort((left, right) => right.depth - left.depth || left.area - right.area);
    return candidates[0]?.element || null;
  })()`;
}

const prePointerReacquisitions = [];

async function elementInteractionPoint(cdp, expression, label, { requireEnabled = true, allowDetachedRetry = true } = {}) {
  const evaluation = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: false,
    returnByValue: false,
    userGesture: true,
  });
  if (evaluation.exceptionDetails) {
    throw new Error(`Unable to resolve ${label}: ${evaluation.exceptionDetails.text || 'evaluation failed'}.`);
  }
  const objectId = evaluation.result?.objectId;
  if (!objectId || evaluation.result?.subtype === 'null') {
    const debug = await evaluate(cdp, `({
      href: location.href,
      activePage: document.querySelector('.page.active')?.id || '',
      body: document.body?.innerText?.slice(0, 1600) || '',
    })`).catch(() => null);
    throw new Error(`Visible interaction target is missing: ${label}. ${JSON.stringify(debug)}`);
  }
  try {
    try {
      await cdp.send('DOM.scrollIntoViewIfNeeded', { objectId });
    } catch (error) {
      // CDP can prove detachment before the later RAF geometry check runs.
      // No pointer is sent by this helper. Reacquire once, only for this exact
      // pre-scroll rejection; the fresh target must pass every original check.
      if (!allowDetachedRetry || error.message !== '-32000: Node is detached from document') throw error;
      const fresh = await evaluate(cdp, `(() => {
        const element = ${expression};
        const rect = element?.getBoundingClientRect();
        return Boolean(element?.isConnected && rect?.width > 0 && rect?.height > 0);
      })()`);
      if (!fresh) throw error;
      prePointerReacquisitions.push({ label, oldConnected: false, beforePointer: true, phase: 'scroll' });
      return await elementInteractionPoint(cdp, expression, label,
        { requireEnabled, allowDetachedRetry: false });
    }
    const position = await cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `async function() {
        let previous;
        let stableFrames = 0;
        for (let frame = 0; frame < 12 && stableFrames < 2; frame += 1) {
          await new Promise(requestAnimationFrame);
          const bounds = this.getBoundingClientRect();
          const sample = [bounds.left, bounds.top, bounds.width, bounds.height];
          stableFrames = previous && sample.every((value, index) => value === previous[index])
            ? stableFrames + 1 : 0;
          previous = sample;
        }
        const rect = this.getBoundingClientRect();
        const x = rect.left + (rect.width / 2);
        const y = rect.top + (rect.height / 2);
        const hit = document.elementFromPoint(x, y);
        let composedTarget = this;
        let hitIsTarget = false;
        while (composedTarget) {
          if (hit === composedTarget || composedTarget.contains?.(hit)) {
            hitIsTarget = true;
            break;
          }
          composedTarget = composedTarget.getRootNode?.()?.host || null;
        }
        return {
          connected: this.isConnected,
          layoutStable: stableFrames >= 2,
          x,
          y,
          width: rect.width,
          height: rect.height,
          disabled: this.disabled === true || this.getAttribute?.('aria-disabled') === 'true',
          text: String(this.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240),
          hit: hit ? {
            tag: hit.localName,
            id: hit.id || '',
            className: typeof hit.className === 'string' ? hit.className : '',
            text: String(hit.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240),
          } : null,
          hitIsTarget,
        };
      }`,
      awaitPromise: true,
      returnByValue: true,
    });
    const value = position.result?.value;
    // A background save/render can replace mount.innerHTML during the RAFs.
    // No pointer has been dispatched yet. Re-resolve only a proved detached
    // handle, once; a hidden/disabled/covered live node is still a hard failure.
    if (value?.connected === false && allowDetachedRetry) {
      const fresh = await evaluate(cdp, `(() => {
        const element = ${expression};
        const rect = element?.getBoundingClientRect();
        return Boolean(element?.isConnected && rect?.width > 0 && rect?.height > 0);
      })()`);
      if (fresh) {
        prePointerReacquisitions.push({ label, oldConnected: false, beforePointer: true });
        return await elementInteractionPoint(cdp, expression, label,
          { requireEnabled, allowDetachedRetry: false });
      }
    }
    assert.equal(value?.layoutStable, true, `${label} did not settle before pointer input.`);
    assert.ok(value?.width > 0 && value?.height > 0,
      `${label} has no interactive bounds: ${JSON.stringify(value)}.`);
    if (requireEnabled) assert.equal(value.disabled, false, `${label} is disabled: ${value.text}`);
    assert.equal(value.hitIsTarget, true, `${label} is covered at its center: ${JSON.stringify(value.hit)}.`);
    return value;
  } finally {
    await cdp.send('Runtime.releaseObject', { objectId }).catch(() => {});
  }
}

async function clickActualExpression(cdp, expression, label, options) {
  await cdp.send('Page.bringToFront');
  const point = await elementInteractionPoint(cdp, expression, label, options);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: point.x, y: point.y, button: 'none', pointerType: 'mouse',
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1,
    buttons: 1, pointerType: 'mouse',
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1,
    buttons: 0, pointerType: 'mouse',
  });
  await pause(25);
  return point;
}

const clickActual = (cdp, selector, options) => clickActualExpression(
  cdp, visibleElementExpression(selector), selector, options,
);

const clickActualDeepText = (cdp, text, options) => clickActualExpression(
  cdp, deepTextElementExpression(text), `deep text ${JSON.stringify(text)}`, options,
);

async function pressActualKey(cdp, key, code = key, modifiers = 0) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key, code, modifiers,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key, code, modifiers,
  });
}

async function closeActualOverlays(cdp, count = 5) {
  for (let index = 0; index < count; index += 1) await pressActualKey(cdp, 'Escape', 'Escape');
  // Player introduction deliberately closes through its actual Start making
  // action. Escape alone leaves this modal over the diagnostic wallet button.
  if (await evaluate(cdp, `Boolean(${visibleElementExpression('#makerV4PlayerMount #makerPlayerInfoDialog')})`)) {
    await clickActual(cdp, '#makerV4PlayerMount [data-action="close-player-info"]');
    await waitForExpression(cdp, `!Boolean(${visibleElementExpression('#makerV4PlayerMount #makerPlayerInfoDialog')})`, {
      label: 'Player introduction closed through its real action',
    });
  }
}

async function typeActualText(cdp, selector, value) {
  await clickActual(cdp, selector);
  assert.equal(await evaluate(cdp, `document.activeElement === document.querySelector(${JSON.stringify(selector)})`),
    true, `${selector} must receive actual pointer focus before typing.`);
  const modifiers = await evaluate(cdp, `/Mac|iPhone|iPad/.test(navigator.platform) ? 4 : 2`);
  for (const type of ['rawKeyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', {
      type, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers,
      // CDP does not infer the host editor command from every platform shortcut.
      // Dispatch the native editing command with the key, never mutate input.value.
      ...(type === 'rawKeyDown' ? { commands: ['selectAll'] } : {}),
    });
  }
  assert.equal(await evaluate(cdp, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    return input.selectionStart === 0 && input.selectionEnd === input.value.length;
  })()`), true, `${selector} native Select All must cover the existing value.`);
  await cdp.send('Input.insertText', { text: String(value) });
}

async function actualFileInput(cdp, selector, filePath) {
  const state = await evaluate(cdp, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    return input ? { disabled: input.disabled === true, count: input.files?.length || 0 } : null;
  })()`);
  if (!state || state.disabled) return false;
  await cdp.send('DOM.enable');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const documentNode = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const match = await cdp.send('DOM.querySelector', {
        nodeId: documentNode.root.nodeId,
        selector,
      });
      if (!match.nodeId) return false;
      await cdp.send('DOM.setFileInputFiles', { nodeId: match.nodeId, files: [filePath] });
      break;
    } catch (error) {
      // Only explicit pre-action stale-node rejection is safe to retry.
      if (attempt !== 0 || !String(error.message).includes('Could not find node with given id')) throw error;
    }
  }
  await pause(100);
  return true;
}

async function createProtectedProductPage(browser, firewall, url, viewport, side) {
  const target = await browser.send('Target.createTarget', { url: 'about:blank' });
  const record = await firewall.waitForTarget(
    (candidate) => candidate.targetId === target.targetId,
    `${side} production page`,
  );
  await setViewport(record.session, viewport);
  await navigatePage(record.session, url);
  try {
    await waitForExpression(record.session, `(() => (
      document.readyState === 'complete'
      && Boolean(globalThis.__ANIMACRAFT_ACCEPTANCE_INSPECTOR__)
      && Boolean(document.querySelector('script[type="module"][src*="/app.js"]'))
      && Boolean(document.querySelector('#walletButton'))
      && Boolean(document.querySelector('#makerV4CreatorMount'))
      && Boolean(document.querySelector('#suiWalletModal'))
      && (
        document.querySelector('#templateGrid')?.childElementCount > 0
        || document.querySelector('#makerV4CreatorMount')?.dataset.runtimeState === 'error'
      )
    ))()`, { timeoutMs: 60_000, label: `${side} exact production entry` });
  } catch (error) {
    const debug = await evaluate(record.session, `({
      href: location.href,
      readyState: document.readyState,
      body: document.body?.innerText?.slice(0, 2400) || '',
      creatorRuntimeState: document.querySelector('#makerV4CreatorMount')?.dataset.runtimeState || '',
      creatorRuntimeText: document.querySelector('#makerV4CreatorMount')?.innerText?.slice(0, 2400) || '',
      scripts: [...document.scripts].map((script) => script.src),
      errors: [...(globalThis.__ANIMACRAFT_NETWORK_TRIPWIRE__?.errors || [])],
    })`).catch((debugError) => ({ debugError: String(debugError) }));
    throw new Error(`${error.message}\n${side} production entry debug: ${JSON.stringify(debug, null, 2)}`);
  }
  const bootstrapFailure = await evaluate(record.session, `(() => {
    const mount = document.querySelector('#makerV4CreatorMount');
    return mount?.dataset.runtimeState === 'error' ? String(mount.textContent || '').trim() : '';
  })()`);
  assert.equal(bootstrapFailure, '', `${side} production bootstrap failed: ${bootstrapFailure}`);
  const evidence = await evaluate(record.session, `({
    href: location.href,
    entryScript: document.querySelector('script[type="module"][src*="/app.js"]')?.src || '',
    developmentClientPresent: Boolean(document.querySelector('script[src="/@vite/client"]')),
    fixtureApiPresent: Boolean(globalThis.__APPROVED_PRODUCT_BROWSER__),
    inspectorPresent: Boolean(globalThis.__ANIMACRAFT_ACCEPTANCE_INSPECTOR__),
    resources: performance.getEntriesByType('resource').map((entry) => entry.name)
      .filter((name) => /(?:^|\\/)app\\.js(?:[?#]|$)/.test(name)),
  })`);
  assert.equal(new URL(evidence.href).origin, new URL(url).origin, `${side} left its own production origin.`);
  assert.equal(new URL(evidence.href).pathname, '/index.html', `${side} left its own production entry.`);
  assert.equal(evidence.fixtureApiPresent, false, `${side} production entry exposed a fixture renderer.`);
  assert.equal(evidence.developmentClientPresent, false, `${side} production page retained Vite's HMR client.`);
  assert.equal(evidence.inspectorPresent, true, `${side} production inspector preload is missing.`);
  assert.equal(new URL(evidence.entryScript).pathname, '/app.js', `${side} did not load its own app.js.`);
  assert.equal(new URL(evidence.entryScript).origin, new URL(url).origin, `${side} linked another root's app.js.`);
  assert.ok(
    evidence.resources.some((resource) => new URL(resource).pathname === '/app.js'),
    `${side} app.js was not fetched as a production resource.`,
  );
  return Object.freeze({ record, cdp: record.session, evidence });
}

async function connectActualWallet(cdp, side) {
  const alreadyConnected = await evaluate(cdp, `document.querySelector('#walletButton')?.classList.contains('connected') === true`);
  if (alreadyConnected) return;
  await clickActual(cdp, '#walletButton');
  await pause(250);
  const pointerOpened = await evaluate(cdp, `document.querySelector(
    '#suiWalletModal'
  )?.shadowRoot?.querySelector('dialog')?.open === true`);
  if (!pointerOpened) {
    const active = await evaluate(cdp, `(() => {
      let element = document.activeElement;
      while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
      return element ? { id: element.id || '', text: String(element.textContent || '').trim() } : null;
    })()`);
    assert.equal(active?.id, 'walletButton', `${side} pointer interaction did not focus Wallet.`);
    await pressActualKey(cdp, 'Enter', 'Enter');
  }
  try {
    await waitForExpression(cdp, `Boolean(${deepTextElementExpression('Approved Browser Wallet')})`, {
      timeoutMs: 10_000,
      label: `${side} Wallet Standard option`,
    });
  } catch (error) {
    const debug = await evaluate(cdp, `(() => {
      const modal = document.querySelector('#suiWalletModal');
      const shadowRows = [];
      const visit = (root, depth = 0) => {
        for (const element of root.querySelectorAll('*')) {
          const text = String(element.textContent || '').replace(/\\s+/g, ' ').trim();
          if (text) shadowRows.push({ tag: element.localName, depth, text: text.slice(0, 300) });
          if (element.shadowRoot?.mode === 'open') visit(element.shadowRoot, depth + 1);
        }
      };
      visit(document);
      return {
        modalText: modal?.shadowRoot?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        dialogOpen: modal?.shadowRoot?.querySelector('dialog')?.open === true,
        wallets: (modal?.instance?.stores?.$wallets?.get?.() || []).map((wallet) => ({
          id: wallet.id, name: wallet.name,
        })),
        shadowRows: shadowRows.slice(-100),
      };
    })()`);
    throw new Error(`${error.message}\n${side} wallet debug: ${JSON.stringify(debug, null, 2)}`);
  }
  await clickActualDeepText(cdp, 'Approved Browser Wallet');
  await waitForExpression(cdp, `document.querySelector('#walletButton')?.classList.contains('connected') === true`, {
    timeoutMs: 30_000,
    label: `${side} Wallet Standard connection`,
  });
}

async function openActualAccountPage(cdp, page) {
  const panelOpen = await evaluate(cdp, `document.querySelector('#accountPanel')?.classList.contains('active') === true`);
  if (!panelOpen) await clickActual(cdp, '#accountButton');
  await waitForExpression(cdp, `document.querySelector('#accountPanel')?.classList.contains('active') === true`, {
    label: 'approved account panel',
  });
  await clickActual(cdp, `#accountPanel [data-page="${page}"]`);
  await closeActualOverlays(cdp, 1);
  await waitForExpression(cdp, `document.querySelector('#${page}')?.classList.contains('active') === true`, {
    label: `approved ${page} page`,
  });
}

async function ensureActualCreatorEditor(cdp) {
  await closeActualOverlays(cdp);
  const creatorActive = await evaluate(cdp, `document.querySelector('#creator')?.classList.contains('active') === true`);
  if (!creatorActive) await openActualAccountPage(cdp, 'creator');
  const packStudioVisible = await evaluate(
    cdp,
    `Boolean(${visibleElementExpression('#makerV4CreatorMount [data-expansion-pack-workspace]')})`,
  );
  if (packStudioVisible) {
    await clickActual(
      cdp,
      '#makerV4CreatorMount [data-expansion-pack-workspace] [data-action="request-back-to-maker"]',
    );
    await waitForExpression(
      cdp,
      `!Boolean(${visibleElementExpression('#makerV4CreatorMount [data-expansion-pack-workspace]')})`,
      { timeoutMs: 30_000, label: 'approved return from Expansion Pack Studio' },
    );
    await closeActualOverlays(cdp);
  }
  const shellVisible = await evaluate(cdp, `Boolean(${visibleElementExpression('#makerV4CreatorMount .v4-studio-shell')})`);
  if (!shellVisible) {
    await clickActual(cdp, '#imageMakerList [data-edit-maker]');
    await waitForExpression(cdp, `Boolean(${visibleElementExpression('#makerV4CreatorMount .v4-studio-shell')})`, {
      timeoutMs: 30_000,
      label: 'approved Creator editor',
    });
  }
}

async function createActualMakerDraft(cdp, side, seed, pngPath) {
  await connectActualWallet(cdp, side);
  await openActualAccountPage(cdp, 'creator');
  await waitForExpression(cdp, `document.querySelector('#creatorConsole')?.hidden === false`, {
    label: `${side} Creator console`,
  });
  await clickActual(cdp, '[data-new-maker-panel]');
  await waitForExpression(cdp, `document.querySelector('#makerRegistrationModal')?.classList.contains('active') === true`, {
    label: `${side} Maker registration`,
  });
  await typeActualText(cdp, '#newMakerName', seed.makerName);
  await clickActual(cdp, '#registerMaker');
  await waitForExpression(cdp, `Boolean(${visibleElementExpression('#makerV4CreatorMount .v4-studio-shell')})`, {
    timeoutMs: 60_000,
    label: `${side} created Maker editor`,
  });
  const uploadAttempted = await actualFileInput(
    cdp,
    '#makerV4CreatorMount input[data-action="style-asset"]',
    pngPath,
  );
  if (uploadAttempted) await pause(500);
  return Object.freeze({
    uploadAttempted,
    playerReady: await evaluate(cdp, `(() => {
      const control = document.querySelector('#makerV4CreatorMount [data-action="open-player"]');
      return Boolean(control && !control.disabled && control.getAttribute('aria-disabled') !== 'true');
    })()`),
  });
}

async function runChildTargetAttackMatrix(cdp, firewall, server, alternateOrigin, side) {
  await firewall.waitForIdle();
  const priorSessions = new Set(firewall.records.map(({ sessionId }) => sessionId));
  const priorRootPaused = firewall.rootPaused.length;
  const ownOrigin = server.origin;
  const dedicatedWorkerSource = `self.onmessage = ({ data }) => {
    fetch(data.url, { method: 'POST', body: data.kind })
      .then(() => self.postMessage({ kind: data.kind, blocked: false }))
      .catch((error) => self.postMessage({
        kind: data.kind, blocked: String(error?.message || error),
      }));
  };`;
  const sharedWorkerSource = `self.onconnect = ({ ports: [port] }) => {
    port.onmessage = ({ data }) => {
      fetch(data.url, { method: 'POST', body: data.kind })
        .then(() => port.postMessage({ kind: data.kind, blocked: false }))
        .catch((error) => port.postMessage({
          kind: data.kind, blocked: String(error?.message || error),
        }));
    };
    port.start();
  };`;
  const nestedWorkerLeafSource = `self.onmessage = ({ data }) => {
    fetch(data.url, { method: 'POST', body: data.kind })
      .then(() => self.postMessage({ kind: data.kind, blocked: false }))
      .catch((error) => self.postMessage({
        kind: data.kind, blocked: String(error?.message || error),
      }));
  };`;
  const nestedWorkerParentSource = `self.onmessage = ({ data }) => {
    const nestedUrl = URL.createObjectURL(new Blob([data.source], { type: 'text/javascript' }));
    const nested = new Worker(nestedUrl);
    const finish = (result) => {
      nested.terminate();
      URL.revokeObjectURL(nestedUrl);
      self.postMessage(result);
    };
    nested.onmessage = ({ data: result }) => finish(result);
    nested.onerror = ({ message }) => finish({ kind: data.probe.kind, blocked: String(message) });
    nested.postMessage(data.probe);
  };`;
  let result;
  try {
    result = await evaluate(cdp, `(async () => {
    const marker = 'ANIMACRAFT_ACCEPTANCE_NETWORK_WRITE_BLOCKED';
    const timeout = (label) => new Promise((_, reject) => setTimeout(
      () => reject(new Error('Target probe timed out: ' + label)), 15000,
    ));
    const withTimeout = (label, promise) => Promise.race([promise, timeout(label)]);
    const frames = [];
    const workers = [];
    const urls = [];
    let popup = null;
    let registration = null;
    const windowProbe = (kind, url, openPopup = false) => withTimeout(kind, new Promise((resolve, reject) => {
      const listener = (event) => {
        if (event.data?.source !== 'animacraft-target-probe'
          || event.data?.result?.kind !== kind) return;
        window.removeEventListener('message', listener);
        resolve(event.data.result);
      };
      window.addEventListener('message', listener);
      if (openPopup) {
        popup = window.open(url, 'animacraft-target-probe-' + ${JSON.stringify(side)});
        if (!popup) {
          window.removeEventListener('message', listener);
          reject(new Error('Target probe popup was blocked.'));
        }
      } else {
        const frame = document.createElement('iframe');
        frame.hidden = true;
        frame.src = url;
        frames.push(frame);
        document.body.append(frame);
      }
    }));
    try {
      const sameFrame = await windowProbe('iframe',
        ${JSON.stringify(`${ownOrigin}${fixtureUrlPath}?kind=iframe`)});
      const oopif = await windowProbe('oopif',
        ${JSON.stringify(`${alternateOrigin}${fixtureUrlPath}?kind=oopif`)});
      const popupResult = await windowProbe('popup',
        ${JSON.stringify(`${ownOrigin}${fixtureUrlPath}?kind=popup`)}, true);

      const workerSource = ${JSON.stringify(dedicatedWorkerSource)};
      const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
      urls.push(workerUrl);
      const worker = new Worker(workerUrl);
      workers.push(worker);
      const dedicated = await withTimeout('worker', new Promise((resolve) => {
        worker.onmessage = ({ data }) => resolve(data);
        worker.postMessage({
          kind: 'worker',
          url: location.origin + '/__acceptance_write_probe__/target-worker',
        });
      }));

      const nestedParentSource = ${JSON.stringify(nestedWorkerParentSource)};
      const nestedParentUrl = URL.createObjectURL(new Blob(
        [nestedParentSource], { type: 'text/javascript' },
      ));
      urls.push(nestedParentUrl);
      const nestedParent = new Worker(nestedParentUrl);
      workers.push(nestedParent);
      const nestedWorker = await withTimeout('nested_worker', new Promise((resolve) => {
        nestedParent.onmessage = ({ data }) => resolve(data);
        nestedParent.postMessage({
          source: ${JSON.stringify(nestedWorkerLeafSource)},
          probe: {
            kind: 'nested_worker',
            url: location.origin + '/__acceptance_write_probe__/target-nested_worker',
          },
        });
      }));

      const sharedSource = ${JSON.stringify(sharedWorkerSource)};
      const sharedUrl = URL.createObjectURL(new Blob([sharedSource], { type: 'text/javascript' }));
      urls.push(sharedUrl);
      const shared = new SharedWorker(sharedUrl, 'animacraft-target-probe-' + ${JSON.stringify(side)});
      workers.push(shared);
      const sharedWorker = await withTimeout('shared_worker', new Promise((resolve) => {
        shared.port.onmessage = ({ data }) => resolve(data);
        shared.port.start();
        shared.port.postMessage({
          kind: 'shared_worker',
          url: location.origin + '/__acceptance_write_probe__/target-shared_worker',
        });
      }));

      const scope = '/__acceptance_sw_scope__/${side}/';
      registration = await withTimeout('service_worker registration',
        navigator.serviceWorker.register(
          '/__acceptance_target_service_worker__.js?side=' + encodeURIComponent(${JSON.stringify(side)}),
          { scope },
        ));
      await withTimeout('service_worker activation', new Promise((resolve) => {
        const active = registration.active;
        if (active?.state === 'activated') { resolve(); return; }
        const target = active || registration.waiting || registration.installing;
        if (!target) { resolve(); return; }
        target.addEventListener('statechange', () => {
          if (target.state === 'activated') resolve();
        });
      }));
      const serviceWorker = await withTimeout('service_worker', new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = ({ data }) => resolve(data);
        (registration.active || registration.waiting).postMessage(
          { kind: 'service_worker' }, [channel.port2],
        );
      }));
      const results = [
        sameFrame, oopif, popupResult, dedicated, nestedWorker, sharedWorker, serviceWorker,
      ];
      if (results.some((entry) => !String(entry?.blocked || '').includes(marker))) {
        throw new Error('A child target POST was not blocked before native network: '
          + JSON.stringify(results));
      }
      return results;
    } finally {
      frames.forEach((frame) => frame.remove());
      popup?.close?.();
      workers.forEach((worker) => {
        worker.terminate?.();
        worker.port?.close?.();
      });
      urls.forEach((url) => URL.revokeObjectURL(url));
      if (registration?.unregister) {
        await Promise.race([
          registration.unregister().catch(() => false),
          new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
        ]);
      }
    }
    })()`);
  } catch (error) {
    let idleError = '';
    try { await firewall.waitForIdle(); } catch (caught) { idleError = String(caught?.stack || caught); }
    const diagnostics = firewall.records.filter(({ sessionId }) => !priorSessions.has(sessionId))
      .map((record) => ({
        type: record.type,
        url: record.url,
        waitingForDebugger: record.waitingForDebugger,
        preloadInstalled: record.preloadInstalled,
        fetchInstalled: record.fetchInstalled,
        networkBlockInstalled: record.networkBlockInstalled,
        cdpFirewallKind: record.cdpFirewallKind,
        observerInstalled: record.observerInstalled,
        resumed: record.resumed,
        protectionStage: record.protectionStage,
        paused: record.paused,
        blocked: record.blocked,
        errors: record.errors,
      }));
    throw new Error(`${String(error?.stack || error)}\n${side} recursive target diagnostics: `
      + `${JSON.stringify({ idleError, diagnostics, serverRequests: server.requestLog }, null, 2)}`);
  }
  await firewall.waitForIdle();
  const records = firewall.records.filter(({ sessionId }) => !priorSessions.has(sessionId));
  const required = [
    ['popup', (record) => record.type === 'page' && Boolean(record.openerId)],
    ['oopif', (record) => record.type === 'iframe'],
    ['worker', (record) => record.type === 'worker'],
    ['nested_worker', (record) => record.type === 'worker'
      && records.some((parent) => parent.type === 'worker'
        && parent.sessionId === record.parentSessionId)],
    ['shared_worker', (record) => record.type === 'shared_worker'],
    ['service_worker', (record) => record.type === 'service_worker'],
  ];
  for (const [label, predicate] of required) {
    const record = records.find(predicate);
    assert.ok(record, `${side} did not auto-attach the ${label} target before execution.`);
    assert.equal(record.preloadInstalled, true, `${side} ${label} target has no preload.`);
    assert.equal(
      record.fetchInstalled || record.networkBlockInstalled,
      true,
      `${side} ${label} target has no target-local CDP network barrier.`,
    );
    assert.equal(record.observerInstalled, true, `${side} ${label} target has no observer.`);
    assert.equal(record.resumed, true, `${side} ${label} target was not resumed after protection.`);
    assert.equal(
      record.recursiveAutoAttachInstalled,
      true,
      `${side} ${label} target has no recursive child auto-attach.`,
    );
  }
  const escaped = [
    ...firewall.rootPaused.slice(priorRootPaused),
    ...records.flatMap(({ paused }) => paused),
  ].filter(({ url }) => String(url).includes('/__acceptance_write_probe__/'));
  assert.deepEqual(escaped, [], `${side} child-target POST reached the CDP Fetch barrier.`);
  assert.deepEqual(server.requestLog, [], `${side} child-target POST reached the HTTP server.`);
  return Object.freeze({
    result,
    protectedTargetTypes: records.map(({ type }) => type).sort(),
    serverRequestCount: server.requestLog.length,
  });
}

async function actualTheme(cdp, theme) {
  const selected = await evaluate(cdp, `document.querySelector(
    ${JSON.stringify(`[data-theme-option="${theme}"]`)}
  )?.getAttribute('aria-checked') === 'true'`);
  if (selected) return;
  await closeActualOverlays(cdp);
  await clickActual(cdp, '#themeButton');
  await clickActual(cdp, `[data-theme-option="${theme}"]`);
  await waitForExpression(cdp, `document.querySelector(
    ${JSON.stringify(`[data-theme-option="${theme}"]`)}
  )?.getAttribute('aria-checked') === 'true'`, { label: `approved ${theme} theme` });
}

async function actualLocale(cdp, locale) {
  const current = await evaluate(cdp, `document.querySelector('#accountLanguage')?.value || ''`);
  if (current === locale) return;
  const order = ['en', 'zh', 'ja', 'ko', 'vi'];
  const index = order.indexOf(locale);
  assert.ok(index >= 0, `Unsupported acceptance locale: ${locale}.`);
  const panelOpen = await evaluate(cdp, `document.querySelector('#accountPanel')?.classList.contains('active') === true`);
  if (!panelOpen) await clickActual(cdp, '#accountButton');
  await clickActual(cdp, '#accountLanguage');
  await pressActualKey(cdp, 'Home', 'Home');
  for (let offset = 0; offset < index; offset += 1) {
    await pressActualKey(cdp, 'ArrowDown', 'ArrowDown');
  }
  await pressActualKey(cdp, 'Enter', 'Enter');
  await waitForExpression(cdp, `document.querySelector('#accountLanguage')?.value === ${JSON.stringify(locale)}`, {
    label: `approved ${locale} locale`,
  });
  await closeActualOverlays(cdp, 1);
}

async function openActualPlayerIntro(cdp) {
  await ensureActualCreatorEditor(cdp);
  if (process.env.ANIMACRAFT_BROWSER_DIAGNOSTIC_PLAYER_DECODE_DELAY_MS) {
    const delay = Number(process.env.ANIMACRAFT_BROWSER_DIAGNOSTIC_PLAYER_DECODE_DELAY_MS);
    await evaluate(cdp, `(() => {
      const NativeImage = globalThis.Image;
      const evidence = globalThis.__ANIMACRAFT_PLAYER_DECODE_DIAGNOSTIC__ = { delayMs: ${delay}, events: [] };
      const sample = () => {
        const canvas = document.querySelector('#makerV4PlayerCanvas');
        return canvas ? { width: canvas.width, height: canvas.height,
          rows: getComputedStyle(canvas.parentElement).gridTemplateRows,
          render: document.querySelector('#v4PlayerRenderStatus')?.dataset.state } : null;
      };
      globalThis.Image = function(...args) {
        const image = new NativeImage(...args);
        let onload;
        Object.defineProperty(image, 'onload', { get: () => onload, set: value => { onload = value; } });
        image.addEventListener('load', event => {
          evidence.events.push({ phase: 'decoded-before-canvas-write', canvas: sample() });
          setTimeout(() => {
            onload?.call(image, event);
            queueMicrotask(() => evidence.events.push({ phase: 'after-canvas-write', canvas: sample() }));
          }, ${delay});
        });
        return image;
      };
      globalThis.Image.prototype = NativeImage.prototype;
    })()`);
  }
  await clickActual(cdp, '#makerV4CreatorMount [data-action="open-player"]');
  await waitForExpression(cdp, `Boolean(${visibleElementExpression('#makerV4PlayerMount #makerPlayerInfoDialog')})`, {
    timeoutMs: 60_000,
    label: 'approved Player introduction',
  });
}

async function driveActualProductState(cdp, state, locale, theme) {
  await actualLocale(cdp, locale);
  await actualTheme(cdp, theme);
  await closeActualOverlays(cdp);
  if (state.id === 'header') {
    await clickActual(cdp, '.main-nav [data-page="templates"]');
    await waitForExpression(cdp, `document.querySelector('#templates')?.classList.contains('active') === true`, {
      label: 'approved Templates page',
    });
  } else if (state.id === 'theme-menu') {
    await clickActual(cdp, '#themeButton');
    await waitForExpression(cdp, `document.querySelector('#themeMenu')?.getAttribute('aria-hidden') === 'false'`, {
      label: 'approved theme menu',
    });
  } else if (state.id === 'mypage') {
    await clickActual(cdp, '#accountButton');
    await waitForExpression(cdp, `document.querySelector('#accountPanel')?.getAttribute('aria-hidden') === 'false'`, {
      label: 'approved MyPage panel',
    });
  } else if (state.id.startsWith('creator:')) {
    await ensureActualCreatorEditor(cdp);
    if (state.id === 'creator:pack-studio') {
      const expansionsSelected = await evaluate(cdp, `document.querySelector(
        '#makerV4CreatorMount [data-tab="expansions"]'
      )?.getAttribute('aria-selected') === 'true'`);
      if (!expansionsSelected) {
        await clickActual(cdp, '#makerV4CreatorMount [data-tab="expansions"]');
      }
      await waitForExpression(cdp, `document.querySelector(
        '#makerV4CreatorMount [data-tab="expansions"]'
      )?.getAttribute('aria-selected') === 'true'`, {
        label: 'approved Creator expansions tab before Pack Studio',
      });
      const packSelector = '#makerV4CreatorMount [data-action="open-expansion-pack-studio"]';
      const previousPackKeys = await evaluate(cdp, `Array.from(document.querySelectorAll(${JSON.stringify(packSelector)}),
        node => node.dataset.packProjectKey)`);
      await clickActual(cdp, '#makerV4CreatorMount [data-action="add-expansion"]');
      const newPackKey = await waitForExpression(cdp, `Array.from(document.querySelectorAll(${JSON.stringify(packSelector)}))
        .find(node => !${JSON.stringify(previousPackKeys)}.includes(node.dataset.packProjectKey))?.dataset.packProjectKey`,
      { label: 'new local Pack listed after add-expansion' });
      await clickActual(cdp, `${packSelector}[data-pack-project-key=${JSON.stringify(newPackKey)}]`);
      await waitForExpression(
        cdp,
        `Boolean(${visibleElementExpression('#makerV4CreatorMount [data-expansion-pack-workspace]')})`,
        { timeoutMs: 30_000, label: 'approved Expansion Pack Studio opened from its new listed draft' },
      );
      await waitForExpression(cdp, `document.querySelector('#expansionPackRenderStatus')?.textContent?.startsWith('Merged preview ready: ')`,
        { label: 'current Pack Studio merged preview' });
    } else if (state.id === 'creator:version-history') {
      await clickActual(cdp, '#makerV4CreatorMount [data-action="open-version-history"]');
      await waitForExpression(cdp, `Boolean(${visibleElementExpression('#makerV4CreatorMount .v4-version-history-dialog')})`, {
        label: 'approved Version history dialog',
      });
    } else if (state.id === 'creator:manage-status') {
      await clickActual(cdp, '#makerV4CreatorMount [data-action="manage-lifecycle"]');
      await waitForExpression(cdp, `document.querySelector('#makerLifecycleManagerModal')?.getAttribute('aria-hidden') === 'false'`, {
        label: 'approved Manage status dialog',
      });
    } else {
      const tab = state.id.slice('creator:'.length);
      await clickActual(cdp, `#makerV4CreatorMount [data-tab="${tab}"]`);
      await waitForExpression(cdp, `document.querySelector(
        ${JSON.stringify(`#makerV4CreatorMount [data-tab="${tab}"]`)}
      )?.getAttribute('aria-selected') === 'true'`, { label: `approved Creator ${tab} tab` });
    }
  } else if (state.id === 'player:intro') {
    await openActualPlayerIntro(cdp);
  } else if (state.id === 'player:workspace') {
    const playerVisible = await evaluate(cdp, `Boolean(${visibleElementExpression('#makerV4PlayerMount .v4-player-shell')})`);
    if (!playerVisible) await openActualPlayerIntro(cdp);
    const infoVisible = await evaluate(cdp, `Boolean(${visibleElementExpression('#makerV4PlayerMount #makerPlayerInfoDialog')})`);
    if (infoVisible) await clickActual(cdp, '#makerV4PlayerMount [data-action="close-player-info"]');
    await waitForExpression(cdp, `Boolean(${visibleElementExpression('#makerV4PlayerMount .v4-player-shell')})
      && !Boolean(${visibleElementExpression('#makerV4PlayerMount #makerPlayerInfoDialog')})`, {
      timeoutMs: 30_000,
      label: 'approved Player workspace',
    });
  } else {
    throw new Error(`Unknown approved product state: ${state.id}.`);
  }
  return readProductStateIdentity(cdp, state);
}

async function readProductStateIdentity(cdp, state) {
  return evaluate(cdp, `({
    id: ${JSON.stringify(state.id)},
    route: document.querySelector('.page.active')?.id || '',
    captureIdentity: {
      selector: ${JSON.stringify(state.captureIdentitySelector)},
      count: document.querySelectorAll(${JSON.stringify(state.captureIdentitySelector)}).length,
    },
    tabIds: [...document.querySelectorAll('#makerV4CreatorMount [role="tab"][data-tab]')]
      .map((tab) => tab.dataset.tab),
  })`);
}

async function captureProductState(cdp, state, result) {
  const formState = await evaluate(cdp, `(() => {
    const root = document.querySelector(${JSON.stringify(state.rootSelector)});
    return [...root.querySelectorAll('input, select, textarea')].map(control => ({
      key: control.dataset.action || control.id || control.name || '',
      type: control.type || control.tagName.toLowerCase(),
      value: control.type === 'file' ? '' : control.value,
      checked: ['checkbox', 'radio'].includes(control.type) ? control.checked : null,
      disabled: control.disabled,
    }));
  })()`);
  const inspection = await evaluate(cdp, `globalThis.__ANIMACRAFT_ACCEPTANCE_INSPECTOR__.inspect(
    ${JSON.stringify(state.expectedSelectors)}
  )`);
  const snapshot = await evaluate(cdp, `globalThis.__ANIMACRAFT_ACCEPTANCE_INSPECTOR__.snapshot(
    ${JSON.stringify(state.rootSelector)}
  )`);
  const clip = await evaluate(cdp, `(() => {
    const root = document.querySelector(${JSON.stringify(state.rootSelector)});
    if (!root) throw new Error('Acceptance screenshot root is missing.');
    const rect = root.getBoundingClientRect();
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(innerWidth, rect.right);
    const bottom = Math.min(innerHeight, rect.bottom);
    if (right <= left || bottom <= top) throw new Error('Acceptance screenshot root is not visible.');
    return {
      x: scrollX + left,
      y: scrollY + top,
      width: right - left,
      height: bottom - top,
    };
  })()`);
  // This clip is already intersected with the visible viewport. Beyond-viewport
  // capture can resize the document and remove its scrollbar between samples.
  const screenshot = await capturePng(cdp, { clip, captureBeyondViewport: false });
  return { result, inspection, snapshot, screenshot, clip, formState };
}

async function showProductState(cdp, state, locale, theme) {
  await cdp.send('Page.bringToFront');
  const result = await driveActualProductState(cdp, state, locale, theme);
  if (state.id.startsWith('player:')) await waitForActualPlayerPreview(cdp);
  await waitForStableBrowserPaint(cdp);
  return captureProductState(cdp, state, result);
}

async function waitForActualPlayerPreview(cdp) {
  const dimensions = await evaluate(cdp, `(() => {
    const label = document.querySelector('#makerV4CreatorMount .v4-version-badge')?.textContent || '';
    const match = /([0-9]+)×([0-9]+)/.exec(label);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
  })()`);
  assert.ok(dimensions?.width > 0 && dimensions?.height > 0, 'Player capture requires the actual Creator document dimensions.');
  // Dialog visibility and render=ready precede asynchronous PNG decode. Until
  // drawCanonicalPng writes both attributes the new canvas is still 300×150,
  // which changes mobile grid geometry when its real square image arrives.
  // Wait for that actual draw, not arbitrary quiet time or a retried comparison.
  await waitForExpression(cdp, `(() => {
    const canvas = document.querySelector('#makerV4PlayerCanvas');
    return document.querySelector('#v4PlayerRenderStatus')?.dataset.state === 'ready'
      && canvas?.getAttribute('width') === ${JSON.stringify(String(dimensions.width))}
      && canvas?.getAttribute('height') === ${JSON.stringify(String(dimensions.height))};
  })()`, { timeoutMs: 30_000, label: 'Player canonical PNG decoded and drawn at the current document dimensions' });
}

async function waitForStableBrowserPaint(cdp) {
  await cdp.send('Page.bringToFront');
  await evaluate(cdp, `(async () => {
    await Promise.race([
      document.fonts?.ready || Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);
    document.getAnimations().forEach((animation) => {
      try { animation.finish(); } catch { animation.cancel(); }
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    return true;
  })()`);
}

function decodePngRgba(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(bytes.subarray(0, 8).equals(signature), 'Screenshot is not a PNG.');
  let offset = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const idat = [];
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, 'PNG chunk header is truncated.');
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    assert.ok(end + 4 <= bytes.length, `PNG ${type} chunk is truncated.`);
    const data = bytes.subarray(start, end);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') transparency = Buffer.from(data);
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset = end + 4;
  }
  assert.ok(header, 'PNG IHDR is missing.');
  assert.equal(header.bitDepth, 8, 'Acceptance screenshots require 8-bit PNG channels.');
  assert.equal(header.compression, 0, 'Unsupported PNG compression method.');
  assert.equal(header.filter, 0, 'Unsupported PNG filter method.');
  assert.equal(header.interlace, 0, 'Interlaced screenshots are not accepted.');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[header.colorType];
  assert.ok(channels, `Unsupported PNG color type ${header.colorType}.`);
  if (header.colorType === 3) assert.ok(palette, 'Indexed PNG has no palette.');
  const stride = header.width * channels;
  const encoded = inflateSync(Buffer.concat(idat));
  assert.equal(encoded.length, (stride + 1) * header.height, 'PNG scanline length drifted.');
  const raw = Buffer.alloc(stride * header.height);
  const paeth = (left, above, upperLeft) => {
    const prediction = left + above - upperLeft;
    const leftDistance = Math.abs(prediction - left);
    const aboveDistance = Math.abs(prediction - above);
    const upperLeftDistance = Math.abs(prediction - upperLeft);
    if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
    return aboveDistance <= upperLeftDistance ? above : upperLeft;
  };
  for (let y = 0; y < header.height; y += 1) {
    const sourceRow = y * (stride + 1);
    const targetRow = y * stride;
    const filterType = encoded[sourceRow];
    for (let x = 0; x < stride; x += 1) {
      const encodedByte = encoded[sourceRow + 1 + x];
      const left = x >= channels ? raw[targetRow + x - channels] : 0;
      const above = y > 0 ? raw[targetRow + x - stride] : 0;
      const upperLeft = y > 0 && x >= channels ? raw[targetRow + x - stride - channels] : 0;
      const predictor = filterType === 0 ? 0
        : filterType === 1 ? left
          : filterType === 2 ? above
            : filterType === 3 ? Math.floor((left + above) / 2)
              : filterType === 4 ? paeth(left, above, upperLeft)
                : null;
      assert.notEqual(predictor, null, `Unsupported PNG row filter ${filterType}.`);
      raw[targetRow + x] = (encodedByte + predictor) & 255;
    }
  }
  const rgba = Buffer.alloc(header.width * header.height * 4);
  for (let pixel = 0; pixel < header.width * header.height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 4;
    if (header.colorType === 6) {
      raw.copy(rgba, target, source, source + 4);
    } else if (header.colorType === 2) {
      rgba[target] = raw[source]; rgba[target + 1] = raw[source + 1];
      rgba[target + 2] = raw[source + 2]; rgba[target + 3] = 255;
    } else if (header.colorType === 0) {
      rgba[target] = raw[source]; rgba[target + 1] = raw[source];
      rgba[target + 2] = raw[source]; rgba[target + 3] = 255;
    } else if (header.colorType === 4) {
      rgba[target] = raw[source]; rgba[target + 1] = raw[source];
      rgba[target + 2] = raw[source]; rgba[target + 3] = raw[source + 1];
    } else {
      const paletteOffset = raw[source] * 3;
      assert.ok(paletteOffset + 2 < palette.length, 'PNG palette index is out of range.');
      rgba[target] = palette[paletteOffset];
      rgba[target + 1] = palette[paletteOffset + 1];
      rgba[target + 2] = palette[paletteOffset + 2];
      rgba[target + 3] = transparency?.[raw[source]] ?? 255;
    }
  }
  return Object.freeze({ width: header.width, height: header.height, rgba });
}

function compareRgba(left, right) {
  if (left.width !== right.width || left.height !== right.height) {
    return Object.freeze({
      equal: false,
      candidateDimensions: [left.width, left.height],
      repeatDimensions: [right.width, right.height],
      differentPixels: null,
      firstDifference: null,
      maxChannelDelta: null,
    });
  }
  let differentPixels = 0;
  let firstDifference = null;
  let maxChannelDelta = 0;
  for (let offset = 0; offset < left.rgba.length; offset += 4) {
    let pixelDifferent = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(left.rgba[offset + channel] - right.rgba[offset + channel]);
      if (delta) pixelDifferent = true;
      if (delta > maxChannelDelta) maxChannelDelta = delta;
    }
    if (!pixelDifferent) continue;
    differentPixels += 1;
    if (!firstDifference) {
      const pixel = offset / 4;
      firstDifference = {
        x: pixel % left.width,
        y: Math.floor(pixel / left.width),
        candidate: [...left.rgba.subarray(offset, offset + 4)],
        repeat: [...right.rgba.subarray(offset, offset + 4)],
      };
    }
  }
  return Object.freeze({
    equal: differentPixels === 0,
    candidateDimensions: [left.width, left.height],
    repeatDimensions: [right.width, right.height],
    differentPixels,
    firstDifference,
    maxChannelDelta,
  });
}

function firstStateDifference(left, right, path = '') {
  if (canonicalJson(left) === canonicalJson(right)) return null;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return { path, before: left, after: right };
  }
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const difference = firstStateDifference(left[key], right[key], `${path}/${key}`);
    if (difference) return difference;
  }
  return null;
}

async function showStableProductState(cdp, state, locale, theme, viewport, side) {
  const initialCapture = await showProductState(cdp, state, locale, theme);
  validateInspection(initialCapture, state, side);
  const first = { ...initialCapture, decoded: decodePngRgba(initialCapture.screenshot) };
  if (first.snapshot.viewport.width !== viewport.width || first.snapshot.viewport.height !== viewport.height) {
    const layout = await evaluate(cdp, `({
      innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth,
      visual: { width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale },
      meta: document.querySelector('meta[name="viewport"]')?.content,
      overflow: [...document.querySelectorAll('body *')].map(node => ({ node, r: node.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && r.right > ${viewport.width})
        .slice(0, 25).map(({ node, r }) => ({ tag: node.tagName, id: node.id, className: String(node.className),
          x: r.x, width: r.width, right: r.right, text: node.textContent.slice(0, 80) })),
    })`);
    const error = new Error(`${side} ${state.id} viewport drift: ${JSON.stringify(layout)}`);
    error.capture = first;
    throw error;
  }
  assert.ok(first.decoded.width > 0 && first.decoded.height > 0, `${side} ${state.id} RGBA capture is empty.`);
  const repeatedDecoded = [first.decoded];
  const repeatedCaptures = [first];
  for (let repeat = 1; repeat < manifest.capture.repetitions; repeat += 1) {
    await waitForStableBrowserPaint(cdp);
    const capture = await captureProductState(cdp, state, await readProductStateIdentity(cdp, state));
    validateInspection(capture, state, side);
    for (const field of ['result', 'snapshot', 'formState', 'clip']) {
      const difference = firstStateDifference(first[field], capture[field], field);
      if (difference) {
        const error = new Error(`${side} ${state.id} changed on repeat ${repeat + 1}: ${JSON.stringify(difference)}`);
        error.capture = first;
        error.repeatCapture = capture;
        throw error;
      }
    }
    const decoded = decodePngRgba(capture.screenshot);
    const repeatDifference = compareRgba(first.decoded, decoded);
    assert.equal(
      repeatDifference.equal,
      true,
      `${side} ${state.id} RGBA pixels were unstable on repeat ${repeat + 1}: `
        + JSON.stringify(repeatDifference),
    );
    repeatedDecoded.push(decoded);
    repeatedCaptures.push(capture);
  }
  return {
    ...first,
    repeatRgbaSha256: repeatedDecoded.map(({ rgba }) => sha256(rgba)),
    repeatStateSha256: repeatedCaptures.map(capture => Object.fromEntries(
      ['result', 'snapshot', 'formState', 'clip'].map(field => [field, sha256(canonicalJson(capture[field]))]),
    )),
  };
}


function validateInspection(capture, state, side) {
  assert.equal(capture.inspection.bodyStatus, 'complete', `${side} production document must remain complete.`);
  assert.deepEqual(
    capture.result.captureIdentity,
    { selector: state.captureIdentitySelector, count: 1 },
    `${side} ${state.id} did not expose its one distinct capture identity.`,
  );
  for (const expected of capture.inspection.expected) {
    assert.ok(expected.count > 0, `${side} ${state.id} is missing ${expected.selector}.`);
  }
  const authority = capture.inspection.writeAuthority;
  assert.equal(authority?.allowWalletSignature, false, `${side} wallet signature authority must be false.`);
  assert.equal(authority?.allowBroadcast, false, `${side} broadcast authority must be false.`);
  if (state.id.startsWith('creator:') && state.id !== 'creator:pack-studio') {
    assert.deepEqual(capture.result.tabIds, expectedCreatorTabs, `${side} must preserve all ten Creator tabs.`);
  }
}

async function writeStateArtifacts(artifactRoot, key, capture, summary) {
  const directory = join(artifactRoot, cleanName(key));
  await mkdir(directory, { recursive: true });
  const writes = [
    writeFile(join(directory, 'result.json'), `${JSON.stringify(summary, null, 2)}\n`),
  ];
  if (capture) writes.push(
    writeFile(join(directory, 'current.png'), capture.screenshot),
    writeFile(join(directory, 'current.snapshot.json'), `${JSON.stringify(capture.snapshot, null, 2)}\n`),
  );
  await Promise.all(writes);
  return directory;
}

async function assertAccountHandoff(cdp, connected, locale) {
  const links = await evaluate(cdp, `({
    competingCollection: Boolean(document.querySelector('#collection, [data-page="collection"], #refreshOwnedCharacters')),
    rows: ['soulidityMySoulsLink', 'soulidityProfileLink', 'soulidityCommunityLink', 'soulidityMarketLink']
      .map(id => { const link = document.getElementById(id); return {
        id, present: Boolean(link), href: link?.getAttribute('href'), disabled: link?.getAttribute('aria-disabled'),
      }; }),
  })`);
  assert.equal(links.competingCollection, false, 'MyPage must not expose a competing local asset route.');
  const paths = ['/my-souls', '/profile', '/community', '/market'];
  for (const [index, row] of links.rows.entries()) {
    assert.equal(row.present, true, `Missing handoff link ${row.id}`);
    const disabled = index < 2 && !connected;
    assert.equal(row.disabled, String(disabled), `${row.id} connection gate`);
    if (disabled) { assert.equal(row.href, '#'); continue; }
    const url = new URL(row.href);
    assert.equal(url.origin, 'https://www.soulidity.ai');
    assert.equal(url.pathname, paths[index]);
    assert.equal(url.searchParams.get('source'), 'animacraft');
    assert.equal(url.searchParams.get('lang'), locale);
    assert.equal(url.searchParams.get('wallet'), connected ? manifest.fixedSeed.creator : null);
  }
  return links;
}

async function browserSourceEvidence() {
  const paths = (await readdir(repositoryRoot, { withFileTypes: true }))
    .filter(entry => entry.isFile() && /\.(?:js|mjs|html|css|json)$/.test(entry.name))
    .map(entry => entry.name);
  for (const name of await readdir(join(repositoryRoot, 'public-v8'))) paths.push(`public-v8/${name}`);
  paths.push('test/approved-product-browser.test.js', fixtureRelativePath, manifestRelativePath,
    'test/helpers/chromium-cdp.mjs');
  return Promise.all(paths.sort().map(async path => ({
    path, sha256: sha256(await readFile(join(repositoryRoot, path))),
  })));
}

test('preload and CDP share the exact fail-closed semantic read classifier', () => {
  const serializedClassifier = Function(
    `${networkClassifierSource()}\nreturn { graphqlRequestOperationKind, forbiddenNetworkRequest };`,
  )();
  const graphqlBody = (query, extra = {}) => JSON.stringify({
    query, operationName: 'Acceptance', variables: {}, ...extra,
  });
  const graphqlGet = (parameters) => {
    const target = new URL('https://graphql.mainnet.sui.io/graphql');
    for (const [key, value] of Object.entries(parameters)) target.searchParams.set(key, value);
    return target.href;
  };
  const cases = [
    {
      label: 'single GraphQL query with variables, directives, and a referenced fragment',
      request: {
        url: 'https://graphql.mainnet.sui.io/graphql', method: 'POST',
        body: graphqlBody(`
          query Acceptance($include: Boolean! = true) {
            ...ChainFields @include(if: $include)
          }
          fragment ChainFields on Query { chainIdentifier }
        `),
      },
      operationKind: 'query',
      expected: 'external-network-read',
    },
    {
      label: 'single named GraphQL query may omit the unambiguous operationName',
      request: {
        url: 'https://graphql.mainnet.sui.io/graphql', method: 'POST',
        body: JSON.stringify({ query: 'query Acceptance { chainIdentifier }', variables: {} }),
      },
      operationKind: 'query',
      expected: 'external-network-read',
    },
    {
      label: 'GraphQL query accepts raw scalars and paired fixed and braced Unicode escapes',
      request: {
        url: 'https://graphql.mainnet.sui.io/graphql', method: 'POST',
        body: graphqlBody(
          'query Acceptance { field(raw: "😀", fixed: "\\uD83D\\uDE00", braced: "\\u{1F600}") }',
        ),
      },
      operationKind: 'query',
      expected: 'external-network-read',
    },
    {
      label: 'GraphQL operationName mismatch',
      request: {
        url: 'https://graphql.mainnet.sui.io/graphql', method: 'POST',
        body: graphqlBody('query Other { chainIdentifier }'),
      },
      operationKind: 'invalid',
      expected: 'network-write',
    },
    {
      label: 'anonymous GraphQL query rejects a supplied operationName',
      request: {
        url: 'https://graphql.mainnet.sui.io/graphql', method: 'POST',
        body: graphqlBody('{ chainIdentifier }'),
      },
      operationKind: 'invalid',
      expected: 'network-write',
    },
    ...[
      ['GraphQL empty selection set', 'query Acceptance {}'],
      ['GraphQL garbage token between operation name and selection', 'query Acceptance garbage { chainIdentifier }'],
      ['GraphQL unclosed argument list', 'query Acceptance { chainIdentifier(arg: 1 }'],
      ['GraphQL malformed fragment type condition', 'query Acceptance { ...Fields } fragment Fields on { chainIdentifier }'],
      ['GraphQL undefined fragment spread', 'query Acceptance { ...Missing }'],
      ['GraphQL fragment cycle', 'query Acceptance { ...A } fragment A on Query { ...B } fragment B on Query { ...A }'],
      ['GraphQL malformed directive arguments', 'query Acceptance { chainIdentifier @include(if:) }'],
      ['GraphQL non-spec whitespace', 'query\u00a0Acceptance { chainIdentifier }'],
      ['GraphQL empty argument list', 'query Acceptance { chainIdentifier() }'],
      ['GraphQL empty variable-definition list', 'query Acceptance() { chainIdentifier }'],
      ['GraphQL raw high surrogate in a string', 'query Acceptance { field(arg: "\ud800") }'],
      ['GraphQL raw low surrogate in a string', 'query Acceptance { field(arg: "\udc00") }'],
      ['GraphQL raw lone surrogate in a block string', 'query Acceptance { field(arg: """\ud800""") }'],
      ['GraphQL raw lone surrogate in a comment', 'query Acceptance { field } # \ud800'],
      ['GraphQL isolated high-surrogate escape', 'query Acceptance { field(arg: "\\uD800") }'],
      ['GraphQL isolated low-surrogate escape', 'query Acceptance { field(arg: "\\uDC00") }'],
    ].map(([label, query]) => ({
      label,
      request: {
        url: 'https://graphql.mainnet.sui.io/graphql', method: 'POST',
        body: graphqlBody(query),
      },
      operationKind: 'invalid',
      expected: 'network-write',
    })),
    {
      label: 'GraphQL mutation',
      request: {
        url: 'https://graphql.mainnet.sui.io/graphql', method: 'POST',
        body: graphqlBody('mutation Acceptance { publish }'),
      },
      operationKind: 'mutation',
      expected: 'graphql-mutation',
    },
    {
      label: 'GraphQL subscription',
      request: {
        url: 'https://graphql.mainnet.sui.io/graphql', method: 'POST',
        body: graphqlBody('subscription Acceptance { events }'),
      },
      operationKind: 'subscription',
      expected: 'graphql-subscription',
    },
    {
      label: 'GraphQL opaque bytes',
      request: {
        url: 'https://graphql.mainnet.sui.io/graphql', method: 'POST',
        body: new Uint8Array([0, 255, 1]),
      },
      operationKind: 'invalid',
      expected: 'network-write',
    },
    {
      label: 'GraphQL multiple operations',
      request: {
        url: 'https://graphql.mainnet.sui.io/graphql', method: 'POST',
        body: graphqlBody('query Acceptance { chainIdentifier } query Other { chainIdentifier }'),
      },
      operationKind: 'invalid',
      expected: 'network-write',
    },
    {
      label: 'unknown persisted GraphQL query',
      request: {
        url: 'https://graphql.mainnet.sui.io/graphql', method: 'POST',
        body: JSON.stringify({ extensions: { persistedQuery: { sha256Hash: '00' } } }),
      },
      operationKind: 'invalid',
      expected: 'network-write',
    },
    ...[
      {
        label: 'GraphQL GET query is rejected because this harness supports POST only',
        parameters: { query: 'query Acceptance { chainIdentifier }', operationName: 'Acceptance' },
      },
      {
        label: 'GraphQL GET mutation',
        parameters: { query: 'mutation Acceptance { publish }', operationName: 'Acceptance' },
      },
      {
        label: 'GraphQL GET subscription',
        parameters: { query: 'subscription Acceptance { events }', operationName: 'Acceptance' },
      },
      {
        label: 'GraphQL GET multiple operations',
        parameters: {
          query: 'query Acceptance { chainIdentifier } query Other { chainIdentifier }',
          operationName: 'Acceptance',
        },
      },
      {
        label: 'GraphQL GET persisted query',
        parameters: { extensions: JSON.stringify({ persistedQuery: { sha256Hash: '00' } }) },
      },
    ].map(({ label, parameters }) => ({
      label,
      request: { url: graphqlGet(parameters), method: 'GET' },
      operationKind: 'invalid',
      expected: 'network-write',
    })),
    {
      label: 'exact GetServiceInfo read',
      request: {
        url: 'https://fullnode.mainnet.sui.io:443/sui.rpc.v2.LedgerService/GetServiceInfo',
        method: 'POST', body: grpcServiceInfoReadBody,
      },
      expected: 'external-network-read',
    },
    {
      label: 'exact ListOwnedObjects read',
      request: {
        url: 'https://fullnode.mainnet.sui.io:443/sui.rpc.v2.StateService/ListOwnedObjects',
        method: 'POST', body: grpcListOwnedReadBody,
      },
      expected: 'external-network-read',
    },
    {
      label: 'unknown gRPC method',
      request: {
        url: 'https://fullnode.mainnet.sui.io:443/sui.rpc.v2.StateService/GetObject',
        method: 'POST', body: grpcServiceInfoReadBody,
      },
      expected: 'network-write',
    },
    {
      label: 'opaque exact gRPC body',
      request: {
        url: 'https://fullnode.mainnet.sui.io:443/sui.rpc.v2.StateService/ListOwnedObjects',
        method: 'POST', body: new Uint8Array([0, 255, 1]),
      },
      expected: 'network-write',
    },
    {
      label: 'JSON is not a gRPC-web frame',
      request: {
        url: 'https://fullnode.mainnet.sui.io:443/sui.rpc.v2.LedgerService/GetServiceInfo',
        method: 'POST', body: '{}',
      },
      expected: 'network-write',
    },
    {
      label: 'wrong protobuf payload on exact gRPC read path',
      request: {
        url: 'https://fullnode.mainnet.sui.io:443/sui.rpc.v2.StateService/ListOwnedObjects',
        method: 'POST', body: grpcServiceInfoReadBody,
      },
      expected: 'network-write',
    },
    {
      label: 'unknown method on exact gRPC path',
      request: {
        url: 'https://fullnode.mainnet.sui.io:443/sui.rpc.v2.StateService/ListOwnedObjects',
        method: 'PUT', body: grpcListOwnedReadBody,
      },
      expected: 'network-write',
    },
    {
      label: 'JSON-RPC on an exact read path',
      request: {
        url: 'https://fullnode.mainnet.sui.io:443/sui.rpc.v2.LedgerService/GetServiceInfo',
        method: 'POST', body: '{"jsonrpc":"2.0"}',
      },
      expected: 'jsonrpc',
    },
  ];
  for (const { label, request, operationKind, expected } of cases) {
    if (operationKind !== undefined) {
      assert.equal(
        graphqlRequestOperationKind(request),
        operationKind,
        `${label} direct GraphQL classification drifted.`,
      );
      assert.equal(
        serializedClassifier.graphqlRequestOperationKind(request),
        operationKind,
        `${label} serialized GraphQL classification drifted.`,
      );
    }
    assert.equal(forbiddenNetworkRequest(request, []), expected, `${label} CDP classification drifted.`);
    assert.equal(
      serializedClassifier.forbiddenNetworkRequest(request, []),
      expected,
      `${label} preload classification drifted.`,
    );
  }
});

test('current browser manifest preserves functional coverage without historical pixel authority', () => {
  assert.equal(manifest.schemaVersion, 'animacraft.approved-product-browser-manifest.v2');
  assert.equal(manifest.authority.kind, 'current-product-behavior');
  assert.equal(manifest.authority.roadmap, 'docs/codex/PRODUCT_DELIVERY_MILESTONES.md');
  assert.equal(manifest.authority.candidateEntry, 'index.html');
  assert.equal(Object.hasOwn(manifest, 'baseline'), false);
  assert.deepEqual(manifest.reservedFullMatrix.locales, ['en', 'zh', 'ja', 'ko', 'vi']);
  assert.deepEqual(manifest.reservedFullMatrix.themes, ['animacraft', 'soulidity']);
  assert.deepEqual(manifest.reservedFullMatrix.viewports, ['desktop', 'mobile']);
  assert.deepEqual(manifest.initialMatrix.locales, ['en']);
  assert.deepEqual(manifest.initialMatrix.themes, ['animacraft']);
  assert.deepEqual(manifest.initialMatrix.viewports, ['desktop', 'mobile']);
  assert.equal(manifest.capture.repetitions, 3);
  assert.equal(manifest.capture.pixelComparison, 'decoded-rgba-exact');
  const stateIds = new Set(manifest.states.map(({ id }) => id));
  const captureIdentitySelectors = new Set(manifest.states.map(({ captureIdentitySelector }) => (
    captureIdentitySelector
  )));
  for (const tab of expectedCreatorTabs) assert.ok(stateIds.has(`creator:${tab}`));
  for (const id of [
    'header', 'theme-menu', 'mypage', 'creator:version-history',
    'creator:manage-status', 'player:intro', 'player:workspace', 'creator:pack-studio',
  ]) assert.ok(stateIds.has(id), `Initial browser matrix is missing ${id}.`);
  assert.equal(stateIds.size, manifest.states.length, 'Browser states must be unique.');
  assert.equal(
    captureIdentitySelectors.size,
    manifest.states.length,
    'Every browser state must use one distinct production-state capture identity.',
  );
  assert.equal(
    captureIdentitySelectors.has(undefined) || captureIdentitySelectors.has(''),
    false,
    'Every browser state must declare a production-state capture identity.',
  );
  assert.equal(manifest.states.length, 18, 'The approved state ledger must contain exactly 18 states.');
  const initialCartesianProduct = manifest.states.length
    * manifest.initialMatrix.locales.length
    * manifest.initialMatrix.themes.length
    * manifest.initialMatrix.viewports.length;
  assert.ok(initialCartesianProduct > 0, 'The real-browser matrix may never be empty.');
  assert.equal(initialCartesianProduct, 36, 'The initial approved browser matrix must execute 36 states.');
  assert.equal(manifest.initialMatrix.expectedComparisons, initialCartesianProduct);
});

test('pointer helper reacquires only one explicitly detached pre-scroll target', async (context) => {
  const diagnosticStart = prePointerReacquisitions.length;
  context.after(() => { prePointerReacquisitions.length = diagnosticStart; });
  const run = async ({ failures = 1, message = '-32000: Node is detached from document',
    fresh = true, disabled = false, covered = false, pointerFailure = false } = {}) => {
    const calls = [];
    let handles = 0;
    let scrolls = 0;
    const cdp = { send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate') return { result: params.returnByValue
        ? { value: fresh } : { objectId: `target-${++handles}` } };
      if (method === 'DOM.scrollIntoViewIfNeeded' && scrolls++ < failures) throw new Error(message);
      if (method === 'Runtime.callFunctionOn') return { result: { value: {
        connected: true, layoutStable: true, width: 10, height: 10, x: 5, y: 5,
        disabled, hitIsTarget: !covered, text: 'target', hit: { tag: 'button' },
      } } };
      if (method === 'Input.dispatchMouseEvent' && pointerFailure) throw new Error(message);
      return {};
    } };
    let error;
    try { await clickActualExpression(cdp, 'document.querySelector("button")', 'regression target'); }
    catch (caught) { error = caught; }
    return { calls, handles, error };
  };
  const recovered = await run();
  assert.equal(recovered.error, undefined);
  assert.equal(recovered.handles, 2);
  assert.equal(recovered.calls.filter(row => row.method === 'Runtime.releaseObject').length, 2);
  assert.deepEqual(recovered.calls.filter(row => row.method === 'Input.dispatchMouseEvent')
    .map(row => row.params.type), ['mouseMoved', 'mousePressed', 'mouseReleased']);
  for (const options of [
    { failures: 2 }, { message: '-32000: unrelated protocol error' }, { fresh: false },
    { disabled: true }, { covered: true },
  ]) {
    const result = await run(options);
    assert.ok(result.error, JSON.stringify(options));
    assert.equal(result.calls.filter(row => row.method === 'Input.dispatchMouseEvent').length, 0);
    assert.ok(result.handles <= 2);
  }
  const afterPointer = await run({ failures: 0, pointerFailure: true });
  assert.match(afterPointer.error.message, /Node is detached/);
  assert.equal(afterPointer.handles, 1, 'Never re-resolve or replay after pointer input starts.');
  assert.equal(afterPointer.calls.filter(row => row.method === 'Input.dispatchMouseEvent').length, 1);
});

test('real Chromium dismisses Creator overlays across all ten tabs on desktop and mobile', {
  timeout: 180_000,
}, async (context) => {
  const chromium = await installedChromium();
  assert.ok(chromium, 'Chromium is required for Creator interaction acceptance.');
  const runRoot = await mkdtemp(join(tmpdir(), 'animacraft-creator-overlay-'));
  let server;
  let chromiumProcess;
  let browser;
  let firewall;
  try {
    server = await startFixtureServer(repositoryRoot, join(runRoot, 'vite-cache'));
    const args = [
      '--headless=new', '--disable-background-networking', '--disable-component-update',
      '--disable-default-apps', '--disable-extensions', '--disable-gpu',
      '--no-default-browser-check', '--no-first-run', '--no-proxy-server',
      '--remote-debugging-port=0', `--user-data-dir=${join(runRoot, 'profile')}`, 'about:blank',
    ];
    if (typeof process.getuid === 'function' && process.getuid() === 0) args.unshift('--no-sandbox');
    chromiumProcess = launchChromium(chromium, args, { cleanupPaths: [runRoot] });
    browser = await connectCdp(await chromiumProcess.devtoolsUrl);
    firewall = await installRecursiveBrowserFirewall(browser, {
      preloadSource: deterministicPreload(manifest.fixedSeed),
      allowedOrigins: [server.origin],
    });
    const product = await createProtectedProductPage(
      browser, firewall, `${server.origin}/index.html`,
      manifest.viewports[manifest.initialMatrix.viewports[0]], 'candidate',
    );
    const { cdp } = product;
    const readTripwire = () => evaluate(cdp, `({
      attempts: [...(globalThis.__ANIMACRAFT_NETWORK_TRIPWIRE__?.attempts || [])],
      errors: [...(globalThis.__ANIMACRAFT_NETWORK_TRIPWIRE__?.errors || [])],
      authority: globalThis.__ANIMACRAFT_ACCEPTANCE_AUTHORITY__,
    })`);
    await connectActualWallet(cdp, 'candidate');
    await openActualAccountPage(cdp, 'creator');
    await clickActual(cdp, '[data-new-maker-panel]');
    await typeActualText(cdp, '#newMakerName', manifest.fixedSeed.makerName);
    await clickActual(cdp, '#registerMaker');
    await waitForExpression(cdp, `Boolean(${visibleElementExpression('#makerV4CreatorMount .v4-studio-shell')})`, {
      timeoutMs: 30_000, label: 'local draft created through production entry',
    });
    // Empty/new Styles may legitimately be pending while canonical preview is ready.
    // Match only the renderer's complete success grammar, never Loading/error text.
    const previewReadyExpression = String.raw`/^Preview ready\.(?: [1-9]\d* Style\(s\) waiting for PNG\.)?(?: [1-9]\d* Style\(s\) waiting for Layer Track\.)?$/.test(document.querySelector('#v4CreatorRenderStatus')?.textContent || '')`;
    await waitForExpression(cdp, previewReadyExpression, {
      timeoutMs: 15_000, label: 'initial local render settles before pointer navigation',
    }).catch(async (error) => {
      const state = await evaluate(cdp, `({ status: document.querySelector('#v4CreatorRenderStatus')?.textContent,
        canvas: Boolean(document.querySelector('#makerV4CreatorCanvas')) })`);
      throw new Error(`${error.message} Render state: ${JSON.stringify(state)}`, { cause: error });
    });
    const previewReady = async () => {
      await waitForExpression(cdp, previewReadyExpression, {
        timeoutMs: 15_000, label: 'canonical local preview without chain services',
      });
    };
    const readLocalDraft = () => evaluate(cdp, `(async () => {
      const { createMakerV8DraftPersistence } = await import('/maker-v8-draft-store.js');
      const store = createMakerV8DraftPersistence(indexedDB);
      try {
        const rows = await store.list();
        if (rows.length !== 1) throw new Error('Expected exactly one durable local draft.');
        const row = rows[0];
        const assets = await store.listAssets(row.draftId);
        return { draftId: row.draftId, revision: row.revision, name: row.document.metadata.name,
          assets: assets.map(({ assetId, sha256, revision }) => ({ assetId, sha256, revision })) };
      } finally { store.close(); }
    })()`);
    await previewReady();
    // New Makers contain empty Styles, not bundled art. Upload through the real
    // control so cold-reload asset preservation still tests an actual asset.
    const overlayPngPath = join(runRoot, 'overlay-style.png');
    await writeFile(overlayPngPath, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=', 'base64'));
    assert.equal(await actualFileInput(cdp, '#makerV4CreatorMount input[data-action="style-asset"]', overlayPngPath), true);
    await waitForExpression(cdp, `document.querySelector('[data-save-phase="saved"]') !== null
      && document.querySelector('#makerV4CreatorMount [data-action="confirm-position"]')?.disabled === false`, {
      label: 'uploaded Style PNG is durably saved',
    }).catch(async (error) => {
      const state = await evaluate(cdp, `({ status: document.querySelector('#v4CreatorRenderStatus')?.textContent,
        body: document.querySelector('#makerV4CreatorMount')?.innerText,
        saved: Boolean(document.querySelector('[data-save-phase="saved"]')) })`);
      throw new Error(`${error.message} Upload state: ${JSON.stringify(state)}`, { cause: error });
    });
    await clickActual(cdp, '#makerV4CreatorMount [data-action="confirm-position"]');
    await previewReady();
    const originalDraft = await readLocalDraft();
    assert.equal(originalDraft.assets.length, 1);
    await clickActual(cdp, '#makerV4CreatorMount [data-action="creator-tab"][data-tab="info"]');
    const offlineName = 'Local draft survives unavailable chain';
    await typeActualText(cdp, '#makerV4CreatorMount [data-action="maker-name"]', offlineName);
    assert.equal(await evaluate(cdp, `document.querySelector('#makerV4CreatorMount [data-action="maker-name"]')?.value`),
      offlineName, 'Actual text input must replace the prior Maker name.');
    await pressActualKey(cdp, 'Tab');
    await waitForExpression(cdp, `document.querySelector('#makerV4ToolTitle')?.textContent === ${JSON.stringify(offlineName)}
      && document.querySelector('[data-save-phase="saved"]') !== null`, {
      label: 'durable local edit commits while chain reads are unavailable',
    });
    await pressActualKey(cdp, 'Escape');
    await previewReady();
    const editedDraft = await readLocalDraft();
    assert.equal(editedDraft.draftId, originalDraft.draftId);
    assert.equal(editedDraft.revision, originalDraft.revision + 1);
    assert.equal(editedDraft.name, offlineName);
    assert.deepEqual(editedDraft.assets, originalDraft.assets);
    assert.equal(await evaluate(cdp, `Boolean(document.querySelector('#chainStatusGrid .error'))`), true,
      'Unavailable remote services must remain visible while local editing works.');

    // Reload discards page globals: retain the first document's safety evidence.
    const beforeReloadTripwire = await readTripwire();
    const previousTimeOrigin = await evaluate(cdp, 'performance.timeOrigin');
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitForExpression(cdp, `document.readyState === 'complete'
      && performance.timeOrigin !== ${JSON.stringify(previousTimeOrigin)}
      && Boolean(globalThis.__ANIMACRAFT_ACCEPTANCE_INSPECTOR__)
      && Boolean(document.querySelector('#suiWalletModal'))
      && document.querySelector('#templateGrid')?.childElementCount > 0`, { label: 'cold product reload' });
    await waitForExpression(cdp, `document.querySelector('#walletButton')?.classList.contains('connected') === true`, {
      label: 'Wallet Standard restores the existing connection after reload',
    });
    await openActualAccountPage(cdp, 'creator');
    await waitForExpression(cdp, `document.querySelector('#imageMakerList')?.textContent.includes(${JSON.stringify(offlineName)})`, {
      label: 'durable local draft recovers before remote discovery succeeds',
    });
    await clickActual(cdp, '#imageMakerList [data-edit-maker]');
    await previewReady();
    assert.deepEqual(await readLocalDraft(), editedDraft);
    assert.equal(await evaluate(cdp, `document.querySelector('#makerV4CreatorMount [data-action="open-player"]').disabled`), false,
      'Local Player remains available with saved PNG art even when chain discovery is unavailable.');
    context.diagnostic('Unavailable-chain local draft: canonical preview, real edit, exact CAS/asset preservation and cold reload passed.');
    for (const viewportName of manifest.initialMatrix.viewports) {
      await setViewport(cdp, manifest.viewports[viewportName]);
      for (const tab of expectedCreatorTabs) {
        await clickActual(cdp, `#makerV4CreatorMount [data-action="creator-tab"][data-tab="${tab}"]`);
        assert.equal(await evaluate(cdp,
          `document.querySelector('[data-action="creator-tab"].active')?.dataset.tab`),
        tab, `${viewportName}/${tab} must receive the actual pointer input`);
        if (tab === 'structure') continue;
        await waitForExpression(cdp, `document.activeElement?.dataset.action === 'close-tool'`, {
          label: `${viewportName}/${tab} approved opening focus`,
        });
        await pressActualKey(cdp, 'Escape');
        assert.equal(await evaluate(cdp, `document.querySelector('.v4-tool-modal-backdrop') === null`), true);
        assert.equal(await evaluate(cdp, `document.activeElement?.dataset.tab`), 'structure');
      }
      await clickActual(cdp, '#makerV4CreatorMount [data-action="open-version-history"]');
      await waitForExpression(cdp, `Boolean(document.querySelector('.v4-version-history-dialog'))`, {
        label: `${viewportName} version history`,
      });
      await pressActualKey(cdp, 'Escape');
      assert.equal(await evaluate(cdp, `document.querySelector('.v4-version-history-dialog') === null`), true);
      assert.equal(await evaluate(cdp, `document.activeElement?.dataset.action`), 'open-version-history');
      await clickActual(cdp, '#accountButton');
      assert.equal(await evaluate(cdp, `document.querySelector('#accountPanel').classList.contains('active')`), true);
      await pressActualKey(cdp, 'Escape');
      assert.equal(await evaluate(cdp, `document.querySelector('#accountPanel').classList.contains('active')`), false);
      assert.equal(await evaluate(cdp, `document.querySelector('#makerV4CreatorMount [data-action="open-player"]').disabled`), false);
      context.diagnostic(`${viewportName}: all ten tabs, history, account and focus passed; saved-art local Player remains available without chain authority.`);
    }
    context.diagnostic(`Pre-pointer detached-node reacquisitions: ${JSON.stringify(prePointerReacquisitions)}`);
    for (const tripwire of [beforeReloadTripwire, await readTripwire()]) {
      assert.equal(tripwire.authority.allowWalletSignature, false);
      assert.equal(tripwire.authority.allowBroadcast, false);
      assert.deepEqual(tripwire.errors, []);
      assert.ok(tripwire.attempts.some(({ kind }) => kind === 'external-network-read'),
        'Both documents must actually encounter unavailable remote services.');
      assert.deepEqual(tripwire.attempts.filter(({ url, kind, method }) => (
        !isPreloadProbeUrl(url) && kind !== 'external-network-read'
        && !(kind === 'external-network' && isSafeNetworkMethod(method))
      )), []);
    }
    await firewall.waitForIdle();
    assert.deepEqual(firewall.errors, []);
    assert.deepEqual(server.requestLog, []);
    assert.deepEqual(firewall.records.flatMap((record) => record.requests.filter((request) => (
      suspiciousCdpRequest(request) && !isCdpProbeUrl(request.url)
    ))), []);
  } finally {
    try { await firewall?.close(); } catch {}
    try { browser?.close(); } catch {}
    chromiumProcess?.stop();
    if (chromiumProcess) await chromiumProcess.closed;
    await server?.server.close();
    await rm(runRoot, { recursive: true, force: true });
    chromiumProcess?.disposeProcessCleanup();
    assert.equal(await pathExists(runRoot), false, 'Creator browser temporary resources survived cleanup.');
  }
});

test('real Chromium validates current product states and handoff without write authority', {
  timeout: 600_000,
}, async (context) => {
  const diagnosticCase = process.env.ANIMACRAFT_BROWSER_DIAGNOSTIC_CASE;
  const decodeDelay = process.env.ANIMACRAFT_BROWSER_DIAGNOSTIC_PLAYER_DECODE_DELAY_MS;
  if (decodeDelay !== undefined) {
    assert.ok(diagnosticCase?.endsWith('/player:intro'), 'Decode delay is only a Player intro diagnostic challenge.');
    assert.match(decodeDelay, /^(?:[1-9][0-9]{0,2}|1000)$/, 'Decode delay must be 1–1000 milliseconds.');
  }
  const validCases = manifest.initialMatrix.viewports.flatMap(viewport =>
    manifest.initialMatrix.locales.flatMap(locale => manifest.initialMatrix.themes.flatMap(theme =>
      manifest.states.map(state => `${viewport}/${locale}/${theme}/${state.id}`))));
  if (diagnosticCase !== undefined) {
    assert.equal(Object.hasOwn(process.env, 'CI'), false, 'Partial diagnostic runs cannot satisfy CI.');
    assert.ok(validCases.includes(diagnosticCase), 'Diagnostic case must name one exact manifest cell.');
    context.diagnostic(`DIAGNOSTIC ONLY: ${diagnosticCase}; this run cannot pass the release matrix.`);
  }
  const expectedComparisons = diagnosticCase ? 1 : manifest.initialMatrix.expectedComparisons;
  const chromium = await installedChromium();
  if (!chromium) {
    if (process.env.ANIMACRAFT_ALLOW_MISSING_CHROMIUM === '1'
      && !Object.hasOwn(process.env, 'CI')) {
      context.skip('Explicit local-only ANIMACRAFT_ALLOW_MISSING_CHROMIUM=1 override.');
      return;
    }
    assert.fail(
      'Chromium is required for browser acceptance. CI and default local runs fail when it is absent; '
      + 'only an explicit non-CI ANIMACRAFT_ALLOW_MISSING_CHROMIUM=1 may skip.',
    );
  }

  const startupCleanupEvidence = await cleanupStaleAcceptanceResources();
  assert.deepEqual(
    startupCleanupEvidence.skippedUnsafeRoots,
    [],
    'A stale acceptance resource is still owned by an unverified process.',
  );
  context.diagnostic(`Startup detached-resource cleanup: ${JSON.stringify(startupCleanupEvidence)}`);

  const sourceEvidence = await browserSourceEvidence();
  const runRoot = await mkdtemp(join(tmpdir(), 'animacraft-approved-browser-run-'));
  const profileRoot = join(runRoot, 'chromium-profile');
  const cacheRoot = join(runRoot, 'vite-cache');
  const keepArtifacts = Boolean(diagnosticCase) || process.env.ANIMACRAFT_KEEP_BROWSER_ARTIFACTS === '1';
  const artifactRoot = keepArtifacts
    ? await mkdtemp(join(tmpdir(), 'animacraft-approved-browser-artifacts-'))
    : join(runRoot, 'artifacts');
  await mkdir(artifactRoot, { recursive: true });
  let candidateServer;
  let chromiumProcess;
  let browser;
  let targetFirewall;
  let candidateProduct;
  let profileCreated = false;
  const matrix = [];
  const captureIdentities = new Set();
  try {
    assert.equal(await pathExists(profileRoot), false, 'Detached Chromium profile was not clean before launch.');
    candidateServer = await startFixtureServer(repositoryRoot, join(cacheRoot, 'candidate'));

    const args = [
      '--headless=new',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-features=Translate,OptimizationHints,MediaRouter,OverlayScrollbar',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      '--lang=en-US',
      '--no-default-browser-check',
      '--no-first-run',
      '--no-proxy-server',
      '--remote-debugging-port=0',
      '--site-per-process',
      `--user-data-dir=${profileRoot}`,
      'about:blank',
    ];
    if (typeof process.getuid === 'function' && process.getuid() === 0) args.unshift('--no-sandbox');
    chromiumProcess = launchChromium(chromium, args, {
      cleanupPaths: [runRoot],
    });
    const devtoolsUrl = await chromiumProcess.devtoolsUrl;
    profileCreated = (await stat(profileRoot)).isDirectory();
    assert.equal(profileCreated, true, 'Chromium did not create its isolated detached profile.');
    browser = await connectCdp(devtoolsUrl);
    const alternateOrigin = (origin) => origin.replace('127.0.0.1', 'localhost');
    const preloadSource = deterministicPreload(manifest.fixedSeed);
    targetFirewall = await installRecursiveBrowserFirewall(browser, {
      preloadSource,
      allowedOrigins: [
        candidateServer.origin,
        alternateOrigin(candidateServer.origin),
      ],
    });
    const initialViewport = manifest.viewports[manifest.initialMatrix.viewports[0]];
    const candidateUrl = `${candidateServer.origin}/index.html`;
    candidateProduct = await createProtectedProductPage(
      browser, targetFirewall, candidateUrl, initialViewport, 'candidate',
    );
    context.diagnostic(`Production entry evidence: ${JSON.stringify({
      candidate: candidateProduct.evidence,
    })}`);

    const seedPngPath = join(runRoot, 'approved-browser-style.png');
    await writeFile(seedPngPath, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=',
      'base64',
    ));
    const makerSetup = {
      candidate: await createActualMakerDraft(
        candidateProduct.cdp, 'candidate', manifest.fixedSeed, seedPngPath,
      ),
    };
    context.diagnostic(`Actual product Maker setup: ${JSON.stringify(makerSetup)}`);

    const attackEvidence = {
      candidate: {
        page: await runPageWriteAttackMatrix(
          candidateProduct.cdp, targetFirewall, candidateServer, 'candidate',
        ),
        targets: await runChildTargetAttackMatrix(
          candidateProduct.cdp,
          targetFirewall,
          candidateServer,
          alternateOrigin(candidateServer.origin),
          'candidate',
        ),
      },
    };
    context.diagnostic(`Network attack evidence: ${JSON.stringify(attackEvidence)}`);

    for (const viewportName of manifest.initialMatrix.viewports) {
      const viewport = manifest.viewports[viewportName];
      await ensureActualCreatorEditor(candidateProduct.cdp);
      await closeActualOverlays(candidateProduct.cdp);
      await clickActual(candidateProduct.cdp, '.main-nav [data-page="templates"]');
      await setViewport(candidateProduct.cdp, viewport);
      // Mobile overlay-scrollbar fading is browser chrome, not document state.
      // Normalize it before interaction/capture; keep real scroll geometry and
      // exact viewport/DOM/RGBA assertions instead of masking screenshot pixels.
      await candidateProduct.cdp.send('Emulation.setScrollbarsHidden', { hidden: viewport.mobile === true });
      for (const locale of manifest.initialMatrix.locales) {
        for (const theme of manifest.initialMatrix.themes) {
          for (const state of manifest.states) {
            const key = `${viewportName}/${locale}/${theme}/${state.id}`;
            if (diagnosticCase && key !== diagnosticCase) continue;
            const captureIdentity = `${viewportName}/${locale}/${theme}/${state.captureIdentitySelector}`;
            assert.equal(
              captureIdentities.has(captureIdentity),
              false,
              `Approved state reuses an existing capture identity: ${captureIdentity}`,
            );
            captureIdentities.add(captureIdentity);
            let capture;
            try {
              capture = await showStableProductState(
                candidateProduct.cdp, state, locale, theme, viewport, 'current',
              );
              const handoff = state.id === 'mypage'
                ? await assertAccountHandoff(candidateProduct.cdp, true, locale) : null;
              const summary = {
                key, captureIdentity, pass: true,
                evidenceKind: 'CURRENT_FUNCTIONAL_STATE_AND_REPEAT_STABILITY',
                formState: capture.formState, handoff,
                domSha256: sha256(canonicalJson(capture.snapshot)),
                pngSha256: sha256(capture.screenshot),
                rgbaSha256: sha256(capture.decoded.rgba),
                repeatRgbaSha256: capture.repeatRgbaSha256,
                repeatStateSha256: capture.repeatStateSha256,
              };
              if (keepArtifacts) summary.artifactDirectory = await writeStateArtifacts(
                artifactRoot, key, capture, summary,
              );
              matrix.push(summary);
            } catch (error) {
              const summary = { key, captureIdentity, pass: false, error: String(error?.stack || error) };
              summary.artifactDirectory = await writeStateArtifacts(artifactRoot, key, capture || error.capture, summary);
              if (error.repeatCapture) await writeStateArtifacts(artifactRoot, `${key}-repeat`, error.repeatCapture, summary);
              matrix.push(summary);
            }
          }
        }
      }
    }

    // Exercise the actual wallet disconnect, then inspect the surviving public
    // links and account-only fail-closed links on the current production page.
    await closeActualOverlays(candidateProduct.cdp);
    if (decodeDelay) context.diagnostic(`Player decode timing evidence: ${JSON.stringify(await evaluate(
      candidateProduct.cdp, 'globalThis.__ANIMACRAFT_PLAYER_DECODE_DIAGNOSTIC__',
    ))}`);
    await clickActual(candidateProduct.cdp, '#walletButton');
    await waitForExpression(candidateProduct.cdp,
      `!document.querySelector('#walletButton')?.classList.contains('connected')`,
      { label: 'actual wallet disconnect before handoff boundary check' });
    const disconnectedHandoff = await assertAccountHandoff(
      candidateProduct.cdp, false, manifest.initialMatrix.locales.at(-1),
    );
    const pageTripwires = await Promise.all([
      candidateProduct.cdp,
    ].map((page) => evaluate(page, `({
      attempts: [...(globalThis.__ANIMACRAFT_NETWORK_TRIPWIRE__?.attempts || [])],
      errors: [...(globalThis.__ANIMACRAFT_NETWORK_TRIPWIRE__?.errors || [])],
      authority: globalThis.__ANIMACRAFT_ACCEPTANCE_AUTHORITY__,
    })`)));
    const taggedTripwireAttempts = pageTripwires.flatMap(({ attempts }, index) => (
      attempts.map((attempt) => ({ page: index, ...attempt }))
    ));
    const semanticReadAttempts = taggedTripwireAttempts.filter(({ url, kind }) => (
      !isPreloadProbeUrl(url) && kind === 'external-network-read'
    ));
    // The explicit attack matrix above asserts all three semantic read probes.
    // Natural application requests are not those probes: denied service-info
    // correctly prevents downstream owned-object requests on this offline page.
    assert.deepEqual(semanticReadAttempts.map(({ method, url, bodyType }) => ({
      method, pathname: new URL(url).pathname, bodyType,
    })), [{ method: 'POST', pathname: '/sui.rpc.v2.LedgerService/GetServiceInfo', bodyType: 'string' }],
    'The offline no-retry journey must stop after the single denied Mainnet identity read.');
    semanticReadAttempts.forEach((attempt) => {
      assert.equal(attempt.method, 'POST');
      assert.ok(
        [
          '/graphql',
          '/sui.rpc.v2.LedgerService/GetServiceInfo',
          '/sui.rpc.v2.StateService/ListOwnedObjects',
        ].includes(new URL(attempt.url).pathname),
        `A purported semantic read used an unapproved endpoint: ${JSON.stringify(attempt)}`,
      );
    });
    const unexpectedTripwireAttempts = taggedTripwireAttempts.filter(({ url, kind, method }) => (
      !isPreloadProbeUrl(url)
      && kind !== 'external-network-read'
      && !(kind === 'external-network' && isSafeNetworkMethod(method))
    ));
    const unexpectedCdpBlocks = [
      ...targetFirewall.rootBlocked,
      ...targetFirewall.records.flatMap(({ blocked }) => blocked),
    ].filter(({ url, kind, method }) => (
      !isCdpProbeUrl(url)
      && kind !== 'external-network-read'
      && !(kind === 'external-network' && isSafeNetworkMethod(method))
    ));
    const unexpectedNetworkObservations = targetFirewall.records.flatMap((record) => (
      record.requests.flatMap((request) => {
        const kind = suspiciousCdpRequest(request);
        return kind ? [{ targetType: record.type, kind, request }] : [];
      })
    )).filter(({ request }) => !isCdpProbeUrl(request?.url));
    const networkSafety = {
      semanticReadAttempts,
      unexpectedTripwireAttempts,
      unexpectedCdpBlocks,
      unexpectedNetworkObservations,
      candidateServerRequests: [...candidateServer.requestLog],
    };
    for (const [index, tripwire] of pageTripwires.entries()) {
      assert.equal(tripwire.authority.allowWalletSignature, false, `Page ${index} signature gate drifted.`);
      assert.equal(tripwire.authority.allowBroadcast, false, `Page ${index} broadcast gate drifted.`);
      assert.deepEqual(tripwire.errors, [], `Page ${index} reported an uncaught browser error.`);
    }
    await targetFirewall.waitForIdle();
    assert.deepEqual(targetFirewall.errors, [], 'Recursive target firewall retained an error.');
    const protectedTargets = targetFirewall.records.filter(({ type }) => (
      ['page', 'iframe', 'worker', 'shared_worker', 'service_worker'].includes(type)
    ));
    assert.ok(protectedTargets.length >= 6, 'The recursive target protection matrix was unexpectedly empty.');
    for (const type of ['page', 'iframe', 'worker', 'shared_worker', 'service_worker']) {
      assert.ok(protectedTargets.some(record => record.type === type), `Missing protected ${type} attack target.`);
    }
    protectedTargets.forEach((record) => {
      assert.equal(record.preloadInstalled, true, `${record.type} target missed its preload.`);
      assert.equal(
        record.fetchInstalled || record.networkBlockInstalled,
        true,
        `${record.type} target missed its target-local CDP firewall.`,
      );
      assert.equal(record.observerInstalled, true, `${record.type} target missed its observer.`);
      assert.equal(record.resumed, true, `${record.type} target did not resume after protection.`);
      assert.equal(
        record.recursiveAutoAttachInstalled,
        true,
        `${record.type} target missed recursive child auto-attach.`,
      );
    });

    const lines = matrix.map(entry =>
      `${entry.pass ? 'PASS' : 'FAIL'} ${entry.key}`
      + (entry.error ? ` :: ${entry.error.split('\n')[0]}` : ''));
    assert.equal(matrix.length, expectedComparisons);
    assert.equal(
      captureIdentities.size,
      expectedComparisons,
      'The 36-cell matrix must retain 36 distinct production-state capture identities.',
    );
    assert.equal(
      new Set(matrix.map(({ captureIdentity }) => captureIdentity)).size,
      expectedComparisons,
      'A matrix entry reused another state capture identity.',
    );
    context.diagnostic(`Current product browser matrix (${matrix.filter((entry) => entry.pass).length}/${matrix.length}):\n${lines.join('\n')}`);
    const failures = matrix.filter((entry) => !entry.pass);
    const networkSafetyFailureCount = unexpectedTripwireAttempts.length
      + unexpectedCdpBlocks.length
      + unexpectedNetworkObservations.length
      + candidateServer.requestLog.length;
    assert.deepEqual(await browserSourceEvidence(), sourceEvidence, 'Browser source changed during acceptance.');
    await writeFile(join(artifactRoot, 'matrix.json'), `${JSON.stringify({
      schemaVersion: 'animacraft.current-product-browser-result.v2',
      diagnosticOnly: Boolean(diagnosticCase), sourceEvidence, networkSafety,
      attackEvidence, disconnectedHandoff, prePointerReacquisitions, matrix,
    }, null, 2)}\n`);
    context.diagnostic(`Current source evidence and state artifacts: ${artifactRoot}; retained=${keepArtifacts}.`);
    if (failures.length || networkSafetyFailureCount || diagnosticCase) {
      assert.fail(
        `${diagnosticCase ? 'DIAGNOSTIC ONLY (not release acceptance). ' : ''}${failures.length}/${matrix.length} current browser states failed. `
        + `${networkSafetyFailureCount} unexpected unsafe network observation(s). `
        + (keepArtifacts
          ? `Exact retained artifacts: ${artifactRoot}`
          : 'Temporary artifacts were cleaned; set ANIMACRAFT_KEEP_BROWSER_ARTIFACTS=1 to retain them.'),
      );
    }
  } catch (error) {
    throw error;
  } finally {
    try { await targetFirewall?.close(); } catch {}
    try {
      if (candidateProduct?.record?.targetId) {
        await browser?.send('Target.closeTarget', { targetId: candidateProduct.record.targetId });
      }
    } catch {}
    try { browser?.close(); } catch {}
    chromiumProcess?.stop();
    if (chromiumProcess) await chromiumProcess.closed;
    await Promise.allSettled([
      candidateServer?.server.close(),
    ]);
    await rm(runRoot, { recursive: true, force: true });
    assert.equal(await pathExists(runRoot), false, 'Detached profile/run root survived normal cleanup.');
    chromiumProcess?.disposeProcessCleanup();
    context.diagnostic(`Detached profile cleanup: before=false, created=${profileCreated}, after=false.`);
  }
});
