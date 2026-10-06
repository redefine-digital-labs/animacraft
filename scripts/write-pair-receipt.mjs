import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function pairReceipt({ site, ac, so, env }) {
  if (!['ac', 'so'].includes(site) || !/^[0-9a-f]{40}$/.test(ac) || !/^[0-9a-f]{40}$/.test(so)) {
    throw new Error('Exact checked-out pair required');
  }
  const pair = { ac, so };
  const peer = site === 'ac' ? env.SOULIDITY_COMMIT_SHA : env.ANIMACRAFT_COMMIT_SHA;
  if (pair[site] !== env.GITHUB_SHA || pair[site === 'ac' ? 'so' : 'ac'] !== peer) {
    throw new Error('Checked-out sources differ from workflow inputs');
  }
  if (!/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '') || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? '') ||
      !['workflow_dispatch', 'pull_request', 'push'].includes(env.GITHUB_EVENT_NAME)) {
    throw new Error('Actual CI execution identity required');
  }
  return { schema: 1, site, pair, event: env.GITHUB_EVENT_NAME,
    run_id: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT };
}

export function writeReceipt({ site, acRoot, soRoot, output, env = process.env }) {
  const head = root => {
    // Fail if a test changed tracked source before this receipt was emitted.
    execFileSync('git', ['-C', root, 'diff', '--exit-code', 'HEAD', '--'], { stdio: 'pipe' });
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  };
  const receipt = pairReceipt({ site, ac: head(acRoot), so: head(soRoot), env });
  writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [site, acRoot, soRoot, output, ...extra] = process.argv.slice(2);
  if (!site || !acRoot || !soRoot || !output || extra.length) {
    throw new Error('Usage: write-pair-receipt.mjs ac|so AC_ROOT SO_ROOT OUTPUT');
  }
  console.log(JSON.stringify(writeReceipt({ site, acRoot, soRoot, output })));
}
