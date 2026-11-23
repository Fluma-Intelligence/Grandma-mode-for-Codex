import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function codexProcessEnv(env = process.env) {
  if (env.CODEX_HOME) return env;
  const pluginRoot = env.PLUGIN_ROOT ?? fileURLToPath(new URL('../', import.meta.url));
  if (!isAbsolute(pluginRoot)) return env;

  // Codex can filter CODEX_HOME out of a plugin's stdio environment. For a
  // Codex cache install, the package path identifies the same local profile.
  const cache = resolve(pluginRoot, '..', '..', '..');
  const plugins = dirname(cache);
  if (basename(cache) !== 'cache' || basename(plugins) !== 'plugins') return env;
  return { ...env, CODEX_HOME: dirname(plugins) };
}

export function pluginDataDirectory() {
  const profile = codexProcessEnv().CODEX_HOME ?? join(homedir(), '.codex');
  return join(profile, 'grandma-mode');
}
