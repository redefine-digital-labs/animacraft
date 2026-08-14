#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  ceremonyReceipt,
  ceremonyStatus,
  executeCurrentAction,
  initializeCeremony,
  lockCurrentAction,
  recoverSubmittedAction,
  summarizeCeremonyState,
  stableJson,
} from './lib/expansion-pack-v8-pack-ceremony.mjs';
import { createDefaultCeremonyAdapters } from './lib/expansion-pack-v8-pack-ceremony-adapters.mjs';

function fail(message) { throw new Error(message); }
function parseArgs(argv) {
  const command = argv[0];
  if (!['init', 'status', 'lock', 'execute', 'recover', 'receipt'].includes(command)) {
    fail('Usage: expansion-pack-v8-pack-ceremony.mjs <init|status|lock|execute|recover|receipt> [options]');
  }
  const result = { command };
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) fail(`Unsupported argument: ${key}`);
    const name = key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`${key} requires a value.`);
    result[name] = value; index += 1;
  }
  if (!result.state) fail('--state is required and must be outside the Git worktree.');
  return result;
}

export async function main(argv = process.argv.slice(2), adapters = createDefaultCeremonyAdapters()) {
  const args = parseArgs(argv);
  const statePath = resolve(args.state);
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const options = { ...args, repoRoot };
  let output;
  if (args.command === 'init') {
    if (!args.readiness) fail('init requires --readiness.');
    output = summarizeCeremonyState(await initializeCeremony({ repoRoot,
      readinessPath: resolve(args.readiness), statePath, nonce: args.nonce }));
  } else if (args.command === 'status') output = await ceremonyStatus(statePath, options);
  else if (args.command === 'lock') output = await lockCurrentAction(statePath, options, adapters);
  else if (args.command === 'execute') output = await executeCurrentAction(statePath, options, adapters);
  else if (args.command === 'recover') output = await recoverSubmittedAction(statePath, options, adapters);
  else output = await ceremonyReceipt(statePath, options);
  process.stdout.write(`${stableJson(output, 2)}\n`);
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${stableJson({ ok: false, code: error.code || 'PACK_CEREMONY_FAILED',
      error: error.message, details: error.details || {} }, 2)}\n`);
    process.exitCode = 1;
  });
}
