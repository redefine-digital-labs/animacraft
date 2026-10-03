import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import {
  MACOS_BINARY_SHA256, LINUX_ARCHIVE_SHA256, SUI_VERSION,
  assertToolchainIdentity, hashFile, hashArchiveSui,
} from './harness/animacraft_v8_seal_cap_harness/scripts/toolchain_identity.mjs';

const binary = 'a'.repeat(64);
const linux = { platform: 'linux', arch: 'x64', binarySha256: binary,
  archiveSha256: LINUX_ARCHIVE_SHA256, archiveBinarySha256: binary,
  version: SUI_VERSION };

test('quick resolves the authenticated executable before later commands change cwd', () => {
  const source = readFileSync(new URL('./harness/animacraft_v8_seal_cap_harness/scripts/verify_reproducibility.mjs', import.meta.url), 'utf8');
  const declaration = source.match(/const binaryPath = [\s\S]*?;/)?.[0];
  assert.ok(declaration);
  const actual = runInNewContext(`${declaration}\nbinaryPath`, {
    suiBinary: 'tools/sui', resolve, execFileSync: () => { throw new Error('unexpected PATH lookup'); },
  });
  assert.equal(actual, resolve('tools/sui'));
  assert.match(source, /if \(command === 'sui'\) command = binaryPath;/);
});

test('quick gate final success report executes using the verified toolchain identity', () => {
  const source = readFileSync(new URL('./harness/animacraft_v8_seal_cap_harness/scripts/verify_reproducibility.mjs', import.meta.url), 'utf8');
  const report = source.slice(source.lastIndexOf('process.stdout.write(')).trim();
  let actual = '';
  runInNewContext(report, { toolchain: { version: SUI_VERSION },
    process: { stdout: { write: text => { actual += text; } } } });
  assert.equal(actual, `ok: seal-cap quick reproducibility gate passed with ${SUI_VERSION}\n`);
});

test('Ubuntu pinned archive binary is accepted independently of the macOS hash', () => {
  assert.doesNotThrow(() => assertToolchainIdentity(linux));
});
test('macOS retains its exact binary and version pins', () => {
  assert.doesNotThrow(() => assertToolchainIdentity({ platform: 'darwin', arch: 'arm64',
    binarySha256: MACOS_BINARY_SHA256, version: SUI_VERSION }));
  assert.throws(() => assertToolchainIdentity({ platform: 'darwin', arch: 'arm64',
    binarySha256: binary, version: SUI_VERSION }), /macOS binary/);
});
test('Linux rejects absent, unpinned and mismatched archive evidence', () => {
  for (const patch of [{ archiveSha256: undefined }, { archiveSha256: binary },
    { archiveBinarySha256: 'b'.repeat(64) }, { binarySha256: MACOS_BINARY_SHA256 }]) {
    assert.throws(() => assertToolchainIdentity({ ...linux, ...patch }));
  }
});
test('unsupported platform/architecture and wrong version fail closed', () => {
  for (const patch of [{ platform: 'win32' }, { arch: 'arm64' }, { version: 'sui 1.80.1' }]) {
    assert.throws(() => assertToolchainIdentity({ ...linux, ...patch }));
  }
});
test('archive extraction hashes actual member bytes and rejects ambiguity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'seal-cap-identity-test-'));
  try {
    writeFileSync(join(dir, 'sui'), 'tiny test executable bytes');
    const archive = join(dir, 'fixture.tgz');
    execFileSync('tar', ['-czf', archive, '-C', dir, 'sui']);
    assert.equal(await hashArchiveSui(archive), await hashFile(join(dir, 'sui')));
    execFileSync('tar', ['-czf', archive, '-C', dir, 'sui', './sui']);
    await assert.rejects(hashArchiveSui(archive), /exactly one/);
    execFileSync('tar', ['-czf', archive, '-C', dir, '--files-from', '/dev/null']);
    await assert.rejects(hashArchiveSui(archive), /exactly one/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('actual Linux verifier rejects an env-self-certified archive before executing binary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'seal-cap-identity-untrusted-'));
  try {
    const binaryPath = join(dir, 'sui');
    const marker = join(dir, 'executed');
    writeFileSync(binaryPath, `#!/bin/sh\ntouch '${marker}'\necho '${SUI_VERSION}'\n`, { mode: 0o755 });
    const archive = join(dir, 'fixture.tgz');
    execFileSync('tar', ['-czf', archive, '-C', dir, 'sui']);
    const moduleUrl = new URL('./harness/animacraft_v8_seal_cap_harness/scripts/toolchain_identity.mjs', import.meta.url).href;
    const script = `Object.defineProperty(process, 'platform', {value:'linux'});
      Object.defineProperty(process, 'arch', {value:'x64'});
      const {verifyToolchainIdentity} = await import(${JSON.stringify(moduleUrl)});
      await verifyToolchainIdentity(process.argv[1], process.argv[2]);`;
    const archiveSha256 = await hashFile(archive);
    assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', script, binaryPath, archive], {
      stdio: 'pipe', env: { ...process.env, SUI_ARCHIVE_SHA256: archiveSha256 },
    }), /Linux archive SHA-256 mismatch/);
    assert.equal(existsSync(marker), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
