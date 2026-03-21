#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { codexHome, historyFilePath } from './codex-session.mjs';
import { importCodexSession } from './import-session.mjs';

function parseArgs(argv) {
  const args = {
    intervalMs: 4000,
    historyFile: historyFilePath(),
    stateFile: path.join(codexHome(), 'mem9-watcher-state.json'),
    logFile: path.join(codexHome(), 'log', 'mem9-watcher.log'),
    dryRun: false,
    replay: false,
    once: false,
    commands: ['/compact', '/reset'],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--interval-ms' && argv[index + 1]) {
      args.intervalMs = Number.parseInt(argv[index + 1], 10) || args.intervalMs;
      index += 1;
    } else if (token === '--history-file' && argv[index + 1]) {
      args.historyFile = argv[index + 1];
      index += 1;
    } else if (token === '--state-file' && argv[index + 1]) {
      args.stateFile = argv[index + 1];
      index += 1;
    } else if (token === '--log-file' && argv[index + 1]) {
      args.logFile = argv[index + 1];
      index += 1;
    } else if (token === '--command' && argv[index + 1]) {
      args.commands.push(argv[index + 1]);
      index += 1;
    } else if (token === '--dry-run') {
      args.dryRun = true;
    } else if (token === '--replay') {
      args.replay = true;
    } else if (token === '--once') {
      args.once = true;
    }
  }

  args.commands = [...new Set(args.commands.map((item) => item.trim()).filter(Boolean))];
  return args;
}

async function ensureParent(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function loadState(stateFile) {
  try {
    const raw = await fs.readFile(stateFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { processedLines: 0, seen: {} };
  }
}

async function saveState(stateFile, state) {
  await ensureParent(stateFile);
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
}

async function appendLog(logFile, message) {
  await ensureParent(logFile);
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await fs.appendFile(logFile, line, 'utf8');
}

async function readLines(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return raw.split('\n').filter(Boolean);
}

function eventKey(entry) {
  return `${entry.session_id}:${entry.ts}:${entry.text}`;
}

async function processLine(line, args, state) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return;
  }

  const text = String(entry.text || '').trim();
  if (!args.commands.includes(text) || !entry.session_id) {
    return;
  }

  const key = eventKey(entry);
  if (state.seen[key]) {
    return;
  }
  state.seen[key] = new Date().toISOString();
  await appendLog(args.logFile, `detected command ${text} for session ${entry.session_id}`);

  await sleep(2000);
  try {
    const result = await importCodexSession({
      sessionId: entry.session_id,
      trigger: `history:${text}`,
      kind: text === '/reset' ? 'reset-command' : 'compact-command',
      dryRun: args.dryRun,
    });
    const outcome = result.memory?.id || (result.accepted ? 'accepted' : 'dry-run');
    await appendLog(args.logFile, `stored checkpoint for ${entry.session_id}: ${outcome}`);
  } catch (error) {
    await appendLog(args.logFile, `failed to store checkpoint for ${entry.session_id}: ${error.message}`);
  }
}

async function tick(args, state, initialized) {
  const lines = await readLines(args.historyFile);
  if (!initialized && !args.replay) {
    state.processedLines = lines.length;
    return true;
  }

  if (lines.length < state.processedLines) {
    state.processedLines = 0;
  }

  for (const line of lines.slice(state.processedLines)) {
    await processLine(line, args, state);
  }
  state.processedLines = lines.length;
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = await loadState(args.stateFile);
  let initialized = false;

  await appendLog(args.logFile, `watcher started commands=${args.commands.join(',')} dryRun=${args.dryRun}`);

  do {
    try {
      await tick(args, state, initialized);
      await saveState(args.stateFile, state);
      initialized = true;
    } catch (error) {
      await appendLog(args.logFile, `watcher loop error: ${error.message}`);
    }

    if (args.once) {
      break;
    }
    await sleep(args.intervalMs);
  } while (true);
}

main().catch(async (error) => {
  try {
    await appendLog(path.join(codexHome(), 'log', 'mem9-watcher.log'), `fatal error: ${error.message}`);
  } finally {
    console.error(`history-watcher error: ${error.message}`);
    process.exit(1);
  }
});
