import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VALUE_FLAGS = new Set(['--project', '--session']);
const BOOLEAN_FLAGS = new Set(['--local-resume', '--print-startup']);

export function splitArgs(argv) {
  const divider = argv.indexOf('--');
  if (divider !== -1) {
    return {
      launcherArgs: argv.slice(0, divider),
      codexArgs: argv.slice(divider + 1),
    };
  }

  const launcherArgs = [];
  const codexArgs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (VALUE_FLAGS.has(token)) {
      launcherArgs.push(token);
      if (argv[index + 1]) {
        launcherArgs.push(argv[index + 1]);
        index += 1;
      }
      continue;
    }
    if (BOOLEAN_FLAGS.has(token)) {
      launcherArgs.push(token);
      continue;
    }
    codexArgs.push(token);
  }

  return { launcherArgs, codexArgs };
}

export function parseLauncherArgs(argv) {
  const args = { project: '', session: '', localResume: false, printStartup: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--project' && argv[i + 1]) {
      args.project = argv[i + 1];
      i += 1;
    } else if (token === '--session' && argv[i + 1]) {
      args.session = argv[i + 1];
      i += 1;
    } else if (token === '--local-resume') {
      args.localResume = true;
    } else if (token === '--print-startup') {
      args.printStartup = true;
    }
  }
  return args;
}

function firstExisting(candidates = []) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return '';
}

export function resolveCodexBin(env = process.env) {
  const explicit = String(env.CODEX_BIN || '').trim();
  if (explicit) {
    return explicit;
  }
  return firstExisting([
    path.join(os.homedir(), 'local', 'npm-global', 'bin', 'codex'),
  ]) || 'codex';
}
