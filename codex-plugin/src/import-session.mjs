#!/usr/bin/env node
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { MnemoClient } from './client.mjs';
import { parseMetadata } from './helpers.mjs';
import { buildImportedCheckpoint, findSessionFile, latestSessionFile, parseSessionFile } from './codex-session.mjs';

function parseArgs(argv) {
  const args = {
    sessionId: '',
    file: '',
    project: '',
    session: '',
    trigger: 'manual-import',
    kind: 'compact',
    dryRun: false,
    wait: false,
    waitMs: 15000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--session-id' && argv[index + 1]) {
      args.sessionId = argv[index + 1];
      index += 1;
    } else if (token === '--file' && argv[index + 1]) {
      args.file = argv[index + 1];
      index += 1;
    } else if (token === '--project' && argv[index + 1]) {
      args.project = argv[index + 1];
      index += 1;
    } else if (token === '--session' && argv[index + 1]) {
      args.session = argv[index + 1];
      index += 1;
    } else if (token === '--trigger' && argv[index + 1]) {
      args.trigger = argv[index + 1];
      index += 1;
    } else if (token === '--kind' && argv[index + 1]) {
      args.kind = argv[index + 1];
      index += 1;
    } else if (token === '--dry-run') {
      args.dryRun = true;
    } else if (token === '--wait') {
      args.wait = true;
    } else if (token === '--wait-ms' && argv[index + 1]) {
      args.waitMs = Number.parseInt(argv[index + 1], 10) || args.waitMs;
      index += 1;
    } else if (token === '--last') {
      args.last = true;
    }
  }

  return args;
}

export async function importCodexSession(options = {}) {
  let filePath = options.file;
  if (!filePath && options.sessionId) {
    filePath = await findSessionFile(options.sessionId);
  }
  if (!filePath && options.last) {
    filePath = await latestSessionFile();
  }
  if (!filePath) {
    throw new Error('No Codex session file found. Use --session-id, --file, or --last.');
  }

  const parsed = await parseSessionFile(filePath);
  const record = buildImportedCheckpoint(parsed, options);
  if (options.dryRun) {
    return { dry_run: true, file: filePath, record };
  }

  const client = new MnemoClient();
  const response = await client.createMemory({
    content: record.content,
    tags: record.tags,
    metadata: record.metadata,
  });
  let memory = null;

  if (options.wait) {
    memory = await client.waitForMatch({
      tags: record.tags,
      limit: 20,
      timeoutMs: options.waitMs || 15000,
      match: (candidate) => {
        const metadata = parseMetadata(candidate) || candidate.metadata || {};
        return metadata?.created_at === record.metadata.created_at && metadata?.imported_session_id === record.metadata.imported_session_id;
      },
    });
  }

  return {
    dry_run: false,
    file: filePath,
    accepted: response.status === 202,
    memory,
    response: response.data,
    record,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await importCodexSession(args);
  console.log(JSON.stringify(result, null, 2));
}

function isDirectRun() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(`import-session error: ${error.message}`);
    process.exit(1);
  });
}
