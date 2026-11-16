// Real installed UI, native HTTP, queue, IndexedDB and cached media.
// Only the remote provider is replaced by the disposable runner's HTTPS server.
import assert from 'node:assert/strict';
import path from 'node:path';

export const syntheticPng = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAc0lEQVR4nO3QQQ0AIAwAsb0RgbrpRAkicAAilj1IeskZaJyZt/OxdutRDQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPgf4AFC+3nDnYDTzQAAAABJRU5ErkJggg==';
export const model55 = 'doubao-seedream-5-5-261028';
export const model45 = 'doubao-seedream-4-5-251128';
export function syntheticModelResponse(body) {
  assert.ok([model45, model55].includes(body.model), 'Unexpected paid-model route in synthetic test');
  if (body.layer_decomposition_options) {
    assert.equal(body.model, model55);
    assert.deepEqual(body.layer_decomposition_options, { max_images: 30, text_recognition: true });
    assert.equal(body.size, '1.5K');
    assert.equal(body.background, undefined);
    return { data: [0, 1, 2].map(z => ({
      url: 'data:image/png;base64,' + syntheticPng, z_index: z,
      name: z ? '标题' + z : '底图', description: 'SYNTHETIC', size: '64x64',
      bounding_box: { absolute: [0, 0, 64, 64], normalized: [0, 0, 1000, 1000] },
      background: z ? 'transparent' : 'opaque',
      ...(z ? { text_recognition: { text: '你好 ' + z, lines: [{ font: { family: 'Synthetic' }, styles: [{ bold: true }] }] } } : {}),
      future_extension: { preserve: true },
    })) };
  }
  if (body.model === model55) {
    assert.equal(body.background, 'transparent');
    assert.equal(body.output_format, 'png');
  }
  return { data: [{ url: 'data:image/png;base64,' + syntheticPng }] };
}
async function records(page, db, store) {
  return page.evaluate(async ({ db, store }) => {
    if (!(await indexedDB.databases()).some(d => d.name === db)) return [];
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(db);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const connection = request.result;
        if (!connection.objectStoreNames.contains(store)) { connection.close(); resolve([]); return; }
        const read = connection.transaction(store).objectStore(store).getAll();
        read.onsuccess = () => { connection.close(); resolve(read.result); };
        read.onerror = () => { connection.close(); reject(read.error); };
      };
    });
  }, { db, store });
}
async function until(fn, description) {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw Error(description);
}
async function enter(page) {
  if (!await page.getByRole('navigation', { name: '创作导航' }).isVisible())
    await page.getByRole('button', { name: 'opentu 创作', exact: true }).click();
  await page.getByRole('navigation', { name: '创作导航' }).waitFor();
}
export async function leaveCreative(page) {
  await page.getByRole('button', { name: '兔子助手导航', exact: true }).click();
  await page.getByRole('button', { name: 'Codex', exact: true }).click();
}
async function canvas(page) {
  await enter(page);
  await page.getByRole('navigation', { name: '创作导航' }).getByRole('button', { name: '自由画布', exact: true }).click();
  await page.locator('.plait-board-container').waitFor();
  const intro = page.getByText('不再提示', { exact: true });
  if (await intro.isVisible()) await intro.click();
}
async function configure(page) {
  await page.getByRole('button', { name: '创作配置', exact: true }).click();
  const dialog = page.getByTestId('settings-dialog');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '手动配置', exact: true }).click();
  await dialog.locator('input[type=password]').fill('sk-SYNTHETIC-GENERATION');
  await dialog.locator('.settings-dialog__field').filter({ has: page.locator('label').filter({ hasText: /^API 地址$/ }) }).locator('input').first().fill('https://api.tu-zi.com/v1');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
}
async function generate(page, version) {
  const before = await records(page, 'aitu-app', 'tasks');
  await page.locator('.model-dropdown__trigger').first().click();
  await page.getByText('豆包', { exact: true }).click();
  await page.locator('.model-dropdown__item').filter({ hasText: version === '5.5' ? /Seedream 5.5|doubao-seedream-5-5/ : /Seedream 4.5|doubao-seedream-4-5/ }).first().click();
  if (version === '5.5') {
    await page.locator('.parameters-dropdown__trigger').first().click();
    await page.getByText('透明（PNG）', { exact: true }).click();
  }
  await page.locator('.ai-input-bar__input').first().fill('SYNTHETIC installed upgrade ' + version);
  await page.locator('[data-track="ai_input_click_send"]').first().click();
  await until(async () => (await records(page, 'aitu-app', 'tasks')).some(t => !before.some(b => b.id === t.id) && t.insertedToCanvas), 'Native generation did not reach the persisted canvas');
  return (await records(page, 'aitu-app', 'tasks')).find(t => !before.some(b => b.id === t.id) && t.insertedToCanvas);
}
async function waitForStableGenerationAnchors(page) {
  await until(async () => {
    const boards = await records(page, 'aitu-workspace', 'boards');
    return boards.length > 0 && boards.every(board =>
      board.elements.every(element => element.type !== 'generation-anchor')
    );
  }, 'Generation result did not settle after insertion');
}
async function snapshot(page) {
  const boards = (await records(page, 'aitu-workspace', 'boards')).filter(b => b.elements.some(e => e.type === 'image'));
  assert.ok(boards.length, 'Real UI must create a populated board');
  return { boards: boards.map(b => ({ id: b.id, name: b.name, elements: b.elements })), taskIds: (await records(page, 'aitu-app', 'tasks')).filter(t => t.insertedToCanvas).map(t => t.id) };
}
async function imagePixels(page, id) {
  await page.waitForFunction(id => {
    const img = document.querySelector(`[plait-data-id="${id}"] img`);
    return img?.complete && img.naturalWidth === 64;
  }, id);
  const pixels = await page.evaluate(id => {
    const img = document.querySelector(`[plait-data-id="${id}"] img`);
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
    return [8, 32, 56].map(x => [...context.getImageData(x, 8, 1, 1).data]);
  }, id);
  assert.deepEqual(pixels, [[240, 30, 100, 255], [10, 190, 220, 255], [0, 0, 0, 0]], 'Cached synthetic media must retain exact pixels and alpha');
  return pixels;
}
export async function createLegacyCreative(page, output) {
  await enter(page); await configure(page); await canvas(page);
  const task = await generate(page, '4.5');
  await waitForStableGenerationAnchors(page);
  const saved = await snapshot(page);
  const element = saved.boards.flatMap(b => b.elements).find(e => e.generationTaskId === task.id);
  assert.ok(element);
  saved.pixelElementId = element.id;
  await imagePixels(page, element.id);
  await page.screenshot({ path: path.join(output, '05-legacy-creative-project.png') });
  return saved;
}
export async function verifyCreativePreserved(page, saved, output, label) {
  await canvas(page);
  await waitForStableGenerationAnchors(page);
  const current = await snapshot(page);
  for (const board of saved.boards) {
    const restored = current.boards.find(b => b.id === board.id);
    assert.ok(restored, 'Original project must survive');
    assert.equal(restored.name, board.name);
    for (const element of board.elements) assert.deepEqual(restored.elements.find(e => e.id === element.id), element);
  }
  for (const id of saved.taskIds) assert.ok(current.taskIds.includes(id), 'Completed task must survive');
  await imagePixels(page, saved.pixelElementId);
  await page.screenshot({ path: path.join(output, `06-${label}-creative-preserved.png`) });
}
export async function exerciseSeedream55(page, output) {
  await enter(page); await configure(page); await canvas(page);
  const task = await generate(page, '5.5');
  const initial = await snapshot(page);
  const element = initial.boards.flatMap(b => b.elements).find(e => e.generationTaskId === task.id);
  assert.ok(element); await imagePixels(page, element.id);
  await page.getByRole('button', { name: 'Seedream 5.5 分层 / OCR', exact: true }).click();
  const dialog = page.locator('.layer-decomposition-dialog'); await dialog.waitFor();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('slider').fill('29');
  await dialog.getByRole('combobox').selectOption('1.5K');
  await dialog.getByRole('button', { name: '开始分层', exact: true }).click();
  await dialog.getByText('分层已就绪', { exact: true }).waitFor({ timeout: 60000 });
  await dialog.getByText('标题1 · OCR', { exact: true }).click();
  await dialog.getByText('你好 1', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, '07-native-seedream55-ocr.png') });
  await dialog.getByRole('button', { name: /应用|插入/ }).click();
  await until(async () => (await records(page, 'aitu-workspace', 'boards')).some(b => b.elements.filter(e => e.metadata?.semanticLayer).length === 3), 'Native layer metadata was not saved');
  await until(async () => (await records(page, 'aitu-workspace', 'boards')).every(b => b.elements.every(e => e.type !== 'generation-anchor')), 'Completed generation placeholder remains after source replacement');
  const saved = await snapshot(page);
  const layers = saved.boards.flatMap(b => b.elements).filter(e => e.metadata?.semanticLayer);
  assert.equal(layers.length, 3);
  assert.equal(layers[1].metadata.semanticLayer.textRecognition.text, '你好 1');
  assert.equal(layers[2].metadata.semanticLayer.providerMetadata.future_extension.preserve, true);
  const manifest = saved.boards.flatMap(b => b.elements).find(e => e.metadata?.semanticLayerGroup)?.metadata.semanticLayerGroup.manifest;
  assert.equal(manifest.layers.length, 3); assert.equal(manifest.layers[1].textRecognition.text, '你好 1');
  // Applying layers replaces the source image. Inspect a surviving layer,
  // while the snapshot above still verifies every persisted element exactly.
  saved.pixelElementId = layers[0].id;
  assert.ok(saved.boards.some(b => b.elements.some(e => e.id === saved.pixelElementId)));
  return saved;
}
