import { createInterface } from 'node:readline';
import { cliMissing, spawnCodex } from './codex-cli.mjs';

export async function withAppServer(signal, unavailable, read) {
  const child = spawnCodex(['app-server', '--stdio', '--disable', 'apps', '--disable', 'hooks'], {
    stdio: ['pipe', 'pipe', 'ignore'], signal,
  });
  const lines = createInterface({ input: child.stdout });
  const replies = lines[Symbol.asyncIterator]();
  const stop = () => { lines.close(); child.kill(); };
  const timeout = setTimeout(stop, 8000);
  let spawnError;
  child.once('error', (error) => { spawnError = error; stop(); });
  child.stdin.on('error', stop);
  let nextId = 0;

  function send(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async function request(method, params, onError) {
    const id = ++nextId;
    send({ id, method, params });
    for (;;) {
      const { value, done } = await replies.next();
      if (done) throw spawnError?.code === 'ENOENT' ? cliMissing() : unavailable();
      let message;
      try { message = JSON.parse(value); } catch { continue; }
      if (message.id === id) return message.error ? onError?.(message.error) : message.result;
    }
  }

  try {
    if (!await request('initialize', {
      clientInfo: { name: 'plain-speech', version: '0.6.7' }, capabilities: { experimentalApi: true },
    })) throw unavailable();
    send({ method: 'initialized' });
    return await read(request);
  } finally {
    clearTimeout(timeout);
    stop();
  }
}
