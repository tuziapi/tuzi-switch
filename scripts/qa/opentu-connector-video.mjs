// Explicit single paid submission through the installed app. Never retries.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { isAbsolute } from 'node:path';
const [executable, runtime, mode = '--inspect', selection] = process.argv.slice(2);
if (!isAbsolute(executable || '') || !isAbsolute(runtime || '') || !['--inspect', '--generate', '--watch'].includes(mode)) throw new Error('Expected executable, runtime, --inspect|--generate profileId|--watch taskId');
const child = spawn(executable, ['--opentu-mcp-stdio', runtime], { stdio: ['pipe', 'pipe', 'ignore'] });
const pending = new Map(); let sequence = 0;
function fail() { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Connector interrupted; inspect existing tasks before any submission')); } pending.clear(); }
child.on('error', fail); child.on('exit', fail);
createInterface({ input: child.stdout }).on('line', line => {
  let value; try { value = JSON.parse(line); } catch { fail(); return; }
  const item = pending.get(value.id); if (!item) return;
  pending.delete(value.id); clearTimeout(item.timer);
  if (value.error) item.reject(new Error(`RPC rejected (${value.error.code}); do not resubmit`)); else item.resolve(value.result);
});
function rpc(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('RPC timed out; do not resubmit')); }, 65000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
async function call(name, args = {}) {
  const result = await rpc('tools/call', { name, arguments: args });
  if (result.isError) throw new Error(`Tool failed: ${name}; inspect assistant, do not resubmit`);
  return JSON.parse(result.content.find(c => c.type === 'text').text);
}
const report = value => console.log(JSON.stringify({ time: new Date().toISOString(), targetDesktopClientTested: false, ...value }));
try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'OpenTu video acceptance', version: '1' } });
  if (mode === '--inspect') {
    const { models } = await call('opentu_list_models');
    report({ models: models.filter(m => m.type === 'video' && m.id === 'MiniMax-H3') });
  } else if (mode === '--generate') {
    if (!selection) throw new Error('Explicit profile required');
    const { models } = await call('opentu_list_models');
    const matches = models.filter(m => m.type === 'video' && m.id === 'MiniMax-H3' && m.modelRef.profileId === selection);
    if (matches.length !== 1) throw new Error('Model source missing or ambiguous');
    const before = await call('opentu_get_canvas');
    const created = await call('opentu_create_video', {
      prompt: '4秒唯美动漫风景短片，16:9横屏。傍晚海边，一列白色小火车沿海岸缓缓从左向右驶过，天空粉紫色晚霞，海面闪烁金色细光，前景野花轻轻摇动，镜头平稳缓慢前移，画面连贯细腻，温柔宁静。单一连续镜头，不要字幕、文字或水印。',
      modelRef: matches[0].modelRef, seconds: 4, size: '768P', aspectRatio: '16:9', insertToCanvas: true,
    });
    if (!created.taskId) throw new Error('Missing task ID; inspect recent tasks, do not resubmit');
    report({ submitted: true, paidGeneration: true, taskId: created.taskId, boardId: before.boardId, canvasElementsBefore: before.elements.length });
  } else {
    if (!selection) throw new Error('Existing task ID required');
    const task = await call('opentu_get_task', { taskId: selection, waitMs: 20000 });
    report({ taskId: task.id, remoteId: task.remoteId, status: task.status, progress: task.progress, insertedToCanvas: task.insertedToCanvas, errorCode: task.error?.code, requested: task.requested });
    if (task.status === 'completed') report({ delivery: await call('opentu_get_task_result', { taskId: selection }) });
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { child.kill(); }
