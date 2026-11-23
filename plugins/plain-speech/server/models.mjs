import { withAppServer } from './app-server.mjs';
import { speechError } from './errors.mjs';

export const defaultModel = Object.freeze({ provider: 'codex', model: 'gpt-6-luna', effort: 'medium' });
export const providerModels = Object.freeze({
  codex: [defaultModel.model],
  openai: ['gpt-6-luna', 'gpt-6-sol'],
  gemini: ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash'],
  deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
});
export const providers = Object.keys(providerModels);
export const modelPattern = '^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,119}$';
const modelId = new RegExp(modelPattern);
export const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const unavailable = () => speechError('modelCatalogUnavailable', '暂时读不到 Codex 的模型列表。');

export function normalizeModel(setting) {
  const { provider, model, effort } = setting ?? {};
  if (!providers.includes(provider) || typeof model !== 'string' || !modelId.test(model)) return;
  if (provider === 'codex' && !efforts.includes(effort)) return;
  return provider === 'codex' ? { provider, model, effort } : { provider, model };
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
