import { speechError } from './errors.mjs';

const retry = () => speechError('retry', '这次没有翻好，可以再试一次。');

const adapters = {
  openai: {
    url: () => 'https://api.openai.com/v1/responses',
    body: (model, instruction, source) => ({
      model, instructions: instruction, input: source, store: false, max_output_tokens: 4096,
    }),
    answer: (response) => response.status && response.status !== 'completed' ? undefined
      : response.output?.filter(({ type }) => type === 'message')
      .flatMap(({ content }) => content ?? []).filter(({ type }) => type === 'output_text')
      .map(({ text }) => text).join('\n'),
  },
  gemini: {
    url: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`,
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
  deepseek: {
    url: () => 'https://api.deepseek.com/chat/completions',
    body: (model, instruction, source) => ({
      model, messages: [{ role: 'system', content: instruction }, { role: 'user', content: source }],
      max_tokens: 1024, thinking: { type: 'disabled' },
    }),
    answer: ({ choices }) => {
      const choice = choices?.[0];
      if (choice?.finish_reason && choice.finish_reason !== 'stop') return;
      return choice?.message?.content;
    },
  },
};

function apiFailure(status, error) {
  const details = JSON.stringify(error ?? '').slice(0, 4096);
  if (status === 429 || status === 402 || /insufficient_quota/i.test(details)) {
    return speechError('providerLimit', '供应商的额度或余额不足，或请求太频繁。');
  }
  if (status === 404 || /model_not_found|model.{0,100}(?:not found|does not exist|not supported|not available)/i.test(details)) {
    return speechError('modelUnavailable', '当前账号无法使用所选模型。请到设置里换一个模型。');
  }
  if (status === 401 || status === 403 || /api[_ ]key.{0,60}invalid/i.test(details)) {
    return speechError('providerAuth', '供应商没有接受这个 API Key。请到设置里检查。');
  }
  return retry();
}

export async function runApiPrompt(prompt, { provider, model, apiKey }, signal) {
  if (!apiKey) throw speechError('providerKeyRequired', '请先到设置里给供应商填写 API Key。');
  const adapter = adapters[provider];
  const split = prompt.lastIndexOf('\n\n');
  const instruction = split < 0 ? '' : prompt.slice(0, split);
  const source = split < 0 ? prompt : prompt.slice(split + 2);
  const authorization = provider === 'gemini' ? { 'x-goog-api-key': apiKey } : { Authorization: `Bearer ${apiKey}` };
  const timeout = AbortSignal.timeout(90_000);
  try {
    const response = await fetch(adapter.url(model), {
      method: 'POST', redirect: 'error',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(adapter.body(model, instruction, source)),
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
