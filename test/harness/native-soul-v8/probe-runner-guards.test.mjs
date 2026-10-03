import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

for (const [role, mode] of [['core', 'abi'], ['runtime', 'abi'], ['output', 'abi'],
  ['physical', 'abi'], ['release', 'abi'], ['core', 'missing-ability']]) {
  test(`${role} rejects ${mode} instead of passing on matching security words`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'probe-runner-guard-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const binary = join(directory, 'sui');
    // No Move build runs in this regression: the companion is a positive
    // control, followed by an unrelated stale-ABI diagnostic with bait words.
    await writeFile(binary, `#!${process.execPath}\n
if (process.argv.at(-1).endsWith('companion_compile') || process.argv.at(-1).endsWith('native_soul_compile')) process.exit(0);
console.error(${JSON.stringify(mode === 'abi' ? 'error[EC03003]: unbound module member' : Array(31).fill('error[EC05001]: ability constraint not satisfied').join('\n'))});
console.error('restricted visibility does not have the ability copy drop store previously moved');
console.error('MakerRuntimeCompanionBindingBuilderV2 FreshTupleBootstrapUseWitnessV2 RuntimeCallerCapV1 PackageCallCapV8 WrappedRightsCertificationV8 SuccessorAuthorityV8');
console.error('SealRoleV8 RuntimeRoleV8 OutputRoleV8 PhysicalRoleV8 MarketRoleV8 ReleaseRoleV8');
console.error('RuntimeLoadoutAuthorizationV8 SelectionAccessProofV8 PackCompleteLineV8 RuntimeBaseEntitlementWitnessV8 RuntimePackEntitlementWitnessV8 RuntimePhysicalSelectionWitnessV8');
process.exit(1);
`);
    await chmod(binary, 0o755);
    const runner = new URL(`../../../move/animacraft_v8_${role}/scripts/run_adversarial_probes.mjs`, import.meta.url);
    const result = spawnSync(process.execPath, [runner.pathname], {
      env: { ...process.env, PATH: `${directory}${delimiter}${process.env.PATH ?? ''}` },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, mode === 'abi' ? /unrelated ABI error/ : /expected 32.*E05001/);
    assert.doesNotMatch(result.stdout, /adversarial_abilities:.*(?:PASS|observed)/);
  });
}
