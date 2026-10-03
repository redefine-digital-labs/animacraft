import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';

export const SUI_VERSION = 'sui 1.80.1-671ba71e69c7';
export const MACOS_BINARY_SHA256 = '1d7baa7c7314113671415acfa20279b1eedb6ae6d04f286988a00da285e769c3';
// Official mainnet-v1.80.1 Ubuntu x86_64 archive, independently pinned here.
export const LINUX_ARCHIVE_SHA256 = '97f9aed10e0c2fe3204ce4639ac992e1449b17c14f22f30e9f903ead54ac7336';

function fail(message) { throw new Error(`seal-cap toolchain: ${message}`); }

export function assertToolchainIdentity({ platform, arch, binarySha256,
  archiveSha256, archiveBinarySha256, version }) {
  if (platform === 'darwin') {
    if (binarySha256 !== MACOS_BINARY_SHA256) fail('macOS binary SHA-256 mismatch');
  } else if (platform === 'linux' && arch === 'x64') {
    if (archiveSha256 !== LINUX_ARCHIVE_SHA256) fail('Linux archive SHA-256 mismatch');
    if (!/^[0-9a-f]{64}$/.test(binarySha256 ?? '')
        || binarySha256 !== archiveBinarySha256) fail('Linux binary differs from pinned archive');
  } else fail(`unsupported platform/architecture ${platform}/${arch}`);
  if (version !== SUI_VERSION) fail(`exact CLI version mismatch: ${version}`);
}

export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function hashArchiveSui(archivePath) {
  const entries = execFileSync('tar', ['-tzf', archivePath], {
    encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
  }).trim().split('\n').filter(name => /^(\.\/)?sui$/.test(name));
  if (entries.length !== 1) fail('archive must contain exactly one root sui member');
  const child = spawn('tar', ['-xOzf', archivePath, entries[0]], {
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000,
  });
  const hash = createHash('sha256');
  let stderr = '';
  child.stdout.on('data', chunk => hash.update(chunk));
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`seal-cap toolchain: archive extraction failed (${code}/${signal}): ${stderr}`));
    });
  });
  return hash.digest('hex');
}

// The caller supplies paths only. No environment-provided digest is authority.
export async function verifyToolchainIdentity(binaryPath, archivePath) {
  const identity = { platform: process.platform, arch: process.arch,
    binarySha256: await hashFile(binaryPath), version: SUI_VERSION };
  if (process.platform === 'linux' && process.arch === 'x64') {
    if (!archivePath) fail('Linux requires ANIMACRAFT_SUI_ARCHIVE pointing to the pinned official archive');
    identity.archiveSha256 = await hashFile(archivePath);
    if (identity.archiveSha256 !== LINUX_ARCHIVE_SHA256) fail('Linux archive SHA-256 mismatch');
    identity.archiveBinarySha256 = await hashArchiveSui(archivePath);
    if (await hashFile(archivePath) !== identity.archiveSha256) fail('archive changed during verification');
  }
  // Authenticate bytes before executing them to inspect the version.
  assertToolchainIdentity(identity);
  identity.version = execFileSync(binaryPath, ['--version'], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
  }).trim();
  if (await hashFile(binaryPath) !== identity.binarySha256) fail('binary changed during verification');
  assertToolchainIdentity(identity);
  return Object.freeze(identity);
}
