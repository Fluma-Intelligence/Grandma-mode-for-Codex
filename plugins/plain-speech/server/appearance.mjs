import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizePetPack } from './pet-pack.mjs';
import { pluginDataDirectory } from './codex-env.mjs';
import { defaultModel, normalizeModel, providers } from './models.mjs';

const directory = process.env.PLAIN_SPEECH_APPEARANCE_DIR || join(pluginDataDirectory(), 'appearance');
const path = (name) => join(directory, name);
const validColor = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export const petSizes = ['small', 'medium', 'large'];

async function read(name) {
  try {
    return JSON.parse(await readFile(path(name), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    return null;
  }
}

async function save(name, value) {
  if (value === null) {
    await rm(path(name), { force: true });
    return;
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path(`.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    await rename(temporary, path(name));
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readAppearance() {
  const [theme, own, petSize] = await Promise.all(['accent.json', 'pet.json', 'pet-size.json'].map(read));
  const pet = normalizePetPack(own) ?? null;
  return { accent: validColor(theme) ? theme : null, pet, customPet: Boolean(pet), petSize: petSizes.includes(petSize) ? petSize : 'medium' };
}

function normalizeKey(key) {
  return typeof key === 'string' && /^[!-~]{1,512}$/.test(key.trim()) ? key.trim() : undefined;
}

async function providerSetting(provider) {
  const configuration = await read(`model-${provider}.json`);
  const route = normalizeModel({ ...configuration, provider });
  if (route) return { ...route, apiKey: normalizeKey(configuration.apiKey) };
  return provider === 'codex' ? defaultModel : undefined;
}

export async function readModel() {
  const provider = await read('model-provider.json');
  return await providerSetting(providers.includes(provider) ? provider : 'codex') ?? defaultModel;
}

export async function readModelSettings() {
  const [active, ...settings] = await Promise.all([readModel(), ...providers.map(providerSetting)]);
  return {
    provider: active.provider,
    settings: Object.fromEntries(settings.filter(Boolean).map(({ apiKey, ...route }) =>
      [route.provider, { ...route, hasKey: Boolean(apiKey) }])),
  };
}

export async function updateModel({ provider, model, effort, apiKey }) {
  const route = normalizeModel({ provider, model, effort });
  if (!route || (provider === 'codex' && apiKey !== undefined)) return 'modelSettingError';
  const previous = await providerSetting(provider);
  if (apiKey === null) {
    if (previous) {
      const { apiKey: _removed, ...setting } = previous;
      await save(`model-${provider}.json`, setting);
    }
    return;
  }
  const key = apiKey == null ? apiKey : normalizeKey(apiKey);
  if (apiKey !== undefined && key === undefined) return 'modelSettingError';
  const savedKey = key === undefined ? previous?.apiKey : key;
  await save(`model-${provider}.json`, { ...route, ...(savedKey ? { apiKey: savedKey } : {}) });
  await save('model-provider.json', provider);
}

export async function updateAppearance({ setting, accent, pet, petSize }) {
  if (setting === 'accent' && (accent === null || validColor(accent))) {
    await save('accent.json', accent?.toLowerCase() ?? null);
  } else if (setting === 'pet') {
    const normalized = pet === null ? null : normalizePetPack(pet);
    if (normalized === undefined) return 'invalidPet';
    await save('pet.json', normalized);
  } else if (setting === 'petSize' && petSizes.includes(petSize)) {
    await save('pet-size.json', petSize);
  } else {
    return 'appearanceError';
  }
}
