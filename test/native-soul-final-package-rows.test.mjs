import test from 'node:test';
import assert from 'node:assert/strict';
import { mainnetV8FinalPackageRowsFromWal } from '../scripts/mainnet-v8-release.mjs';
import { MAINNET_V8_PUBLISH_ORDER } from '../scripts/mainnet-v8-release-lib.mjs';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
// Synthetic already-certified evidence: these tests exercise the actual runner
// projection, not finality authentication, mainnet publication or a complete WAL.
function fixture() {
  return {
    plan: { packages: MAINNET_V8_PUBLISH_ORDER.map((role, i) => ({ role, sourceCommitment: `${i}`.repeat(64) })) },
    events: MAINNET_V8_PUBLISH_ORDER.map((role, i) => ({
      ordinal: String(i), attempt: '0', status: 'FINALIZED_SUCCESS',
      evidence: { observation: { details: {
        packageCommitment: 'a'.repeat(64), abiCommitment: 'b'.repeat(64),
        certificate: {
          finalityEvidence: { digest: `publish-${i}` },
          finalityEvidenceSha256: 'c'.repeat(64), readbackSha256: 'd'.repeat(64),
          readback: { role,
            package: { reference: { objectId: id(i + 1), digest: `package-${i}`, version: '1' } },
            upgradeCap: { reference: { objectId: id(i + 101) } },
          },
        },
      } } },
    })),
  };
}

test('actual final-manifest runner projection includes Soulidity before Release', () => {
  const wal = fixture();
  const rows = mainnetV8FinalPackageRowsFromWal(wal);
  assert.deepEqual(rows.map(row => row.role), MAINNET_V8_PUBLISH_ORDER);
  assert.equal(rows[6].role, 'soulidity');
  assert.equal(rows[6].packageId, id(7));
  assert.equal(rows[7].role, 'release');
  assert.equal(rows[7].packageId, id(8));
  assert.equal(rows[7].sourceCommitment, '7'.repeat(64));
  assert.equal(rows[7].publishDigest, 'publish-7');
  wal.events.push({ ordinal: '8', status: 'FINALIZED_SUCCESS' });
  assert.deepEqual(mainnetV8FinalPackageRowsFromWal(wal), rows);
});

for (const [name, mutate] of [
  ['seven-package plan', wal => wal.plan.packages.splice(6, 1)],
  ['missing Soulidity result', wal => wal.events.splice(6, 1)],
  ['duplicate finalized result', wal => wal.events.push(structuredClone(wal.events[6]))],
  ['wrong planned ordinal', wal => { wal.plan.packages[6].role = 'release'; }],
  ['wrong certified ordinal', wal => { wal.events[6].evidence.observation.details.certificate.readback.role = 'release'; }],
  ['unfinalized Soulidity', wal => { wal.events[6].status = 'FINALIZED_SUCCESS_PENDING_READBACK'; }],
]) {
  test(`actual final-manifest projection rejects ${name}`, () => {
    const wal = fixture(); mutate(wal);
    assert.throws(() => mainnetV8FinalPackageRowsFromWal(wal));
  });
}
