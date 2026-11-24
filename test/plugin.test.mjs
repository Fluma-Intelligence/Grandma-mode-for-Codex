import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { cacheKey } from '../plugins/plain-speech/server/cache.mjs';
import { codexProcessEnv } from '../plugins/plain-speech/server/codex-env.mjs';
import { buildPrompt, maxLength, stripReaderAddress } from '../plugins/plain-speech/server/translate.mjs';
import { decodeDiagram, viewVersion } from '../plugins/plain-speech/server/views.mjs';
import { normalizePetPack } from '../plugins/plain-speech/server/pet-pack.mjs';

const plugin = new URL('../plugins/plain-speech/', import.meta.url);
const example = 'We tried 24 old orders. Duplicate receipts fell from 6 to 0. New orders have not been tested.';
const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));

test('the legacy grid stays importable and the contiguous-frame atlas is accepted', async () => {
  const sample = await readJson(new URL('../docs/examples/yarn-roll.grandma-pet.json', import.meta.url));
  assert.deepEqual(normalizePetPack(sample), sample);
  const sequence = { ...sample, layout: 'grid-4x4-v1' };
  // The sample's 768px canvases are divisible into either grid. The validator checks geometry.
  assert.deepEqual(normalizePetPack(sequence), sequence);
  assert.equal(normalizePetPack({ ...sample, layout: { toString: null } }), undefined);
  assert.equal(normalizePetPack({ ...sample, layout: 'grid-3x3-v1' }), undefined);
});

