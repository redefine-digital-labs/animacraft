import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NATIVE_SOUL_EXTERNAL_PUBLICATIONS, verifyNativeSoulExternalSourceTree } from './native-soul-external-publications.mjs';

/** Explicit public-source prerequisite for source/build-entry tests. The reader
 * and release runner remain read-only and fail closed when this cache is absent.
 * No compiler or publication is performed here. Existing caches are verified,
 * never repaired, overwritten, or silently replaced. */
export function prepareNativeSoulExternalSources(moveHome) {
  if (typeof moveHome !== 'string' || !path.isAbsolute(moveHome) || path.resolve(moveHome) !== moveHome
    || moveHome === path.parse(moveHome).root || /[\x00-\x1f\x7f]/.test(moveHome)) {
    throw new Error('Provide an exact absolute dedicated MOVE_HOME directory');
  }
  const groups = new Map();
  for (const pin of NATIVE_SOUL_EXTERNAL_PUBLICATIONS) {
    const name = `${pin.git.replace(/[/:.@]/g, '_')}_${pin.rev}`;
    const group = groups.get(name) ?? { repository: path.join(moveHome, 'git', name), pins: [] };
    group.pins.push(pin); groups.set(name, group);
  }
  function verify() {
    return [...groups.values()].flatMap(group => group.pins.map(pin => ({ packageName: pin.packageName,
      rev: pin.rev, ...verifyNativeSoulExternalSourceTree({ repository: group.repository, rev: pin.rev, subdir: pin.subdir }) })));
  }
  if (existsSync(moveHome)) {
    if (lstatSync(moveHome).isSymbolicLink() || !lstatSync(moveHome).isDirectory()) throw new Error('MOVE_HOME must be a real directory');
    return verify();
  }
  // A fresh private target makes partial fetch failures explicit; callers can
  // select another fresh directory without modifying anyone else's cache.
  mkdirSync(moveHome, { mode: 0o700 });
  mkdirSync(path.join(moveHome, 'git'), { mode: 0o700 });
  for (const { repository, pins } of groups.values()) {
    mkdirSync(repository, { mode: 0o700 });
    const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', '-C', repository, ...args], {
      encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    git(['init', '-q']);
    git(['remote', 'add', 'origin', pins[0].git]);
    git(['fetch', '--no-tags', '--depth=1', '--filter=blob:none', 'origin', pins[0].rev]);
    git(['sparse-checkout', 'init', '--cone']);
    git(['sparse-checkout', 'set', ...pins.map(pin => pin.subdir)]);
    git(['checkout', '--detach', '--quiet', pins[0].rev]);
  }
  return verify();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/prepare-native-soul-external-sources.mjs <absolute-MOVE_HOME>');
  console.log(JSON.stringify({ moveHome: process.argv[2], sources: prepareNativeSoulExternalSources(process.argv[2]) }, null, 2));
}
