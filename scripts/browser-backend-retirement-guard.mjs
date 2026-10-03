import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const retiredHandlers = ['api/protected-render.js', 'api/seal-key.js'];
const rules = [
  ['retired protected API', /(?:\/api\/(?:protected-render|seal-key))\b/],
  ['private server environment', /\bANIMACRAFT_(?:SEAL_API_KEY|V8_RUNTIME_JSON)\b/],
  ['Node crypto', /(?:node:crypto|(?:from\s*|import\s*\(|require\s*\()\s*['"]crypto['"])/],
  ['retired Seal aggregator', /seal-aggregator-mainnet\.mystenlabs\.com|createAnimacraftV8SealKeyProxyHandler|createAnimacraftV8ProtectedRenderHandler/],
];

export function assertBrowserBackendRetirementText(text, label, { source = false } = {}) {
  for (const [name, pattern] of rules) {
    if (pattern.test(text)) throw new Error(`Browser retirement guard: ${name} in ${label}`);
  }
  // SDK implementation code contains aggregator support. Reject application
  // configuration of it in source, not the SDK's inert bundled property names.
  if (source && /\b(?:aggregatorUrl|apiKeyName|apiKey)["']?\s*:/.test(text)) {
    throw new Error(`Browser retirement guard: server credential/aggregator adapter in ${label}`);
  }
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Browser retirement guard: unexpected symlink: ' + path);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

export function assertBrowserBackendRetirementSource(root) {
  for (const handler of retiredHandlers) {
    if (existsSync(join(root, handler))) throw new Error('Browser retirement guard: retired handler remains: ' + handler);
  }
  if (!existsSync(join(root, 'index.html')) || !existsSync(join(root, 'app.js'))) {
    throw new Error('Browser retirement guard: browser entrypoints are missing.');
  }
  // Current application modules live at repository root; public-v8 is Vite's
  // only copied asset directory. Build transform also checks any future nested
  // module actually imported by the browser. Never scan tools/history/fixtures.
  const paths = readdirSync(root).filter(name => /\.(?:js|mjs|html)$/.test(name)
    && !/^vite\.config\./.test(name)).map(name => join(root, name));
  if (existsSync(join(root, 'public-v8'))) paths.push(...walk(join(root, 'public-v8'))
    .filter(path => /\.(?:js|mjs|html|json)$/.test(path)));
  for (const path of paths) assertBrowserBackendRetirementText(
    readFileSync(path, 'utf8'), relative(root, path), { source: true });
  return paths.length;
}

export function assertBrowserBackendRetirementDist(dist) {
  if (!existsSync(dist) || !statSync(dist).isDirectory() || !existsSync(join(dist, 'index.html'))) {
    throw new Error('Browser retirement guard: complete browser build is required.');
  }
  const paths = walk(dist);
  for (const path of paths) {
    const name = relative(dist, path).replaceAll('\\', '/');
    if (retiredHandlers.includes(name)) throw new Error('Browser retirement guard: retired handler artifact: ' + name);
    if (/\.(?:js|mjs|html|json|map|txt)$/.test(path)) {
      assertBrowserBackendRetirementText(readFileSync(path, 'utf8'), name);
    }
  }
  return paths.length;
}

export function browserBackendRetirementPlugin() {
  let root, outDir;
  return {
    name: 'animacraft-browser-backend-retirement',
    apply: 'build',
    configResolved(config) { root = config.root; outDir = resolve(root, config.build.outDir); },
    buildStart() { assertBrowserBackendRetirementSource(root); },
    transform(code, id) {
      const path = id.split('?')[0];
      if (!path.startsWith(root + '/') || path.includes('/node_modules/')) return;
      if (/\.(?:js|mjs|ts|tsx|jsx)$/.test(path)) {
        assertBrowserBackendRetirementText(code, relative(root, path), { source: true });
      }
    },
    writeBundle() { assertBrowserBackendRetirementDist(outDir); },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const mode = process.argv[2] ?? '--all';
  if (!['--source', '--dist', '--all'].includes(mode)) throw new Error('Use --source, --dist [directory], or --all.');
  if (mode !== '--dist') console.log('Browser source retirement guard passed:', assertBrowserBackendRetirementSource(root));
  if (mode !== '--source') console.log('Browser build retirement guard passed:',
    assertBrowserBackendRetirementDist(resolve(process.argv[3] ?? join(root, 'dist'))));
}
