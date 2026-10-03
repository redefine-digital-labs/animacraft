import assert from 'node:assert/strict';
import test from 'node:test';
import { hasForbiddenSuiTransportSource as forbidden } from '../scripts/sui-transport-source-guard.mjs';

test('only exact transport-neutral ObjectError imports are allowed', () => {
  assert.equal(forbidden("import { ObjectError } from '@mysten/sui/client';\nthrow new ObjectError({ code: 'notFound' });"), false);
  assert.equal(forbidden('import { ObjectError } from "@mysten/sui/client";'), false);
  for (const source of [
    "import { ObjectError, SuiClient } from '@mysten/sui/client';",
    "import * as client from '@mysten/sui/client';",
    "import Client from '@mysten/sui/client';",
    "import { ObjectError as Other } from '@mysten/sui/client';",
    "await import('@mysten/sui/client');",
    "export { ObjectError } from '@mysten/sui/client';",
    "import { ObjectError } from '@mysten/sui/jsonrpc';",
  ]) assert.equal(forbidden(source), true, source);
});

test('allowed error imports never suppress executable legacy calls or other imports', () => {
  const allowed = "import { ObjectError } from '@mysten/sui/client';\n";
  for (const source of [
    "import { SuiClient } from '@mysten/sui/client';",
    'new SuiJsonRpcClient({});', 'getJsonRpcFullnodeUrl("mainnet");',
    'new JsonRpcProvider();', 'rpc.getTransactionBlock({});',
    'rpc.executeTransactionBlock({});', 'rpc["dryRunTransactionBlock"]({});',
  ]) assert.equal(forbidden(allowed + source), true, source);
});
