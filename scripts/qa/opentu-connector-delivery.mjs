// Installed-application acceptance. Queries existing tasks; NEVER submits generation.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { isAbsolute } from 'node:path';
const [executable, runtime, taskId, index = '0'] = process.argv.slice(2);
if (!isAbsolute(executable || '') || !isAbsolute(runtime || '') || !/^\d+$/.test(index)) {
  throw new Error('Usage: node opentu-connector-delivery.mjs <absolute executable> <absolute runtime> [existing taskId] [result index]');
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
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Request timed out; do not regenerate')); }, 65000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
async function call(name, args = {}) {
  const result = await rpc('tools/call', { name, arguments: args });
  if (result.isError) throw new Error(`Tool failed: ${name}; inspect the task in the assistant`);
  return { value: JSON.parse(result.content.find(c => c.type === 'text').text), result };
}
const report = value => console.log(JSON.stringify({ time: new Date().toISOString(), paidGeneration: false, targetDesktopClientTested: false, ...value }));
try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'OpenTu result delivery acceptance', version: '1' } });
  const { tools } = await rpc('tools/list', {});
  for (const name of ['opentu_list_tasks', 'opentu_get_task_result']) {
    if (!tools.some(tool => tool.name === name)) throw new Error('Installed app has not been updated');
  }
  const { value: models } = await call('opentu_list_models');
  report({ instructionsPresent: Boolean(init.instructions), videoModels: models.models.filter(model => model.id === 'MiniMax-H3') });
  if (taskId) {
    const { value: state } = await call('opentu_get_task', { taskId });
    report({ taskId, remoteId: state.remoteId, status: state.status, progress: state.progress, insertedToCanvas: state.insertedToCanvas, requested: state.requested });
    if (state.status === 'completed') {
      const { value, result } = await call('opentu_get_task_result', { taskId, index: Number(index) });
      report({ ...value, previewBytes: result.content.filter(c => c.type === 'image').reduce((n, c) => n + Buffer.byteLength(c.data, 'base64'), 0) });
    }
  } else {
    const { value } = await call('opentu_list_tasks', { limit: 5 });
    report({ tasks: value.tasks.map(task => ({ id: task.id, type: task.type, status: task.status, requested: task.requested, insertedToCanvas: task.insertedToCanvas, createdAt: task.createdAt })) });
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { child.kill(); }
