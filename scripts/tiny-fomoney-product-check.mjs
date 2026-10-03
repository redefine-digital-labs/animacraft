// Loopback-only harness: actual product modules, private source bytes in memory.
import { createServer } from 'vite';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const source = process.argv[2];
if (!source) throw new Error('Pass the TINY_FOMONEY_Final directory.');
const catalog = {};
for (const gender of ['man', 'woman']) {
  catalog[gender] = [];
  for (const key of ['background', 'body', 'face', 'mouth', 'eye', 'hair', 'gear']) {
    const folders = (await readdir(join(source, gender))).filter(n => n.includes(key));
    if (folders.length !== 1) throw new Error(`Ambiguous ${gender}/${key}`);
    const entries = [];
    for (const name of (await readdir(join(source, gender, folders[0]))).filter(n => n.endsWith('.png')).sort()) {
      const bytes = await readFile(join(source, gender, folders[0], name));
      if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== 800 || bytes.readUInt32BE(20) !== 800) throw new Error(name);
      entries.push({ name, bytesBase64: bytes.toString('base64'), byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    catalog[gender].push({ key, entries });
  }
}
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TINY · 产品渲染核验</title>
<style>body{background:#171923;color:#eee;font:16px system-ui;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}canvas{width:100%;height:auto}pre{white-space:pre-wrap;max-height:160px;overflow:auto}button{padding:12px}</style>
<h1>TINY FOMONEY · 真实产品模块核验</h1><p>调用现有草稿校验、IndexedDB 保存和 Creator/Player 共用渲染器；不是完整产品 UI 验收，不连接钱包。</p>
<button id="run">运行全部素材替换核验</button><pre id="status">准备中</pre><main><section><h2>原坐标参考</h2><canvas id="reference" width="800" height="800"></canvas></section><section><h2>真实产品渲染结果</h2><canvas id="product" width="800" height="800"></canvas></section></main><script type="module" src="/scripts/tiny-fomoney-product-check-client.js"></script>`;
const creatorHtml = (await readFile('index.html', 'utf8'))
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  .replace('<title>Animacraft</title>', '<title>TINY · 本地真实编辑器验收</title>')
  .replace('</body>', '<div id="tinyHarnessStatus" role="status" style="position:fixed;bottom:0;left:0;right:0;z-index:100000;background:#503800;color:white;padding:8px;text-align:center">本地验收正在加载 · 非真实钱包 · 禁止链上操作</div><script type="module" src="/scripts/tiny-fomoney-creator-client.js"></script></body>');
const server = await createServer({ configFile: false, root: resolve('.'), publicDir: false,
  server: { host: '127.0.0.1', port: 57040, strictPort: true },
  plugins: [{ name: 'tiny-local-only', configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.method !== 'GET') { next(); return; }
      if (req.url?.split('?')[0] === '/tiny-creator') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'none'");
        res.end(creatorHtml); return;
      }
      if (req.url === '/tiny-catalog.json') { res.setHeader('Content-Type', 'application/json');res.setHeader('Cache-Control', 'no-store');res.end(JSON.stringify(catalog));return; }
      if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8');res.end(html);return; }
      next();
    });
  } }],
});
await server.listen();
server.printUrls();
