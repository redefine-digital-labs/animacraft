import { RpcError, UnaryCall } from '@protobuf-ts/runtime-rpc';

export const MAKER_V8_RPC_TIMEOUT_MS = 30_000;

// Bound the whole unary response (including its body), not only HTTP headers.
// Abort the actual transport; do not release a UI lock while a detached RPC
// continues in the background. A broadcast timeout never proves failure.
export function makerV8RpcDeadline(timeoutMs = MAKER_V8_RPC_TIMEOUT_MS) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('Invalid RPC deadline');
  return {
    interceptUnary(next, method, input, options) {
      const controller = new AbortController();
      let expired = false;
      const cancel = () => controller.abort(options.abort.reason);
      if (options.abort?.aborted) cancel();
      else options.abort?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => {
        expired = true;
        controller.abort();
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        options.abort?.removeEventListener('abort', cancel);
      };
      try {
        const call = next(method, input, { ...options, abort: controller.signal });
        const timeoutError = () => new RpcError(`Sui RPC timeout while waiting for ${method.name}; recover the saved transaction before signing again.`, 'DEADLINE_EXCEEDED');
        const checked = promise => promise.then(value => {
          if (expired) throw timeoutError();
          return value;
        }, error => { throw expired ? timeoutError() : error; });
        const bounded = new UnaryCall(call.method, call.requestHeaders, call.request,
          checked(call.headers), checked(call.response), checked(call.status), checked(call.trailers));
        void bounded.then(cleanup, cleanup);
        return bounded;
      } catch (error) {
        cleanup();
        throw error;
      }
    },
  };
}
