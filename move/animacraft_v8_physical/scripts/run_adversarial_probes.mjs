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
  ['adversarial_receipt_proof', "Unbound function 'proof_complete_receipt_v8'"],
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
    const output = `${error.stdout || ''}\n${error.stderr || ''}`
      .replace(/\u001b\[[0-9;]*m/g, '');
    if (error.message === `${name} unexpectedly compiled`) throw error;
    const diagnostics = [...output.matchAll(/error\[(E(?:C)?\d+)\]/g)]
      .map((match) => match[1].replace(/^EC/, 'E'));
    const intentionalUnbound = name === 'adversarial_receipt_proof';
    const intentionalTypeMismatch = name === 'adversarial_market_source_substitution';
    const unrelatedAbi = /unbound type|unbound field|too few arguments|too many arguments|invalid subtype|missing fields/i.test(output)
      || (!intentionalUnbound && /unbound module member/i.test(output))
      || (!intentionalTypeMismatch && /incompatible types/i.test(output));
    const invalidIntentionalFailure = (intentionalUnbound || intentionalTypeMismatch)
      && (diagnostics.length !== 1
        || diagnostics[0] !== (intentionalUnbound ? 'E03003' : 'E04007')
        || !output.includes(path.join('sources', 'attack.move'))
        || (intentionalTypeMismatch && ![
          'PackTreasuryV8', 'MakerTreasuryV8', "parameter 'maker_treasury'",
        ].every((fragment) => output.includes(fragment))));
    if (unrelatedAbi || invalidIntentionalFailure || output.includes('warning[')) {
      process.stderr.write(output);
      throw new Error(`${name} failed with an unrelated ABI error`);
    }
    if (!output.includes(expected)) {
      process.stderr.write(output);
      throw new Error(`${name} failed for an unexpected reason; missing ${expected}`);
    }
    process.stdout.write(`${name}: expected failure observed\n`);
  }
}
