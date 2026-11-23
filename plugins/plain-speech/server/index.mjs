import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { listReplyPreviews, readReplySnapshot } from './latest-reply.mjs';
import { cacheKey, readTranslation, saveTranslation } from './cache.mjs';
import { maxLength, translate, translationVersion } from './translate.mjs';
import { decodeDiagram, generateView, viewActions, viewVersion } from './views.mjs';
import { speechError } from './errors.mjs';
import { apiConnection, petSizes, readAppearance, readModel, readModelSettings, updateAppearance, updateModel } from './appearance.mjs';
import { defaultModel, efforts, listModels, modelPattern, providers } from './models.mjs';
import { listApiModels } from './provider-api.mjs';

const name = 'plain-speech';
const displayName = 'Grandma Mode';
// Loaded Desktop chats may still use a worker from an earlier plugin release.
const uri = 'ui://plain-speech/current-v2.html';
const currentUris = new Set([uri, 'ui://plain-speech/current-v1.html', 'ui://plain-speech/current-v3.html']);
const latestUris = new Set(['ui://plain-speech/latest-v2.html', 'ui://plain-speech/latest-v3.html', 'ui://plain-speech/latest-v4.html']);
const legacyUri = 'ui://plain-speech/card-v1.html';
const linkUri = 'ui://plain-speech/linked-v3.html';
const linkedUris = new Set([linkUri, 'ui://plain-speech/linked-v1.html', 'ui://plain-speech/linked-v2.html', 'ui://plain-speech/linked-v4.html']);
const mimeType = 'text/html;profile=mcp-app';
const [template, style, script, pet, locale, views, settings, petFormat] = await Promise.all(
  ['index.html', 'style.css', 'app.js', 'pet.js', 'locale.js', 'views.js', 'settings.js', 'pet-format.js'].map((file) =>
    readFile(new URL(`../ui/${file}`, import.meta.url), 'utf8')),
);
const html = template
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>${style}</style>`)
  .replace('<script src="locale.js"></script>', () => `<script>${locale}</script>`)
  .replace('<script src="pet-format.js"></script>', () => `<script>${petFormat}</script>`)
  .replace('<script src="pet.js"></script>', () => `<script>${pet}</script>`)
  .replace('<script src="views.js"></script>', () => `<script>${views}</script>`)
  .replace('<script src="settings.js"></script>', () => `<script>${settings}</script>`)
  .replace('<script src="app.js"></script>', () => `<script>${script}</script>`);

const sourceField = { type: 'string', maxLength, description: '用户选择的原文。' };
const confirmedField = { type: 'boolean', const: true };
const threadField = { type: 'string', format: 'uuid' };
const replyId = { type: 'string', minLength: 1, maxLength: 320 };
const targetField = {
  type: 'object', required: ['turnId', 'messageId'], additionalProperties: false,
  properties: { turnId: replyId, messageId: replyId, hash: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
};
const selectionField = {
  type: 'object', required: ['start', 'end'], additionalProperties: false,
  properties: { start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 1 } },
};
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const resource = { uri, name: displayName, mimeType, _meta: { ui: { csp: {} } } };
const cardToolMeta = { ui: { resourceUri: uri, visibility: ['app'] }, 'openai/widgetAccessible': true };
const endpointFields = {
  baseURL: { type: 'string', maxLength: 512 },
  apiKey: { type: ['string', 'null'], maxLength: 512, writeOnly: true },
};
const tools = [
  {
    name: 'list_plain_speech_api_models', title: '读取接口的模型列表',
    description: '通过用户填写的接口地址和 API Key 读取可用模型。',
    inputSchema: {
      type: 'object', required: ['provider', 'baseURL'], additionalProperties: false,
      properties: { provider: { type: 'string', enum: providers.slice(1) }, ...endpointFields },
    },
    annotations, _meta: cardToolMeta,
  },
  {
    name: 'read_plain_speech_appearance', title: '读取本机外观',
    description: '从本机取回主题色、角色包和角色大小。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { ...annotations, openWorldHint: false }, _meta: cardToolMeta,
  },
  {
    name: 'update_plain_speech_appearance', title: '保存本机外观',
    description: '从卡片保存或恢复主题色、角色包和角色大小。',
    inputSchema: {
      type: 'object', required: ['setting'], additionalProperties: false,
      properties: {
        setting: { type: 'string', enum: ['accent', 'pet', 'petSize'] },
        accent: { type: ['string', 'null'], pattern: '^#[0-9a-fA-F]{6}$' },
        pet: { type: ['object', 'null'] },
        petSize: { type: 'string', enum: petSizes },
      },
    },
    annotations: { ...annotations, readOnlyHint: false, openWorldHint: false }, _meta: cardToolMeta,
  },
  {
    name: 'read_plain_speech_models', title: '读取翻译模型设置',
    description: '从本机读取供应商和模型设置，并列出 Codex 账号可选的模型。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations, _meta: cardToolMeta,
  },
  {
    name: 'update_plain_speech_model', title: '保存翻译模型设置',
    description: '从卡片保存供应商、模型和用户填写的 API Key。',
    inputSchema: {
      type: 'object', required: ['provider', 'model'], additionalProperties: false,
      properties: {
        provider: { type: 'string', enum: providers }, model: { type: 'string', pattern: modelPattern },
        effort: { type: 'string', enum: efforts },
        ...endpointFields,
      },
    },
    annotations: { ...annotations, readOnlyHint: false, openWorldHint: false }, _meta: cardToolMeta,
  },
  {
    name: 'plain_speech_view', title: '看图解或问小 Codex',
    description: '查找已保存的结果，或在用户点了按钮后生成图解和回答。',
    inputSchema: {
      type: 'object', required: ['action', 'generate'], additionalProperties: false,
      properties: {
        action: { type: 'string', enum: viewActions }, generate: { type: 'boolean' }, source: sourceField,
        threadId: threadField, target: targetField, selection: selectionField,
        firstAnswer: { type: 'string', maxLength, description: '同一条回复或选段的第一版大白话，仅用于继续简化。' },
      },
    },
    annotations, _meta: cardToolMeta,
  },
  {
    name: 'open_plain_speech', title: displayName,
    description: '打开大白话卡片。指向聊天的链接可以加载该聊天的最新回复。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { ...annotations, openWorldHint: false },
    _meta: {
      ui: { resourceUri: linkUri, visibility: ['app'] },
      'openai/outputTemplate': linkUri,
      'openai/ui': { entrypoints: [{ type: 'global' }] },
    },
  },
  {
    name: 'list_plain_speech_replies', title: '选择其他回复', description: '列出聊天里已写完的回复。',
    inputSchema: {
      type: 'object', properties: { threadId: threadField, cursor: { type: 'string', maxLength: 1024 } },
      additionalProperties: false,
    },
    annotations: { ...annotations, openWorldHint: false }, _meta: cardToolMeta,
  },
  {
    name: 'read_plain_speech_reply', title: '查看回复原文', description: '在卡片里查看指定回复或最近一条完整回复的原文。',
    inputSchema: {
      type: 'object', properties: { threadId: threadField, target: targetField }, additionalProperties: false,
    },
    annotations: { ...annotations, openWorldHint: false }, _meta: cardToolMeta,
  },
  {
    name: 'translate_plain_speech_reply', title: '翻这条回复或选中的文字',
    description: '改写已选择的回复或该回复中的一段文字。',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['target', 'confirmed'],
      properties: { threadId: threadField, target: targetField, selection: selectionField, confirmed: confirmedField },
    },
    annotations, _meta: cardToolMeta,
  },
  {
    name: 'open_plain_speech_in_chat', title: displayName,
    description: '打开当前 Codex 聊天的大白话卡片。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { ...annotations, openWorldHint: false },
    _meta: {
      ui: { resourceUri: uri, visibility: ['app'] },
      'openai/outputTemplate': uri,
      'openai/ui': { entrypoints: [{ type: 'thread' }] },
    },
  },
  {
    name: 'translate_latest_reply', title: '翻最新回复',
    description: '供卡片翻译当前 Codex 聊天里最近一条完整回复。',
    inputSchema: {
      type: 'object', properties: { confirmed: confirmedField },
      required: ['confirmed'], additionalProperties: false,
    },
    annotations,
    _meta: {
      ui: { resourceUri: uri, visibility: ['app'] },
      'openai/outputTemplate': uri,
      'openai/widgetAccessible': true,
    },
  },
  {
    name: 'translate_linked_reply', title: '翻译链接里的回复',
    description: '供大白话卡片翻译用户点开的本地聊天链接。',
    inputSchema: {
      type: 'object', properties: { threadId: { type: 'string', format: 'uuid' }, confirmed: confirmedField },
      required: ['threadId', 'confirmed'], additionalProperties: false,
    },
    annotations,
    _meta: { ui: { resourceUri: linkUri, visibility: ['app'] }, 'openai/widgetAccessible': true },
  },
  {
    name: 'translate_plain_speech', title: '改写成大白话',
    description: '由卡片在用户点击后调用，用 Codex 改写原文。',
    inputSchema: {
      type: 'object', properties: { source: sourceField, previousRewrite: { type: 'string', maxLength } },
      required: ['source'], additionalProperties: false,
    },
    annotations,
    _meta: { ui: { resourceUri: uri, visibility: ['app'] }, 'openai/widgetAccessible': true },
  },
];

const active = new Map();

function toolResult(text, structuredContent) {
  return { content: [{ type: 'text', text }], structuredContent };
}

function validTarget(target) {
  return target && [target.turnId, target.messageId].every((id) => typeof id === 'string' && id.length > 0 && id.length <= 320)
    && (target.hash === undefined || (typeof target.hash === 'string' && /^[a-f0-9]{64}$/.test(target.hash)));
}

function selectSource(reply, selection) {
  if (selection === undefined) return reply.source;
  const { start, end } = selection ?? {};
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > reply.source.length) {
    throw speechError('invalidSource', '请重新选中要翻的文字。');
  }
  return reply.source.slice(start, end);
}

async function callTool(params, id) {
  if (params.name === 'list_plain_speech_api_models') {
    try {
      const connection = await apiConnection(params.arguments ?? {});
      if (!connection) throw speechError('apiEndpointInvalid', '请检查接口地址和 API Key 的格式。');
      return { ...toolResult('已读取模型列表。'), _meta: { catalog: await listApiModels(connection) } };
    } catch (error) {
      const message = error?.speechCode ? error.message : '读不到模型列表。请检查接口地址和 Key。';
      return toolResult(message, { code: error?.speechCode ?? 'apiCatalogUnavailable', error: message });
    }
  }
  if (params.name === 'read_plain_speech_models' || params.name === 'update_plain_speech_model') {
    const failure = toolResult('无法读取或保存模型设置。', { code: 'modelSettingError', error: '无法读取或保存模型设置。' });
    try {
      if (params.name === 'update_plain_speech_model') {
        if (await updateModel(params.arguments ?? {})) return failure;
        return { ...toolResult('已保存模型设置。', { saved: true }), _meta: await readModelSettings() };
      }
      const settings = await readModelSettings();
      const catalog = await listModels().catch(() => null);
      return {
        ...toolResult('已读取模型设置。'),
        _meta: { ...settings, defaultModel, catalog },
      };
    } catch {
      return failure;
    }
  }
  if (params.name === 'read_plain_speech_appearance' || params.name === 'update_plain_speech_appearance') {
    try {
      if (params.name === 'read_plain_speech_appearance') {
        return { ...toolResult('已读取本机外观。'), _meta: await readAppearance() };
      }
      const code = await updateAppearance(params.arguments ?? {});
      if (code) return toolResult('无法保存外观。', { error: '无法保存外观。', code });
      return toolResult('已保存本机外观。', { saved: true });
    } catch {
      return toolResult('无法读取或保存外观。', { error: '无法读取或保存外观。', code: 'appearanceError' });
    }
  }
  if (params.name === 'open_plain_speech' || params.name === 'open_plain_speech_in_chat') {
    return toolResult('大白话已打开。', { ready: true });
  }
  const args = params.arguments ?? {};
  const read = params.name === 'read_plain_speech_reply';
  const list = params.name === 'list_plain_speech_replies';
  const selected = params.name === 'translate_plain_speech_reply';
  const linked = params.name === 'translate_linked_reply';
  const fromChat = selected || linked || params.name === 'translate_latest_reply';
  const extra = params.name === 'plain_speech_view';
  if (!read && !list && !fromChat && !extra && params.name !== 'translate_plain_speech') {
    return { ...toolResult('找不到这个工具。'), isError: true };
  }
  if (fromChat && args.confirmed !== true) {
    return { ...toolResult('请点击「翻最新回复」后开始翻译。'), isError: true };
  }
  const previousRewrite = !read && !list && !fromChat ? args.previousRewrite : undefined;
  if (previousRewrite !== undefined && (typeof previousRewrite !== 'string' || previousRewrite.length > maxLength)) {
    return toolResult('上一版译文无法用于重试。', { code: 'retry', error: '上一版译文无法用于重试。' });
  }
  const controller = new AbortController();
  active.set(id, controller);
  try {
    const route = read || list ? undefined : await readModel();
    const threadId = linked || read || list || selected || extra ? args.threadId ?? params._meta?.threadId : params._meta?.threadId;
    if (list) {
      const page = await listReplyPreviews(threadId, controller.signal, args.cursor);
      return { ...toolResult('已读取回复列表。'), _meta: page };
    }
    const target = read || selected || extra ? args.target : undefined;
    if (((selected || target !== undefined) && !validTarget(target))
        || ((selected || extra) && args.selection !== undefined && !target?.hash)) {
      throw speechError('replyChanged', '请重新打开原文。');
    }
    const reply = read || fromChat || (extra && (target || args.source === undefined))
      ? await readReplySnapshot(threadId, controller.signal, target) : undefined;
    if (read) return { ...toolResult('已读取原文。'), _meta: reply };
    const selection = selected || extra ? args.selection : undefined;
    const source = reply ? selectSource(reply, selection) : args.source;
    if (typeof source !== 'string' || !source.trim()) throw speechError('invalidSource', '请先选中或输入要翻的文字。');
    if (source.length > maxLength) {
      throw speechError('tooLong', '这条回复太长，可以选中一部分来翻。');
    }
    if (extra && !viewActions.includes(args.action)) throw speechError('retry', '请选择一个功能。');
    const range = selection && [selection.start, selection.end];
    const replyKey = reply && cacheKey(threadId, reply.target, range, source, translationVersion(route));
    let firstAnswer;
    if (extra && args.action === 'simpler') {
      firstAnswer = args.firstAnswer ?? (replyKey ? await readTranslation(replyKey) : undefined);
      if (typeof firstAnswer !== 'string' || !firstAnswer.trim() || firstAnswer.length > maxLength) {
        if (args.generate !== true) return toolResult('还没有保存的结果。', { cached: false });
        throw speechError('simplerNeedsAnswer', '先看「一句话说清」，小 Codex 才能接着讲。');
      }
    }
    const key = extra ? cacheKey(reply ? threadId : null, reply?.target, range, source, viewVersion(args.action, firstAnswer, route))
      : replyKey;
    let cached = key ? await readTranslation(key) : undefined;
    controller.signal.throwIfAborted();
    if (args.action === 'diagram' && extra && cached && !decodeDiagram(cached)) cached = undefined;
    if (extra && args.generate !== true && !cached) return toolResult('还没有保存的结果。', { cached: false });
    const translation = cached ?? await (extra ? generateView(args.action, source, controller.signal, firstAnswer, route)
      : translate(source, controller.signal, previousRewrite, undefined, route));
    controller.signal.throwIfAborted();
    const fallback = extra && args.action === 'simpler' && translation === firstAnswer;
    if (key && !cached && !fallback) await saveTranslation(key, translation);
    const result = extra ? toolResult('已读取结果。', args.action === 'diagram'
      ? { diagram: decodeDiagram(translation), cached: Boolean(cached) }
      : { translation, cached: Boolean(cached), ...(fallback ? { fallback } : {}) })
      : toolResult('大白话已生成。', { translation });
    return reply ? { ...result, _meta: { ...reply, cached: Boolean(cached) } } : result;
  } catch (error) {
    const failure = controller.signal.aborted ? speechError('cancelled', '这次翻译停下了。可以再翻一次。')
      : error?.speechCode ? error : speechError('retry', 'Codex 这次没能交稿。可以重试。');
    return toolResult(failure.message, { code: failure.speechCode, error: failure.message });
  } finally {
    active.delete(id);
  }
}

async function receive({ id, method, params = {} }) {
  if (method === 'notifications/cancelled') {
    active.get(params.requestId)?.abort();
    return;
  }
  if (id === undefined) return;

  let result;
  switch (method) {
    case 'initialize':
      result = {
        protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'].includes(params.protocolVersion)
          ? params.protocolVersion : '2025-11-25',
        serverInfo: { name, version: '0.6.5' },
        capabilities: { tools: {}, resources: {} },
      };
      break;
    case 'ping': result = {}; break;
    case 'tools/list': result = { tools }; break;
    case 'tools/call': result = await callTool(params, id); break;
    case 'resources/list': result = { resources: [resource, { ...resource, uri: linkUri }] }; break;
    case 'resources/templates/list': result = { resourceTemplates: [] }; break;
    case 'resources/read': {
      const mode = currentUris.has(params.uri) ? 'current'
        : linkedUris.has(params.uri) ? 'linked' : latestUris.has(params.uri) ? 'latest' : null;
      if (!mode && params.uri !== legacyUri) {
        return send({ id, error: { code: -32002, message: 'Resource not found' } });
      }
      result = { contents: [{ ...resource, uri: params.uri, text: mode
        ? html.replace('<body>', `<body data-mode="${mode}">`) : html }] };
      break;
    }
    default: return send({ id, error: { code: -32601, message: 'Method not found' } });
  }
  send({ id, result });
}

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}

const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  let request;
  try { request = JSON.parse(line); } catch {
    send({ id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (!request || typeof request.method !== 'string') {
    send({ id: request?.id ?? null, error: { code: -32600, message: 'Invalid request' } });
    return;
  }
  receive(request).catch(() => {
    if (request.id !== undefined) send({ id: request.id, error: { code: -32603, message: 'Internal error' } });
  });
});
input.on('close', () => {
  for (const controller of active.values()) controller.abort();
});
