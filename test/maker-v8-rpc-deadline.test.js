import assert from 'node:assert/strict';
import test from 'node:test';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { UnaryCall } from '@protobuf-ts/runtime-rpc';
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import { makerV8RpcDeadline, MAKER_V8_RPC_TIMEOUT_MS } from '../maker-v8-rpc-deadline.js';
import { createProductionMakerV8SuiGrpcTransport } from '../maker-v8-sui-grpc.js';

for (const phase of ['headers', 'body']) test(`production RPC aborts a stalled ${phase} without retrying`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal, calls = 0, started;
  const entered = new Promise(resolve => { started = resolve; });
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    calls++; signal = options.signal; started();
    if (phase === 'headers') return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    return Promise.resolve(new Response(new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    } }), { headers: { 'content-type': 'application/grpc-web+proto' } }));
  });
  const transport = createProductionMakerV8SuiGrpcTransport();
  const result = transport.getServiceInfo();
  const rejected = assert.rejects(result, error => error.code === 'DEADLINE_EXCEEDED' && /GetServiceInfo/.test(error.message));
  await entered;
  t.mock.timers.tick(MAKER_V8_RPC_TIMEOUT_MS);
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
});

test('caller cancellation stays cancellation, not a deadline or a retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const client = new SuiGrpcClient({ network: 'mainnet', transport: new GrpcWebFetchTransport({ baseUrl: 'https://example.invalid',
    interceptors: [makerV8RpcDeadline()], fetch: (_url, options) => {
      signal = options.signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } }) });
  const caller = new AbortController();
  const call = client.ledgerService.getServiceInfo({}, { abort: caller.signal });
  const rejected = assert.rejects(Promise.resolve(call), error => error.code === 'CANCELLED');
  caller.abort();
  await rejected;
  assert.equal(signal.aborted, true);
});

test('completed RPC removes its timer and does not abort later', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const interceptor = makerV8RpcDeadline();
  const call = interceptor.interceptUnary((_method, input, options) => {
    signal = options.abort;
    return new UnaryCall({}, {}, input, Promise.resolve({}), Promise.resolve({ ok: true }),
      Promise.resolve({ code: 'OK' }), Promise.resolve({}));
  }, { name: 'Read' }, {}, {});
  assert.deepEqual((await call).response, { ok: true });
  t.mock.timers.tick(MAKER_V8_RPC_TIMEOUT_MS * 2);
  assert.equal(signal.aborted, false);
});

test('a response arriving after abort cannot become a successful checkpoint', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let deliver, signal;
  const response = new Promise(resolve => { deliver = resolve; });
  const call = makerV8RpcDeadline().interceptUnary((_method, input, options) => {
    signal = options.abort;
    return new UnaryCall({}, {}, input, Promise.resolve({}), response,
      Promise.resolve({ code: 'OK' }), Promise.resolve({}));
  }, { name: 'GetTransaction' }, {}, {});
  const rejected = assert.rejects(Promise.resolve(call), { code: 'DEADLINE_EXCEEDED' });
  t.mock.timers.tick(MAKER_V8_RPC_TIMEOUT_MS);
  assert.equal(signal.aborted, true);
  deliver({ finalized: true });
  await rejected;
});