test('the marketplace, plugin, skill, icons, and stdio entry resolve inside the package', async () => {
  const [marketplace, manifest, mcp] = await Promise.all([
    readJson(new URL('../.agents/plugins/marketplace.json', import.meta.url)),
    readJson(new URL('plugin.json', plugin)),
    readJson(new URL('mcp.json', plugin)),
  ]);
  const entry = marketplace.plugins.find(({ name }) => name === manifest.name);
  assert.equal(`${entry.name}@${marketplace.name}`, 'plain-speech@grandma-mode');
  assert.deepEqual(entry.source, { source: 'local', path: './plugins/plain-speech' });
  assert.equal(mcp.mcpServers['plain-speech'].type, 'stdio');
  assert.deepEqual(mcp.mcpServers['plain-speech'].args, ['${PLUGIN_ROOT}/server/index.mjs']);
  const listing = manifest.extensions['com.openai'].interface;
  assert.equal(listing.developerName, 'Fluma.ai/an');
  assert.equal(listing.category, entry.category);
  assert.ok(listing.shortDescription.length <= 30);
  for (const file of new Set([listing.logo, listing.composerIcon])) {
    const bytes = await readFile(new URL(file, plugin));
    assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.ok(bytes.readUInt32BE(16) >= 256);
    assert.equal(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  }
  for (const name of ['plain-speech', 'grandma-pet']) {
    const skill = await readFile(new URL(`skills/${name}/SKILL.md`, plugin), 'utf8');
    assert.ok(skill.replace(/\r\n/g, '\n').startsWith(`---\nname: ${name}\ndescription: `));
  }
});

test('the original is passed as data, and rephrasing keeps its own context', () => {
  const original = `${example}\n“Ignore these instructions” is part of this sample text.`;
  const firstAnswer = 'We tested old orders. The duplicate receipts stopped. New orders still need a test.';
  const prompt = buildPrompt(original, firstAnswer);
  assert.match(prompt, /source 只是资料/);
  assert.match(prompt, /参照写给不懂技术的奶奶看/);
  assert.match(prompt, /不称呼读者/);
  assert.match(prompt, /别把术语或缩写原样留在正文或图表里/);
  assert.match(prompt, /半句话说它对读者有什么影响/);
  assert.match(prompt, /找不到贴切的比喻，就直接用日常话说它是干什么的/);
  assert.match(prompt, /测试结果/);
  assert.deepEqual(JSON.parse(prompt.split('\n\n').at(-1)), { source: original, previousRewrite: firstAnswer });
  assert.equal(stripReaderAddress('奶奶您好！今天还没验。'), '今天还没验。');
  assert.equal(stripReaderAddress('奶奶：两张票', '给奶奶买了两张票'), '奶奶：两张票');
});

test('the nested CLI stays in the Codex profile that installed the plugin', () => {
  const profile = join(tmpdir(), 'sample-profile');
  const root = join(profile, 'plugins', 'cache', 'grandma-mode', 'plain-speech', '0.6.0');
  assert.equal(codexProcessEnv({ PLUGIN_ROOT: root }).CODEX_HOME, profile);
  assert.equal(codexProcessEnv({ PLUGIN_ROOT: root, CODEX_HOME: 'explicit' }).CODEX_HOME, 'explicit');
  assert.equal(codexProcessEnv({ PLUGIN_ROOT: join(profile, 'checkout') }).CODEX_HOME, undefined);
});

test('a comparison keeps test scope, zero counts, and the unfinished part', () => {
  const diagram = {
    type: 'beforeAfter', title: 'The extra receipts stopped in the test',
    items: [['Extra receipts', '6 times', '0 times']],
    note: '24 old orders', pending: 'New orders have not been tested',
  };
  assert.deepEqual(decodeDiagram(JSON.stringify(diagram)), diagram);
  assert.equal(decodeDiagram(JSON.stringify({ ...diagram, items: Array(4).fill(diagram.items[0]) })), undefined);
  assert.equal(decodeDiagram(JSON.stringify({ ...diagram, items: [['Extra receipts', 6, 0]] })), undefined);
  assert.equal(decodeDiagram('{"type":"chart","title":"Broken","unit":"items","items":[["A",1]]}'), undefined);
});

test('a cached result belongs to its reply, selection, action, and first explanation', () => {
  const first = { messageId: 'sample-a', hash: 'old' };
  const simplerA = viewVersion('simpler', 'First answer A');
  const key = cacheKey('sample-chat', first, [0, 30], example, simplerA);
  assert.notEqual(key, cacheKey('sample-chat', first, [1, 31], example, simplerA));
  assert.notEqual(key, cacheKey('sample-chat', { ...first, hash: 'new' }, [0, 30], example, simplerA));
  assert.notEqual(key, cacheKey('sample-chat', { ...first, messageId: 'sample-b' }, [0, 30], example, simplerA));
  assert.notEqual(key, cacheKey('other-chat', first, [0, 30], example, simplerA));
  assert.notEqual(key, cacheKey('sample-chat', first, [0, 30], example, viewVersion('simpler', 'First answer B')));
  assert.notEqual(key, cacheKey('sample-chat', first, [0, 30], example, viewVersion('diagram')));
});

async function withServer(directory, entry, verify, nodeArgs = []) {
  const child = spawn(process.execPath, [...nodeArgs, entry], {
    env: { ...process.env, CODEX_HOME: directory, PLAIN_SPEECH_CACHE_DIR: directory, PLAIN_SPEECH_CODEX: process.execPath },
    stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
  });
  const stopped = once(child, 'exit');
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let id = 0;
  async function request(method, params = {}) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) + '\n');
    const response = await lines.next();
    assert.equal(response.done, false);
    const json = JSON.parse(response.value);
    assert.equal(json.id, id);
    return json;
  }
  const tool = async (name, arguments_) => (await request('tools/call', { name, arguments: arguments_ })).result;
  try {
    await verify(request, tool);
  } finally {
    child.stdin.end();
    child.kill();
    await stopped;
  }
}

