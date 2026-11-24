// Explicit, single-image desktop acceptance. No model keys or media URLs are logged.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { isAbsolute } from 'node:path';

const [executable, runtime, mode = '--inspect', selection, expectedElementId] = process.argv.slice(2);
if (!executable || !runtime || !isAbsolute(executable) || !isAbsolute(runtime) || !['--inspect', '--generate', '--verify'].includes(mode)) {
  throw new Error('Usage: node opentu-connector-image.mjs <executable> <runtime> [--inspect | --generate <profileId> | --verify <taskId> <elementId>]');
}
const child = spawn(executable, ['--opentu-mcp-stdio', runtime], { stdio: ['pipe', 'pipe', 'ignore'] });
const pending = new Map();
let sequence = 0;
function fail(message) {
  for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error(message)); }
  pending.clear();
}
child.on('error', () => fail('Connector failed to start'));
child.on('exit', () => fail('Connector exited'));
createInterface({ input: child.stdout }).on('line', line => {
  let value;
  try { value = JSON.parse(line); } catch { fail('Invalid connector response'); return; }
  const waiter = pending.get(value.id);
  if (!waiter) return;
  pending.delete(value.id); clearTimeout(waiter.timer);
  if (value.error) waiter.reject(new Error(`RPC rejected (${value.error.code})`));
  else waiter.resolve(value.result);
});
function rpc(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Request timed out; do not resubmit generation automatically')); }, 30000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
async function call(name, args = {}) {
  const result = await rpc('tools/call', { name, arguments: args });
  if (result.isError) throw new Error(`Tool failed: ${name}`);
  return JSON.parse(result.content.find(c => c.type === 'text').text);
}
const report = value => console.log(JSON.stringify({ time: new Date().toISOString(), targetDesktopClientTested: false, ...value }));
const acceptancePrompt = '一张方形高质感产品静物照片：奶白色陶瓷兔子造型台灯放在浅橡木桌面上，温暖柔和的灯光，浅鼠尾草绿色背景，居中完整构图，细腻陶瓷质感，简洁留白。只生成一张完整图片，不要拼图，不要文字，不要水印。';
try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'OpenTu explicit image acceptance', version: '1' } });
  const before = await call('opentu_get_canvas');
  if (mode === '--inspect') {
    const { models } = await call('opentu_list_models');
    report({ canvasElements: before.elements.length, imageModels: models.filter(m => m.type === 'image' && m.id === 'gpt-image-2.5'), paidGeneration: false });
  } else {
    let taskId = selection;
    if (!selection) throw new Error('Explicit profileId or taskId required');
    if (mode === '--verify' && !expectedElementId) throw new Error('Pass the previously observed image element ID to verify persistence');
    if (mode === '--generate') {
      const { models } = await call('opentu_list_models');
      const matches = models.filter(m => m.type === 'image' && m.id === 'gpt-image-2.5' && (m.modelRef.profileId ?? 'null') === selection);
      if (matches.length !== 1) throw new Error('Selected model source is missing or ambiguous');
      // Exactly one task; no retries and no private reference attachments.
      const created = await call('opentu_create_image', {
        prompt: acceptancePrompt,
        modelRef: matches[0].modelRef, size: '1x1', insertToCanvas: true,
      });
      taskId = created.taskId;
      if (!taskId) throw new Error('No task ID returned; do not submit again');
      report({ submitted: true, taskId, paidGeneration: true, canvasElementsBefore: before.elements.length });
    }
    let task;
    const deadline = Date.now() + 12 * 60000;
    let previous;
    while (Date.now() < deadline) {
      task = await call('opentu_get_task', { taskId });
      if (task.status !== previous) { report({ taskId, status: task.status }); previous = task.status; }
      if (task.status === 'completed') break;
      if (['failed', 'cancelled', 'canceled'].includes(task.status)) throw new Error(`Task ${taskId} ended ${task.status}; no automatic retry`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (task?.status !== 'completed') throw new Error(`Task ${taskId} still pending; use --verify to resume without another charge`);
    const oldIds = new Set(before.elements.map(e => e.id));
    let after, matchingImages;
    const insertionDeadline = Date.now() + 60000;
    do {
      after = await call('opentu_get_canvas');
      if (after.boardId !== before.boardId) throw new Error('Canvas changed during acceptance; do not regenerate');
      matchingImages = after.elements.filter(e => e.type === 'image' && e.label === acceptancePrompt && (mode === '--verify' ? e.id === expectedElementId : !oldIds.has(e.id)));
      if (matchingImages.length) break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    } while (Date.now() < insertionDeadline);
    if (!matchingImages.length) throw new Error(`Task ${taskId} completed but canvas insertion is not verified; do not regenerate`);
    report({ taskId, passed: true, status: task.status, resultPresent: Boolean(task.result), canvasElements: after.elements.length,
      matchingImages: matchingImages.map(e => ({ id: e.id, type: e.type, points: e.points })),
      paidGeneration: mode === '--generate', visualAcceptanceRequired: true });
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { child.kill(); }
