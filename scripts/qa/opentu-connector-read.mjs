// Read-only acceptance against an installed OpenTu connector. Never prints media or credentials.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { isAbsolute } from 'node:path';

const [executable, runtime, mode] = process.argv.slice(2);
if (!executable || !runtime || !isAbsolute(executable) || !isAbsolute(runtime)) {
  throw new Error('Usage: node opentu-connector-read.mjs <absolute executable> <absolute runtime> [--watch]');
}
const child = spawn(executable, ['--opentu-mcp-stdio', runtime], {
  stdio: ['pipe', 'pipe', 'ignore'],
});
const pending = new Map();
let sequence = 0;
child.on('error', () => failPending('Connector could not start'));
child.on('exit', () => failPending('Connector exited'));
function failPending(message) {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(new Error(message));
  }
  pending.clear();
}
createInterface({ input: child.stdout }).on('line', (line) => {
  let value;
  try { value = JSON.parse(line); } catch { failPending('Invalid connector response'); return; }
  const waiter = pending.get(value.id);
  if (!waiter) return;
  clearTimeout(waiter.timer);
  pending.delete(value.id);
  if (value.error) waiter.reject(new Error(`RPC rejected (${value.error.code})`));
  else waiter.resolve(value.result);
});
function rpc(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Connector request timed out'));
    }, 20000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
async function call(name) {
  const result = await rpc('tools/call', { name, arguments: {} });
  if (result.isError) throw new Error(`Tool failed: ${name}`);
  return JSON.parse(result.content.find((item) => item.type === 'text').text);
}
async function probe() {
  const tools = await rpc('tools/list', {});
  const canvas = await call('opentu_get_canvas');
  const models = await call('opentu_list_models');
  if (!Array.isArray(canvas.elements) || !Array.isArray(models.models)) {
    throw new Error('Unexpected renderer response');
  }
  console.log(JSON.stringify({
    time: new Date().toISOString(),
    passed: true,
    toolCount: tools.tools.length,
    canvasElements: canvas.elements.length,
    modelCount: models.models.length,
    targetDesktopClientTested: false,
    paidGeneration: false,
  }));
}
try {
  await rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {},
    clientInfo: { name: 'OpenTu read-only connector acceptance', version: '1' },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await probe();
  if (mode === '--watch') {
    console.log('Ready: send probe after restarting the assistant, or quit. Connector process stays alive.');
    for await (const line of createInterface({ input: process.stdin })) {
      if (line.trim() === 'quit') break;
      if (line.trim() === 'probe') await probe();
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  child.kill();
}
