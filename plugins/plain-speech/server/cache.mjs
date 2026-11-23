import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hashText } from './latest-reply.mjs';
import { translationVersion } from './translate.mjs';
import { pluginDataDirectory } from './codex-env.mjs';

let database;

async function openCache() {
  const { DatabaseSync } = await import('node:sqlite');
  const directory = process.env.PLAIN_SPEECH_CACHE_DIR || pluginDataDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const cache = new DatabaseSync(join(directory, 'translations.sqlite'));
  try {
    cache.exec(`
      PRAGMA busy_timeout = 1000;
      CREATE TABLE IF NOT EXISTS translations (
        key TEXT PRIMARY KEY, translation TEXT NOT NULL, created_at INTEGER NOT NULL
      );
    `);
    return cache;
  } catch (error) {
    cache.close();
    throw error;
  }
}

function getCache() {
  database ??= openCache().catch((error) => { database = undefined; throw error; });
  return database;
}

export function cacheKey(threadId, target, selection, source, version = translationVersion()) {
  return hashText(JSON.stringify([threadId, target?.messageId, target?.hash, selection ?? null,
    hashText(source), version]));
}

export async function readTranslation(key) {
  try {
    const cache = await getCache();
    return cache.prepare('SELECT translation FROM translations WHERE key = ?').get(key)?.translation;
  } catch {
    return undefined;
  }
}

export async function saveTranslation(key, translation) {
  try {
    const cache = await getCache();
    cache.prepare('INSERT OR IGNORE INTO translations VALUES (?, ?, ?)').run(key, translation, Date.now());
    cache.exec(`DELETE FROM translations WHERE key IN (
      SELECT key FROM translations ORDER BY created_at DESC, key LIMIT -1 OFFSET 256
    )`);
  } catch {
    // A cache error must not prevent reading a completed translation.
  }
}
