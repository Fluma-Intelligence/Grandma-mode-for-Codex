import { withAppServer } from './app-server.mjs';
import { speechError } from './errors.mjs';

export const defaultModel = Object.freeze({ provider: 'codex', model: 'gpt-6-luna', effort: 'medium' });
export const providers = ['codex', 'compatible', 'openai', 'gemini'];
export const modelPattern = '^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$';
const modelId = new RegExp(modelPattern);
export const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const unavailable = () => speechError('modelCatalogUnavailable', '暂时读不到 Codex 的模型列表。');

const operation = { compatible: /\/chat\/completions$/, openai: /\/responses$/, gemini: /\/models\/[^/]+:generateContent$/ };

export function normalizeEndpoint(provider, baseURL) {
  if (!Object.hasOwn(operation, provider) || typeof baseURL !== 'string' || baseURL.length > 512) return;
  let url;
  try { url = new URL(baseURL.trim()); } catch { return; }
  if (url.username || url.password || url.search || url.hash) return;
  if (url.protocol !== 'https:' && !localEndpoint(url)) return;
  const path = url.pathname.replace(/\/+$/, '').replace(operation[provider], '').replace(/\/models$/, '');
  return url.origin + path;
}

export function localEndpoint(url) {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

export function normalizeModel(setting) {
  const { provider, model, effort, baseURL } = setting ?? {};
  if (!providers.includes(provider) || typeof model !== 'string' || !modelId.test(model)) return;
  if (provider === 'codex' && !efforts.includes(effort)) return;
  if (provider === 'codex') return { provider, model, effort };
  const endpoint = normalizeEndpoint(provider, baseURL);
  if (endpoint) return { provider, model, baseURL: endpoint };
}

export function isModelId(model) {
  return typeof model === 'string' && modelId.test(model);
}

export function listModels(signal) {
  return withAppServer(signal, unavailable, async (request) => {
    const models = new Map();
    const cursors = new Set();
    let cursor;
    do {
      const page = await request('model/list', { limit: 50, includeHidden: false, modelProvider: 'openai', cursor });
      if (!Array.isArray(page?.data)) throw unavailable();
      for (const item of page.data) {
        if (!item || item.hidden || (Array.isArray(item.inputModalities) && !item.inputModalities.includes('text'))) continue;
        const supported = Array.isArray(item.supportedReasoningEfforts)
          ? item.supportedReasoningEfforts.map((option) => option?.reasoningEffort) : [];
        const effort = supported.includes(defaultModel.effort) ? defaultModel.effort : item.defaultReasoningEffort;
        const choice = normalizeModel({ provider: 'codex', model: item.model, effort });
        if (choice) {
          const name = typeof item.displayName === 'string' && item.displayName.trim().slice(0, 120);
          models.set(choice.model, { ...choice, name: name || choice.model });
        }
      }
      cursor = page.nextCursor;
      if (cursors.has(cursor)) break;
      cursors.add(cursor);
    } while (cursor);
    return [...models.values()];
  });
}
