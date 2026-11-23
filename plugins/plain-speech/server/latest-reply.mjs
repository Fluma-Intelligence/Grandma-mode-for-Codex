import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { speechError } from './errors.mjs';
import { codexProcessEnv } from './codex-env.mjs';

const threadIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const unavailable = () => speechError('historyUnavailable', '暂时读不到这条聊天的回复。');
const noReply = () => speechError('noReply', '还没找到一条写完的回复。');
const changed = () => speechError('replyChanged', '这条回复变了。请重新打开原文。');

export function hashText(text) {
  return createHash('sha256').update(text).digest('hex');
}

function isReply(item) {
  return item.type === 'agentMessage' && (item.phase === 'final_answer' || item.phase == null)
    && typeof item.text === 'string' && item.text.trim();
}

function finalReply(turn) {
  if (turn.status !== 'completed') return undefined;
  const replies = turn.items?.filter(isReply) ?? [];
  return replies.findLast(({ phase }) => phase === 'final_answer') ?? replies.at(-1);
}

function snapshot(turnId, item) {
  const source = item.text.replace(/\r\n?/g, '\n');
  return { source, target: { turnId, messageId: item.id, hash: hashText(source) } };
}

async function withReader(threadId, signal, read) {
  if (typeof threadId !== 'string' || !threadIdPattern.test(threadId)) {
    throw speechError('openFromChat', '请从 Codex 聊天里打开大白话。');
  }
  const child = spawn(process.env.PLAIN_SPEECH_CODEX || 'codex', ['app-server', '--stdio', '--disable', 'apps', '--disable', 'hooks'], {
    env: codexProcessEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], signal,
  });
  const lines = createInterface({ input: child.stdout });
  const replies = lines[Symbol.asyncIterator]();
  const stop = () => { lines.close(); child.kill(); };
  const timeout = setTimeout(stop, 8000);
  child.once('error', stop);
  child.stdin.on('error', stop);
  let nextId = 0;

  function send(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async function request(method, params) {
    const id = ++nextId;
    send({ id, method, params });
    for (;;) {
      const { value, done } = await replies.next();
      if (done) throw unavailable();
      let message;
      try { message = JSON.parse(value); } catch { continue; }
      if (message.id === id) return message.result;
    }
  }

  try {
    if (!await request('initialize', {
      clientInfo: { name: 'plain-speech', version: '0.6.2' }, capabilities: { experimentalApi: true },
    })) throw unavailable();
    send({ method: 'initialized' });
    return await read(request);
  } finally {
    clearTimeout(timeout);
    stop();
  }
}

function turns(request, threadId, cursor, limit, itemsView = 'summary') {
  return request('thread/turns/list', { threadId, sortDirection: 'desc', limit, itemsView, cursor });
}

async function readLegacyReply(request, threadId, turnId, messageId) {
  let cursor;
  do {
    const page = await turns(request, threadId, cursor, 8, 'full');
    const turn = page?.data?.find(({ id }) => id === turnId);
    if (turn) {
      const item = finalReply(turn);
      if (item?.id === messageId) return snapshot(turnId, item);
      break;
    }
    if (!page || cursor === page.nextCursor) break;
    cursor = page.nextCursor;
  } while (cursor);
  throw changed();
}

async function exactReply(request, threadId, { turnId, messageId }) {
  let cursor;
  do {
    const page = await request('thread/items/list', { threadId, turnId, sortDirection: 'desc', limit: 32, cursor });
    if (!Array.isArray(page?.data)) {
      return readLegacyReply(request, threadId, turnId, messageId);
    }
    const item = page.data.find(({ item }) => item?.id === messageId)?.item;
    if (item && isReply(item)) return snapshot(turnId, item);
    if (cursor === page.nextCursor) break;
    cursor = page.nextCursor;
  } while (cursor);
  throw changed();
}

export function readReplySnapshot(threadId, signal, target) {
  return withReader(threadId, signal, async (request) => {
    if (target) {
      const reply = await exactReply(request, threadId, target);
      if (target.hash && target.hash !== reply.target.hash) throw changed();
      return reply;
    }
    let cursor;
    do {
      const page = await turns(request, threadId, cursor, 8);
      if (!Array.isArray(page?.data)) throw unavailable();
      for (const turn of page.data) {
        const item = finalReply(turn);
        if (item) return exactReply(request, threadId, { turnId: turn.id, messageId: item.id });
      }
      if (cursor === page.nextCursor) break;
      cursor = page.nextCursor;
    } while (cursor);
    throw noReply();
  });
}

export async function readLatestReply(threadId, signal) {
  return (await readReplySnapshot(threadId, signal)).source;
}

export function listReplyPreviews(threadId, signal, cursor) {
  return withReader(threadId, signal, async (request) => {
    const page = await turns(request, threadId, cursor, 6);
    if (!Array.isArray(page?.data)) throw unavailable();
    const replies = [];
    for (const turn of page.data) {
      const item = finalReply(turn);
      if (!item) continue;
      const text = item.text.replace(/\s+/g, ' ').trim();
      const preview = [...text.slice(0, 282)].slice(0, 140).join('');
      replies.push({
        target: { turnId: turn.id, messageId: item.id },
        preview: preview + (preview.length < text.length ? '…' : ''),
      });
    }
    return { replies, nextCursor: page.nextCursor ?? null };
  });
}
