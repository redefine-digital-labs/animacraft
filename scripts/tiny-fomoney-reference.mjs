// Local, read-only author-coordinate reference. No wallet or production access.
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.argv[2];
if (!root) throw new Error('Usage: node scripts/tiny-fomoney-reference.mjs <asset-directory>');
const assets = new Map();
const catalog = {};
for (const gender of ['man', 'woman']) {
  catalog[gender] = [];
  // Back to front; verify gear/hair occlusion visually, never reposition pixels.
  for (const suffix of ['background', 'body', 'face', 'mouth', 'eye', 'hair', 'gear']) {
    const folders = (await readdir(join(root, gender))).filter(name => name.includes(suffix));
    if (folders.length !== 1) throw new Error(`Ambiguous ${gender}/${suffix}`);
    const entries = [];
    for (const name of (await readdir(join(root, gender, folders[0]))).filter(n => n.endsWith('.png')).sort()) {
      const bytes = await readFile(join(root, gender, folders[0], name));
      if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        || bytes.readUInt32BE(16) !== 800 || bytes.readUInt32BE(20) !== 800) throw new Error(`Invalid source canvas: ${name}`);
      const id = createHash('sha256').update(bytes).digest('hex');
      assets.set('/asset/' + id, bytes);
      entries.push({ name, url: '/asset/' + id });
    }
    catalog[gender].push({ name: suffix, entries });
  }
}
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TINY FOMONEY — source-coordinate reference</title>
<style>body{margin:24px;background:#171923;color:#eee;font:15px system-ui}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}section{min-width:0}.stage{position:relative;width:100%;max-width:800px;aspect-ratio:1;background:#ddd}.stage img{position:absolute;inset:0;width:100%;height:100%}label{display:flex;justify-content:space-between;margin:8px 0;gap:8px}select{max-width:70%}p{color:#bfc5d5}</style>
<h1>TINY FOMONEY · 原坐标参考</h1><p>原始 800×800 · 无裁切 / 位移 / 独立缩放。仅本地参考，不代表已导入产品。星号文件暂作初始选择，并非已确认作者默认。</p><main></main>
<script>
const catalog=${JSON.stringify(catalog)};
for(const [gender,layers] of Object.entries(catalog)){
 const section=document.createElement('section'); const title=document.createElement('h2');title.textContent=gender;section.append(title);
 const stage=document.createElement('div');stage.className='stage';section.append(stage);
 for(const layer of layers){
  const img=document.createElement('img');img.alt='';stage.append(img);
  const label=document.createElement('label');label.append(layer.name);const select=document.createElement('select');
  const none=document.createElement('option');none.textContent='隐藏';none.value='';select.append(none);
  for(const entry of layer.entries){const option=document.createElement('option');option.value=entry.url;option.textContent=entry.name;select.append(option);}
  select.value=(layer.entries.find(e=>e.name.includes('*'))||layer.entries[0]).url;
  const update=()=>{img.hidden=!select.value;if(select.value)img.src=select.value;};select.onchange=update;update();label.append(select);section.append(label);
 }document.querySelector('main').append(section);
}
</script>`;
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const bytes = assets.get(path);
  if (request.method !== 'GET' || (path !== '/' && !bytes)) { response.writeHead(404); response.end(); return; }
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', bytes ? 'image/png' : 'text/html; charset=utf-8');
  response.end(bytes || html);
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, files: Object.values(catalog).flatMap(x => x.flatMap(l => l.entries)).length, uniqueHashes: assets.size })));
