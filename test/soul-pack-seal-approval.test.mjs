import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('shared Soul Pack Seal approval derives native ownership inside the same entry', async () => {
  const source = await readFile(new URL('../move/animacraft_v8_release/sources/release_v8.move', import.meta.url), 'utf8');
  const start = source.indexOf('entry fun seal_approve_equipped_soul_pack_v1');
  assert.ok(start >= 0);
  const entry = source.slice(start, source.indexOf('\n}', start) + 2);
  assert.match(entry, /pass: &runtime::SoulPackPassV1/);
  assert.doesNotMatch(entry, /pass: &PackPassV8/);
  assert.match(entry, /assert_read_seal_binding\(root, catalog, release_config, seal_registry, seal_policy\)/);
  assert.match(entry, /animacraft_pack_adapter_v1::certify_protected_soul_pack_entitlement_v1\(\s*state, loadout/);
  assert.match(entry, /seal_id, protocol, ctx\)/);
  assert.match(entry, /consume_pack_decrypt_proof_v8\(id, seal_registry, seal_policy, root, proof, ctx\)/);
  const abi = JSON.parse(await readFile(new URL('../docs/SOUL_PACK_SEAL_APPROVAL_V1.json', import.meta.url), 'utf8'));
  assert.equal(abi.explicitParameters.length, 23);
  assert.equal(abi.explicitParameters[7].name, 'pass');
  assert.equal(abi.txContextInjected, true);
});
