#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

execFileSync('sui', [
  'move', 'build', '--force', '--warnings-are-errors', '--path',
  path.join(root, 'probes', 'companion_compile'),
], { stdio: 'inherit' });

for (const [name, expected] of [
  ['adversarial_abilities', 'does not have the ability'],
  ['adversarial_asset_store', 'does not have the ability'],
  ['adversarial_witness_abilities', 'does not have the ability'],
  ['adversarial_api', 'restricted visibility'],
  ['adversarial_registry_api', 'restricted visibility'],
  ['adversarial_asset_api', 'restricted visibility'],
  ['adversarial_cap_extraction', 'restricted visibility'],
  ['adversarial_receipt_proof', 'Unbound function'],
  ['adversarial_market_ticket_copy', "does not have the ability 'copy'"],
  ['adversarial_market_ticket_drop', "does not have the ability 'drop'"],
  ['adversarial_market_ticket_store', "does not have the ability 'store'"],
  ['adversarial_market_ticket_forge', 'restricted visibility'],
  ['adversarial_market_external_receive', 'invalid private transfer call'],
  ['adversarial_market_replay', 'previously moved'],
  ['adversarial_market_source_substitution', 'incompatible types'],
]) {
  try {
    execFileSync('sui', [
      'move', 'build', '--force', '--warnings-are-errors', '--path',
      path.join(root, 'probes', name),
    ], { encoding: 'utf8', stdio: 'pipe' });
    throw new Error(`${name} unexpectedly compiled`);
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`;
    if (error.message === `${name} unexpectedly compiled`) throw error;
    if (!output.includes(expected)) {
      process.stderr.write(output);
      throw new Error(`${name} failed for an unexpected reason; missing ${expected}`);
    }
    process.stdout.write(`${name}: expected failure observed\n`);
  }
}
