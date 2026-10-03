import { makeTinyDraft as makeDraft } from './tiny-fomoney-draft.js';
import { createMakerV8DraftPersistence } from '../maker-v8-draft-store.js';
import { renderMakerV8DraftRecipePngV8 } from '../maker-v8-player-journey.js';
import { createMakerV8LocalPlayer } from '../maker-v8-local-player.js';

const status = document.querySelector('#status');
const button = document.querySelector('#run');
const reference = document.querySelector('#reference');
const product = document.querySelector('#product');
const catalog = await (await fetch('/tiny-catalog.json')).json();
const store = createMakerV8DraftPersistence(indexedDB, { databaseName: 'tiny-fomoney-render-acceptance-only' });
const images = new Map();
const rows = [];
async function decode(base64) {
  if (!images.has(base64)) images.set(base64, createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob()));
  return images.get(base64);
}
async function compare(draft, assets, label, expectDifference = false) {
  const expected = reference.getContext('2d');
  expected.clearRect(0, 0, 800, 800);
  // Independent source-coordinate oracle: fixed catalogue order, not product transform/track logic.
  for (const layer of catalog[draft.lineage.makerKey.endsWith('woman') ? 'woman' : 'man']) {
    const selected = draft.defaultRecipe.selections.find(s => s.partKey === layer.key);
    if (!selected) continue;
    const index = Number(selected.itemKey.slice(layer.key.length + 1));
    expected.drawImage(await decode(layer.entries[index].bytesBase64), 0, 0);
  }
  const rendered = await renderMakerV8DraftRecipePngV8({ document: draft, assets });
  const actual = product.getContext('2d');
  actual.clearRect(0, 0, 800, 800);
  actual.drawImage(await decode(rendered.bytesBase64), 0, 0);
  const left = expected.getImageData(0, 0, 800, 800).data;
  const right = actual.getImageData(0, 0, 800, 800).data;
  let differentPixels = 0;
  for (let i = 0; i < left.length; i += 4) if (left[i] !== right[i] || left[i + 1] !== right[i + 1] || left[i + 2] !== right[i + 2] || left[i + 3] !== right[i + 3]) differentPixels++;
  rows.push({ label, differentPixels, expectDifference, sha256: rendered.sha256 });
  status.textContent = `${rows.length} 项完成；差异像素 ${differentPixels}\n${label}`;
  if (expectDifference ? differentPixels === 0 : differentPixels !== 0) throw new Error(`${label}: unexpected ${differentPixels} differing pixels`);
}
button.onclick = async () => {
  button.disabled = true;
  rows.length = 0;
  try {
    for (const [gender, layers] of Object.entries(catalog)) {
      const { draft, assets } = makeDraft(gender, layers);
      const draftId = `tiny-${gender}-${crypto.randomUUID()}`;
      await store.createBundle({ draftId, document: draft, assets });
      store.close();
      const reloaded = await store.load(draftId);
      const savedAssets = await store.listAssets(draftId);
      if (JSON.stringify(reloaded.document) !== JSON.stringify(draft)) throw new Error('Saved document changed');
      await compare(reloaded.document, savedAssets, `${gender}: 保存并关闭数据库后重新打开`);
      for (const part of draft.parts) {
        for (const item of part.items) {
          const candidate = structuredClone(reloaded.document);
          if (['eye', 'mouth', 'face', 'hair'].includes(part.key)) candidate.defaultRecipe.selections = candidate.defaultRecipe.selections.filter(s => s.partKey !== 'gear');
          candidate.defaultRecipe.selections.find(s => s.partKey === part.key).itemKey = item.key;
          await compare(candidate, savedAssets, `${gender}/${part.label}/${item.label}`);
        }
        const hidden = structuredClone(reloaded.document);
        hidden.defaultRecipe.selections = hidden.defaultRecipe.selections.filter(s => s.partKey !== part.key);
        await compare(hidden, savedAssets, `${gender}/${part.label}/隐藏`);
      }
      const player = createMakerV8LocalPlayer({ draftId, draftRevision: reloaded.revision, document: reloaded.document });
      const changed = structuredClone(player.getSnapshot().recipe);
      changed.selections = changed.selections.filter(s => s.partKey !== 'gear');
      changed.selections.find(s => s.partKey === 'eye').itemKey = 'eye-0';
      const selected = player.setRecipe(changed, player.getSnapshot().revision);
      const candidate = structuredClone(reloaded.document);
      candidate.defaultRecipe = { selections: selected.recipe.selections, colors: selected.recipe.colors };
      await compare(candidate, savedAssets, `${gender}: 真实 Local Player 选择`);
      const undone = player.undo(player.getSnapshot().revision);
      candidate.defaultRecipe = { selections: undone.recipe.selections, colors: undone.recipe.colors };
      await compare(candidate, savedAssets, `${gender}: 真实 Local Player Undo`);
      player.dispose();
      // Sensitivity control: test-only document drift must fail pixel parity.
      const shifted = structuredClone(reloaded.document);
      shifted.defaultRecipe.selections = shifted.defaultRecipe.selections.filter(s => s.partKey !== 'gear');
      const eye = shifted.defaultRecipe.selections.find(s => s.partKey === 'eye');
      shifted.parts.find(p => p.key === 'eye').items.find(i => i.key === eye.itemKey).styles[0].transform.x = 8;
      await compare(shifted, savedAssets, `${gender}: 故意偏移 8px 的检测对照`, true);
      await compare(reloaded.document, savedAssets, `${gender}: 恢复未偏移画面`);
    }
    status.textContent = `PASS：${rows.length} 项；${rows.filter(r => !r.expectDifference).length} 项 800×800 RGBA 逐像素一致，2 项故意偏移对照均被检出。\n实际 IndexedDB 保存/关闭/重开，68 个素材逐项替换、各层隐藏及 Local Player 选择/Undo。\n仍未验收：真实 Creator 导入 UI、完整 Player/发行、Soulidity。\n` + JSON.stringify(rows, null, 2);
  } catch (error) { status.textContent = `FAIL: ${error.stack}\n` + JSON.stringify(rows, null, 2); }
  finally { button.disabled = false; }
};
status.textContent = '就绪。仅写入本地独立测试数据库；点击运行。';
