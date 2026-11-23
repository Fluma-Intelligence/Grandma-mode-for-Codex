import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizePetPack } from './pet-pack.mjs';
import { pluginDataDirectory } from './codex-env.mjs';

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