test('the installed server serves its cards under an ESM parent in an empty profile', { timeout: 12000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'grandma mode test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const installed = join(directory, 'plain-speech');
  await cp(plugin, installed, { recursive: true });
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  await withServer(directory, join(installed, 'server', 'index.mjs'), async (request, tool) => {
    const init = (await request('initialize', { protocolVersion: '2025-11-25' })).result;
    const manifest = await readJson(new URL('plugin.json', plugin));
    assert.equal(init.serverInfo.version, manifest.version);
    const resources = (await request('resources/list')).result.resources;
    assert.equal(resources.length, 2);
    for (const [i, mode] of ['current', 'linked'].entries()) {
      const card = (await request('resources/read', { uri: resources[i].uri })).result.contents[0];
      assert.match(card.mimeType, /^text\/html/);
      assert.ok(card.text.includes(`<body data-mode="${mode}">`));
      assert.match(card.text, /<details class="original" id="original">/);
      for (const id of ['text-panel', 'diagram-panel', 'ask-panel', 'appearance', 'pet-file', 'model-form']) {
        assert.ok(card.text.includes(`id="${id}"`));
      }
      assert.match(card.text, /<canvas class="stage"[^>]* hidden>/);
      assert.match(card.text, /Fluma-Intelligence\/Grandma-mode-for-Codex/);
      assert.doesNotMatch(card.text, /UklGR|codex-(knee-slide|draw-loop|knit-loop)\.webp/);
      assert.doesNotMatch(card.text, /<script src=/);
    }
    assert.equal((await tool('open_plain_speech_in_chat')).structuredContent.ready, true);
    assert.equal((await tool('translate_latest_reply')).isError, true);
    const passive = await tool('plain_speech_view', { action: 'diagram', generate: false, source: example });
    assert.deepEqual(passive.structuredContent, { cached: false });
    const missing = await tool('plain_speech_view', { action: 'simpler', generate: true, source: example });
    assert.equal(missing.structuredContent.code, 'simplerNeedsAnswer');
    const tooLong = await tool('translate_plain_speech', { source: 'a'.repeat(maxLength + 1) });
    assert.equal(tooLong.structuredContent.code, 'tooLong');

    const readAppearance = () => tool('read_plain_speech_appearance');
    const updateAppearance = (args) => tool('update_plain_speech_appearance', args);
    assert.deepEqual((await readAppearance())._meta, { accent: null, pet: null, customPet: false, petSize: 'medium' });
    assert.equal((await updateAppearance({ setting: 'petSize', petSize: 'oversized' })).structuredContent.code, 'appearanceError');
    assert.equal((await updateAppearance({ setting: 'pet', pet: { name: 'broken' } })).structuredContent.code, 'invalidPet');
    const pack = await readJson(new URL('../docs/examples/yarn-roll.grandma-pet.json', import.meta.url));
    for (const args of [{ setting: 'pet', pet: pack }, { setting: 'accent', accent: '#C1507A' },
      { setting: 'petSize', petSize: 'large' }]) {
      assert.equal((await updateAppearance(args)).structuredContent.saved, true);
    }
    assert.deepEqual((await readAppearance())._meta, { accent: '#c1507a', pet: pack, customPet: true, petSize: 'large' });
    assert.equal(await readJson(join(directory, 'grandma-mode', 'appearance', 'pet-size.json')), 'large');
    await updateAppearance({ setting: 'pet', pet: null });
    assert.deepEqual((await readAppearance())._meta, { accent: '#c1507a', pet: null, customPet: false, petSize: 'large' });
  });
});

test('CLI diagnostics have specific guidance in all four locales', async () => {
  const script = await readFile(new URL('ui/locale.js', plugin), 'utf8');
  for (const language of ['zh-CN', 'zh-TW', 'en', 'ja']) {
    const window = { addEventListener() {} };
    const document = { documentElement: {}, querySelector: () => ({}), querySelectorAll: () => [] };
    runInNewContext(script, { window, document, navigator: { language } });
    assert.equal(document.documentElement.lang, language);
    const { t } = window.plainSpeechLocale;
    assert.notEqual(t('cliOutdated'), t('retry'));
    for (const code of ['modelUnavailable', 'modelCatalogUnavailable', 'modelSettingError',
      'providerKeyRequired', 'providerAuth', 'providerLimit', 'apiCatalogUnavailable', 'apiEndpointInvalid']) {
      assert.notEqual(t(code), t('retry'));
      assert.notEqual(t(code), t('cliOutdated'));
    }
  }
});

