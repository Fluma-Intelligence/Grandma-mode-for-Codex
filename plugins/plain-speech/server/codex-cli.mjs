import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, delimiter, dirname, extname, isAbsolute, join } from 'node:path';
import { codexProcessEnv } from './codex-env.mjs';
import { speechError } from './errors.mjs';

function isFile(path) {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile();
  } catch {
    return false;
  }
}

function npmCodexBinary(shim) {
  const architecture = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
  if (!architecture || basename(shim).toLowerCase() !== 'codex.cmd' || !isFile(shim)) return;

  // npm places global shims beside node_modules and local shims inside .bin.
  const directory = dirname(shim);
  const modules = basename(directory).toLowerCase() === '.bin' ? dirname(directory) : join(directory, 'node_modules');
  const entry = join(modules, '@openai', 'codex', 'bin', 'codex.js');
  if (!isFile(entry)) return;

  const packageRoot = dirname(dirname(entry));
  const platform = `@openai/codex-win32-${process.arch}`;
  let vendor = join(packageRoot, 'vendor');
  try {
    vendor = join(dirname(createRequire(entry).resolve(`${platform}/package.json`)), 'vendor');
  } catch {
    // Older npm releases can bundle the executable in the main package.
  }
  const target = join(vendor, `${architecture}-pc-windows-msvc`);
  return [join(target, 'bin', 'codex.exe'), join(target, 'codex', 'codex.exe')].find(isFile);
}

function windowsExecutable(command, env) {
  if (isAbsolute(command) && extname(command).toLowerCase() === '.cmd') return npmCodexBinary(command);
  if (!/^codex(?:\.cmd)?$/i.test(command)) return command;

  const pathKey = Object.keys(env).sort().find((key) => key.toLowerCase() === 'path');
  for (const value of (env[pathKey] ?? '').split(delimiter)) {
    const directory = value.trim().replace(/^"(.*)"$/, '$1');
    if (!isAbsolute(directory)) continue;
    if (!extname(command)) {
      const native = ['codex.com', 'codex.exe'].map((file) => join(directory, file)).find(isFile);
      if (native) return native;
    }
    const binary = npmCodexBinary(join(directory, 'codex.cmd'));
    if (binary) return binary;
  }
}

export function spawnCodex(args, options) {
  const env = codexProcessEnv();
  const command = env.PLAIN_SPEECH_CODEX || 'codex';
  const executable = process.platform === 'win32' ? windowsExecutable(command, env) : command;
  if (!executable) throw cliMissing();
  // Launch the executable itself so args stay literal and cancellation stops it.
  return spawn(executable, args, { ...options, env, windowsHide: true });
}

export function cliMissing() {
  return speechError('cliMissing', '找不到 Codex CLI。请确认 codex 命令可用。');
}
