import { speechError } from './errors.mjs';
import { isModelId, localEndpoint } from './models.mjs';

const retry = () => speechError('retry', '这次没有翻好，可以再试一次。');

const adapters = {
  openai: {
    path: () => '/responses',
    body: (model, instruction, source) => ({
      model, instructions: instruction, input: source, store: false, max_output_tokens: 4096,
    }),
    answer: (response) => response.status && response.status !== 'completed' ? undefined
      : response.output?.filter(({ type }) => type === 'message')
      .flatMap(({ content }) => content ?? []).filter(({ type }) => type === 'output_text')
      .map(({ text }) => text).join('\n'),
  },
  gemini: {
    path: (model) => `/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`,
    body: (_model, instruction, source) => ({
      systemInstruction: { parts: [{ text: instruction }] },
      contents: [{ role: 'user', parts: [{ text: source }] }],
      generationConfig: { maxOutputTokens: 4096 },
    }),
    answer: ({ candidates }) => {
      const candidate = candidates?.[0];
      if (candidate?.finishReason && candidate.finishReason !== 'STOP') return;
      return candidate?.content?.parts?.filter(({ thought }) => !thought).map(({ text }) => text).join('\n');
    },
  },
  compatible: {
    path: () => '/chat/completions',
    body: (model, instruction, source, baseURL) => ({
      model, messages: [{ role: 'system', content: instruction }, { role: 'user', content: source }],
      max_tokens: 1024,
      ...(new URL(baseURL).hostname === 'api.deepseek.com' ? { thinking: { type: 'disabled' } } : {}),
    }),
    answer: ({ choices }) => {
      const choice = choices?.[0];
      if (choice?.finish_reason && choice.finish_reason !== 'stop') return;
      return choice?.message?.content;
    },
  },
};

function apiFailure(status, error, listing) {
  const details = JSON.stringify(error ?? '').slice(0, 4096);
  if (status === 429 || status === 402 || /insufficient_quota/i.test(details)) {
    return speechError('providerLimit', '供应商的额度或余额不足，或请求太频繁。');
  }
  if (!listing && (status === 404 || /model_not_found|model.{0,100}(?:not found|does not exist|not supported|not available)/i.test(details))) {
    return speechError('modelUnavailable', '当前账号无法使用所选模型。请到设置里换一个模型。');
  }
  if (status === 401 || status === 403 || /api[_ ]key.{0,60}invalid/i.test(details)) {
    return speechError('providerAuth', '供应商没有接受这个 API Key。请到设置里检查。');
  }
  return listing ? catalogUnavailable() : retry();
}

const catalogUnavailable = () => speechError('apiCatalogUnavailable', '读不到模型列表。请检查接口地址和 Key。');

function authHeaders({ provider, baseURL, apiKey }) {
  if (!apiKey) {
    if (localEndpoint(new URL(baseURL))) return {};
    throw speechError('providerKeyRequired', '请先填写这个接口的 API Key。');
  }
  return provider === 'gemini' ? { 'x-goog-api-key': apiKey } : { Authorization: `Bearer ${apiKey}` };
}

export async function listApiModels(connection) {
  const { provider, baseURL, apiKey } = connection;
  const headers = authHeaders(connection);
  const signal = AbortSignal.timeout(10_000);
  const models = new Map();
  const cursors = new Set();
  let cursor;
  try {
    do {
      const url = new URL(baseURL + '/models');
      if (provider === 'gemini') {
        url.searchParams.set('pageSize', '100');
        if (cursor) url.searchParams.set('pageToken', cursor);
      }
      const response = await fetch(url.href, { headers, redirect: 'error', signal });
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) throw apiFailure(response.status, payload?.error, true);
      const items = provider === 'gemini' ? payload?.models : payload?.data;
      if (!Array.isArray(items)) throw catalogUnavailable();
      for (const item of items) {
        if (provider === 'gemini' && !item?.supportedGenerationMethods?.includes('generateContent')) continue;
        if (Array.isArray(item?.output_modalities) && !item.output_modalities.includes('text')) continue;
        const model = provider === 'gemini' ? item.name?.replace(/^models\//, '') : item?.id;
        if (!isModelId(model) || (apiKey && model.includes(apiKey))) continue;
        const label = provider === 'gemini' ? item.displayName : item.name;
        const name = typeof label === 'string' && !(apiKey && label.includes(apiKey)) ? label.trim().slice(0, 160) : model;
        models.set(model, { model, name: name || model });
      }
      cursor = provider === 'gemini' ? payload.nextPageToken : undefined;
      if (cursors.has(cursor)) break;
      cursors.add(cursor);
    } while (cursor);
    return [...models.values()];
  } catch (error) {
    throw error?.speechCode ? error : catalogUnavailable();
  }
}

export async function runApiPrompt(prompt, connection, signal) {
  const { provider, model, baseURL } = connection;
  const authorization = authHeaders(connection);
  const adapter = adapters[provider];
  const split = prompt.lastIndexOf('\n\n');
  const instruction = split < 0 ? '' : prompt.slice(0, split);
  const source = split < 0 ? prompt : prompt.slice(split + 2);
  const timeout = AbortSignal.timeout(90_000);
  try {
    const response = await fetch(baseURL + adapter.path(model), {
      method: 'POST', redirect: 'error',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(adapter.body(model, instruction, source, baseURL)),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) throw apiFailure(response.status, payload?.error);
    const answer = payload && adapter.answer(payload);
    if (typeof answer !== 'string' || !answer.trim()) throw retry();
    return answer.trim();
  } catch (error) {
    signal?.throwIfAborted();
    if (timeout.aborted) throw speechError('modelTimeout', '这次改写超过 90 秒了。可以重试，或分段来翻。');
    throw error?.speechCode ? error : retry();
  }
}
