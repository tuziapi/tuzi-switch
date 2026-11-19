// Exercise the final signed/extracted runtime; --version does not start V8.
// Only loopback networking, synthetic content, and built-in modules are used.
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHash } = require('node:crypto');

(async () => {
  assert.equal(typeof fetch, 'function');
  assert.equal(typeof WebSocket, 'function');
  const calculate = new Function('value', 'return value * 2 + 1');
  for (let value = 0; value < 20000; value++) {
    assert.equal(calculate(value), value * 2 + 1);
  }
  const sockets = new Set();
  const server = http.createServer((_request, response) => response.end('synthetic-runtime-ok'));
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (request, socket) => {
    const accept = createHash('sha1')
      .update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.on('data', () => socket.end(Buffer.from([0x88, 0])));
  });
  const timeout = setTimeout(() => {
    console.error('Packaged Node runtime probe timed out');
    process.exit(1);
  }, 8000);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'synthetic-runtime-ok');
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
      socket.addEventListener('error', reject, { once: true });
      socket.addEventListener('open', () => { socket.close(); resolve(); }, { once: true });
    });
    console.log(JSON.stringify({ version: process.version, script: true, fetch: true, websocket: true }));
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close();
    clearTimeout(timeout);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