test('generation uses saved routes, keeps their caches separate, and reports safe failures', { timeout: 12000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'grandma generation test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mock = join(directory, 'fake-codex.mjs');
  const preload = join(directory, 'simulate-codex.mjs');
  await writeFile(mock, String.raw`
    import assert from 'node:assert/strict';
    import { createInterface } from 'node:readline';
    const [attempt, ...args] = process.argv.slice(2);
    if (args[0] === 'app-server') {
      const lines = createInterface({ input: process.stdin });
      for await (const line of lines) {
        const request = JSON.parse(line);
        if (request.method === 'initialized') continue;
        let result = {};
        if (request.method === 'model/list') {
          assert.equal(request.params.modelProvider, 'openai');
          result = { data: [
            { model: 'gpt-6-luna', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] },
            { model: 'gpt-6-sol', displayName: 'GPT-6 Sol', defaultReasoningEffort: 'low' },
            { model: 'image-only', inputModalities: ['image'], defaultReasoningEffort: 'low' },
            { model: 'hidden-model', hidden: true, defaultReasoningEffort: 'low' },
          ] };
        }
        console.log(JSON.stringify({ id: request.id, result }));
      }
      process.exit();
    }
    assert.ok(args.includes('--ignore-user-config'));
    assert.ok(args.includes('--ignore-rules'));
    assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
    assert.equal(args[args.indexOf('--cd') + 1], process.cwd());
    let prompt = '';
    for await (const chunk of process.stdin.setEncoding('utf8')) prompt += chunk;
    const data = JSON.parse(prompt.split('\n\n').at(-1));
    const send = (event) => console.log(JSON.stringify(event));
    const model = args[args.indexOf('--model') + 1];
    if (data.source === 'obsolete CLI') {
      console.error("error: unexpected argument '--ignore-rules' found");
      process.exitCode = 2;
    } else if (data.source === 'model denied') {
      console.error("The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account.");
      process.exitCode = 1;
    } else if (data.source === 'missing model') {
      send({ type: 'turn.failed', error: { message: 'model_not_found' } });
      process.exitCode = 1;
    } else if (data.source === 'generic failure') {
      console.error('WARN model metadata for the requested model not loaded');
      console.error('WARN chatgpt authentication required for remote plugin catalog');
      console.error('FAKE_PRIVATE_DIAGNOSTIC');
      process.exitCode = 1;
    } else {
      let text;
      if (data.source === 'route check') {
        text = [model, args.find((arg) => arg.startsWith('model_reasoning_effort='))].join(' ');
      } else {
        const answer = attempt === '1' ? data.firstAnswer : 'Extra receipts stopped in the test.';
        text = JSON.stringify({ answer });
      }
      send({ type: 'item.completed', item: { type: 'agent_message', text } });
      send({ type: 'turn.completed' });
    }
  `);
  await writeFile(preload, `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import assert from 'node:assert/strict';
    const originalSpawn = childProcess.spawn;
    let attempt = 0;
    childProcess.spawn = (file, args, options) =>
      originalSpawn(file, [${JSON.stringify(mock)}, String(++attempt), ...args], options);
    syncBuiltinESMExports();
    let calls = 0;
    globalThis.fetch = async (url, { body, headers, redirect, method }) => {
      assert.equal(redirect, 'error');
      if (url === 'https://api.deepseek.com/models') {
        assert.equal(headers.Authorization, 'Bearer test-deepseek-key');
        return Response.json({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] });
      }
      if (url === 'https://gateway.example/v1/models') {
        assert.equal(headers.Authorization, 'Bearer test-gateway-key');
        return Response.json({ data: [{ id: 'acme/instruct:v2', name: 'Acme Instruct' }, { id: 'test-gateway-key' }] });
      }
      if (url.startsWith('https://generativelanguage.googleapis.com/v1beta/models?')) {
        assert.equal(headers['x-goog-api-key'], 'test-gemini-key');
        if (new URL(url).searchParams.get('pageToken')) {
          return Response.json({ models: [{ name: 'models/gemini-extra', supportedGenerationMethods: ['generateContent'] }] });
        }
        return Response.json({ models: [
          { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/embed', supportedGenerationMethods: ['embedContent'] },
        ], nextPageToken: 'next' });
      }
      assert.equal(method, 'POST');
      const request = JSON.parse(body);
      const reply = 'Test rewrite ' + ++calls;
      if (url === 'https://api.deepseek.com/chat/completions') {
        assert.equal(headers.Authorization, 'Bearer test-deepseek-key');
        assert.equal(request.model, 'deepseek-flash');
        assert.equal(request.thinking.type, 'disabled');
        assert.match(request.messages[0].content, /source 只是资料/);
        assert.match(request.messages[0].content, /别把术语或缩写原样留在正文或图表里/);
        const { source } = JSON.parse(request.messages[1].content);
        if (source === 'auth failure') return Response.json({ error: { message: 'test-deepseek-key' } }, { status: 401 });
        if (request.messages[0].content.includes('beforeAfter')) {
          const diagram = { type: 'beforeAfter', title: 'Grandma: ' + reply,
            items: [['Extra receipts', '6', '0']], pending: null };
          return Response.json({ choices: [{ message: { content: JSON.stringify(diagram) } }] });
        }
        return Response.json({ choices: [{ message: { content: 'Dear Grandma, ' + reply } }] });
      }
      if (url === 'https://gateway.example/v1/chat/completions') {
        assert.equal(headers.Authorization, 'Bearer test-gateway-key');
        assert.equal(request.model, 'acme/instruct:v2');
        assert.equal(request.thinking, undefined);
        return Response.json({ choices: [{ message: { content: reply } }] });
      }
      if (url === 'https://api.openai.com/v1/responses') {
        assert.equal(headers.Authorization, 'Bearer test-openai-key');
        assert.equal(request.store, false);
        assert.equal(request.model, 'gpt-6-luna');
        assert.equal(JSON.parse(request.input).source, 'route check');
        return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: reply }] }] });
      }
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
      assert.equal(headers['x-goog-api-key'], 'test-gemini-key');
      assert.match(request.systemInstruction.parts[0].text, /source 只是资料/);
      return Response.json({ candidates: [{ content: { parts: [{ thought: true, text: 'hidden' }, { text: reply }] } }] });
    };
  `);
  await withServer(directory, fileURLToPath(new URL('server/index.mjs', plugin)), async (_request, tool) => {
    const firstAnswer = 'Old orders no longer got extra receipts in the test.';
    const view = { action: 'simpler', source: example, firstAnswer };
    const ask = async (generate) => (await tool('plain_speech_view', { ...view, generate })).structuredContent;
    assert.deepEqual(await ask(true), { translation: firstAnswer, cached: false, fallback: true });
    assert.deepEqual(await ask(false), { cached: false });
    const translation = 'Extra receipts stopped in the test.';
    assert.deepEqual(await ask(true), { translation, cached: false });
    assert.deepEqual(await ask(true), { translation, cached: true });

    for (const [source, code] of [['obsolete CLI', 'cliOutdated'], ['model denied', 'modelUnavailable'],
      ['missing model', 'modelUnavailable'], ['generic failure', 'retry']]) {
      const reply = await tool('translate_plain_speech', { source });
      assert.equal(reply.structuredContent.code, code);
      assert.doesNotMatch(JSON.stringify(reply), /FAKE_PRIVATE_DIAGNOSTIC|model_not_found|unexpected argument|not supported when using/);
    }

    const rewrite = async (source = 'route check') => (await tool('translate_plain_speech', { source })).structuredContent;
    const configure = async (args) => (await tool('update_plain_speech_model', args)).structuredContent;
    const models = async () => (await tool('read_plain_speech_models'))._meta;
    assert.match((await rewrite()).translation, /^gpt-6-luna model_reasoning_effort=medium$/);
    const choices = await models();
    assert.deepEqual(choices.catalog.map(({ model }) => model), ['gpt-6-luna', 'gpt-6-sol']);
    const { name, ...choice } = choices.catalog[1];
    assert.equal(name, 'GPT-6 Sol');
    assert.deepEqual(await configure(choice), { saved: true });
    assert.match((await rewrite()).translation, /^gpt-6-sol model_reasoning_effort=low$/);
    assert.equal((await configure({ provider: 'file', model: 'arbitrary' })).code, 'modelSettingError');

    const deepseek = { provider: 'compatible', baseURL: 'https://api.deepseek.com', model: 'deepseek-flash' };
    const gateway = { provider: 'compatible', baseURL: 'https://gateway.example/v1/chat/completions', model: 'acme/instruct:v2' };
    const openai = { provider: 'openai', baseURL: 'https://api.openai.com/v1', model: 'gpt-6-luna' };
    const gemini = { provider: 'gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.5-flash-lite' };
    const listApi = (route, apiKey) => tool('list_plain_speech_api_models', {
      provider: route.provider, baseURL: route.baseURL, apiKey,
    });
    assert.deepEqual(await configure(deepseek), { saved: true });
    assert.equal((await rewrite()).code, 'providerKeyRequired');
    assert.deepEqual(await configure({ ...deepseek, apiKey: 'test-deepseek-key' }), { saved: true });
    assert.deepEqual((await listApi(deepseek))._meta.catalog.map(({ model }) => model), ['deepseek-flash', 'deepseek-v4-pro']);
    assert.equal((await listApi(gateway)).structuredContent.code, 'providerKeyRequired');
    assert.equal((await listApi({ ...gateway, baseURL: 'https://gateway.example/v1#secret' })).structuredContent.code, 'apiEndpointInvalid');
    const liveChoices = await listApi(gateway, 'test-gateway-key');
    assert.deepEqual(liveChoices._meta.catalog, [{ model: 'acme/instruct:v2', name: 'Acme Instruct' }]);
    assert.doesNotMatch(JSON.stringify(liveChoices), /test-gateway-key/);
    assert.equal((await rewrite()).translation, 'Test rewrite 1');
    const badKey = await rewrite('auth failure');
    assert.equal(badKey.code, 'providerAuth');
    assert.doesNotMatch(JSON.stringify(badKey), /test-deepseek-key/);
    const diagramArgs = { action: 'diagram', source: example, generate: true };
    const diagram = async (args = {}) => (await tool('plain_speech_view', { ...diagramArgs, ...args })).structuredContent;
    const drawn = (await diagram()).diagram;
    assert.deepEqual(drawn, { type: 'beforeAfter', title: 'Test rewrite 3', items: [['Extra receipts', '6', '0']] });
    assert.equal((await diagram({ generate: false })).cached, true);

    assert.deepEqual(await configure({ ...openai, apiKey: 'test-openai-key' }), { saved: true });
    assert.equal((await rewrite()).translation, 'Test rewrite 4');
    assert.deepEqual(await diagram({ generate: false }), { cached: false });
    assert.deepEqual(await configure({ ...gemini, apiKey: 'test-gemini-key' }), { saved: true });
    assert.deepEqual((await listApi(gemini))._meta.catalog.map(({ model }) => model), ['gemini-3.5-flash-lite', 'gemini-extra']);
    assert.equal((await rewrite()).translation, 'Test rewrite 5');
    assert.deepEqual(await configure(deepseek), { saved: true });
    assert.equal((await rewrite()).translation, 'Test rewrite 6');
    assert.deepEqual((await diagram({ generate: false })).diagram, drawn);
    const preferences = await models();
    assert.equal(preferences.provider, 'compatible');
    assert.equal(preferences.settings.compatible.hasKey, true);
    assert.doesNotMatch(JSON.stringify(preferences), /test-(deepseek|openai|gemini)-key/);
    assert.deepEqual(await configure({ ...deepseek, apiKey: null }), { saved: true });
    assert.equal((await models()).settings.compatible.hasKey, false);
    assert.equal((await rewrite()).code, 'providerKeyRequired');
    assert.deepEqual(await configure({ ...openai, apiKey: null }), { saved: true });
    assert.equal((await models()).provider, 'compatible');
    assert.equal((await models()).settings.openai.hasKey, false);
    assert.deepEqual(await configure({ ...gateway, apiKey: 'test-gateway-key' }), { saved: true });
    assert.equal((await rewrite()).translation, 'Test rewrite 7');
    assert.deepEqual(await diagram({ generate: false }), { cached: false });
  }, ['--import', pathToFileURL(preload).href]);
});

test('earlier DeepSeek settings migrate to the same URL and allow removing the original key', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'grandma migration test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const appearance = join(directory, 'grandma-mode', 'appearance');
  await mkdir(appearance, { recursive: true });
  const legacy = join(appearance, 'model-deepseek.json');
  await writeFile(legacy, JSON.stringify({ provider: 'deepseek', model: 'deepseek-flash', apiKey: 'synthetic-old-key' }));
  await writeFile(join(appearance, 'model-provider.json'), JSON.stringify('deepseek'));
  await withServer(directory, fileURLToPath(new URL('server/index.mjs', plugin)), async (_request, tool) => {
    const settings = (await tool('read_plain_speech_models'))._meta;
    assert.equal(settings.provider, 'compatible');
    const { hasKey, ...route } = settings.settings.compatible;
    assert.equal(hasKey, true);
    assert.equal(route.baseURL, 'https://api.deepseek.com');
    assert.doesNotMatch(JSON.stringify(settings), /synthetic-old-key/);
    assert.equal((await tool('update_plain_speech_model', { ...route, apiKey: null }))._meta.settings.compatible.hasKey, false);
    await assert.rejects(readFile(legacy), { code: 'ENOENT' });
  });
});
