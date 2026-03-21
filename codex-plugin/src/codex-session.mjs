import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCheckpointRecord, inferProjectName, normalizeList } from './helpers.mjs';

const GENERIC_PROJECT_NAMES = new Set(['project', 'workspace', 'sourcecode', 'code', 'repo', 'repos', 'work']);
const RESERVED_PATH_SEGMENTS = new Set([
  'src',
  'test',
  'tests',
  'docs',
  'doc',
  'skills',
  'codex-plugin',
  'claude-plugin',
  'openclaw-plugin',
  'opencode-plugin',
]);
const URL_PATTERN = /https?:\/\/[^\s<>"'`),]+/g;
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;
const ISSUE_KEY_PATTERN = /\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)*-\d+\b/g;
const PATH_PATTERN = /(?:^|[\s("'`])((?:~\/|\/(?!\/)|\.\.\/|\.\/|[A-Za-z0-9._-]+\/)[A-Za-z0-9._~/-]*[A-Za-z0-9._~-])(?=$|[\s)"'`,:;!?])/g;

export function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

export function historyFilePath() {
  return path.join(codexHome(), 'history.jsonl');
}

export function sessionsRoot() {
  return path.join(codexHome(), 'sessions');
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }
  return files;
}

function compactText(value, maxLength = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeArtifact(rawValue) {
  let value = String(rawValue || '').trim();
  if (!value) {
    return '';
  }

  value = value.replace(/^[ ("'`]+/, '').replace(/[)."'\`,:;!?]+$/, '');
  if (!value) {
    return '';
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value.replace(/[.,:;!?]+$/, '');
  }

  if ((value.startsWith('/') || value.startsWith('~/') || value.startsWith('./') || value.startsWith('../')) && value !== '/') {
    value = value.replace(/\/+$/, '');
  }

  return value;
}

function looksLikeArtifact(value) {
  if (!value || /\s/.test(value)) {
    return false;
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return true;
  }

  if (/^[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)*-\d+$/.test(value)) {
    return true;
  }

  if (value.startsWith('//') || value.includes('://')) {
    return false;
  }

  if (value.startsWith('/')) {
    return value.includes('.', 1) || value.indexOf('/', 1) !== -1;
  }

  if (value.startsWith('~/') || value.startsWith('./') || value.startsWith('../')) {
    return true;
  }

  if (!value.includes('/')) {
    return false;
  }

  const segments = value.split('/').filter(Boolean);
  if (segments.length < 2 || segments.some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment))) {
    return false;
  }

  const last = segments[segments.length - 1];
  if (/\.[A-Za-z0-9_-]+$/.test(last)) {
    return true;
  }

  return segments.every((segment) => /^[a-z0-9._-]+$/.test(segment)) && segments.some((segment) => /[-_.]/.test(segment));
}

function collectArtifacts(text, add) {
  for (const pattern of [URL_PATTERN, ISSUE_KEY_PATTERN]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      add(match[0]);
    }
  }

  INLINE_CODE_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(INLINE_CODE_PATTERN)) {
    add(match[1]);
  }

  PATH_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(PATH_PATTERN)) {
    add(match[1]);
  }
}

function scoreProjectCandidate(scores, value, points) {
  if (!value || RESERVED_PATH_SEGMENTS.has(value) || GENERIC_PROJECT_NAMES.has(value)) {
    return;
  }
  scores.set(value, (scores.get(value) || 0) + points);
}

function shortlistReplies(messages, role, limit) {
  return normalizeList(
    messages
      .filter((item) => item.role === role)
      .slice(-limit)
      .map((item) => compactText(item.text)),
  );
}

function buildTranscript(messages) {
  return messages
    .map((item) => `[${item.role}] ${compactText(item.text, 500)}`)
    .join('\n');
}

export async function findSessionFile(sessionId) {
  const files = await walk(sessionsRoot());
  for (const filePath of files) {
    const firstLine = (await fs.readFile(filePath, 'utf8')).split('\n', 1)[0];
    if (!firstLine) {
      continue;
    }
    try {
      const record = JSON.parse(firstLine);
      if (record?.type === 'session_meta' && record?.payload?.id === sessionId) {
        return filePath;
      }
    } catch {
      // Ignore malformed files.
    }
  }
  return null;
}

export async function latestSessionFile() {
  const files = await walk(sessionsRoot());
  let best = null;
  let bestMtime = 0;
  for (const filePath of files) {
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs > bestMtime) {
      bestMtime = stat.mtimeMs;
      best = filePath;
    }
  }
  return best;
}

export async function parseSessionFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  const messages = [];
  let meta = null;

  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (record?.type === 'session_meta') {
      meta = record.payload || null;
      continue;
    }

    if (record?.type === 'event_msg') {
      const payload = record.payload || {};
      if (payload.type === 'user_message' || payload.type === 'agent_message') {
        const role = payload.type === 'user_message' ? 'user' : 'assistant';
        const text = String(payload.message || '').trim();
        if (!text) {
          continue;
        }
        messages.push({
          role,
          text,
          timestamp: record.timestamp || null,
        });
      }
    }
  }

  return {
    filePath,
    sessionId: meta?.id || null,
    cwd: meta?.cwd || '',
    startedAt: meta?.timestamp || null,
    messages,
  };
}

export function selectRecentMessages(messages, { maxMessages = 12, maxChars = 6000 } = {}) {
  const picked = [];
  let totalChars = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    const size = item.text.length;
    if (picked.length >= maxMessages || (picked.length > 0 && totalChars + size > maxChars)) {
      break;
    }
    picked.push(item);
    totalChars += size;
  }
  return picked.reverse();
}

export function extractArtifacts(messages) {
  const artifacts = new Set();
  const add = (candidate) => {
    const value = normalizeArtifact(candidate);
    if (!looksLikeArtifact(value)) {
      return;
    }
    artifacts.add(value);
  };

  for (const message of messages) {
    collectArtifacts(String(message.text || ''), add);
    if (artifacts.size >= 12) {
      break;
    }
  }

  return [...artifacts].slice(0, 12);
}

export function inferImportedProject(parsed, options = {}, recentMessages = parsed.messages || []) {
  const explicitProject = String(options.project || process.env.MNEMO_PROJECT || '').trim();
  if (explicitProject) {
    return inferProjectName(explicitProject, parsed.cwd || process.cwd());
  }

  const cwdProject = inferProjectName('', parsed.cwd || process.cwd());
  if (!GENERIC_PROJECT_NAMES.has(cwdProject)) {
    return cwdProject;
  }

  const artifacts = extractArtifacts(recentMessages);
  const scores = new Map();
  for (const artifact of artifacts) {
    if (artifact.startsWith('https://github.com/') || artifact.startsWith('http://github.com/')) {
      const parts = artifact.replace(/^https?:\/\/github\.com\//, '').split('/');
      scoreProjectCandidate(scores, parts[1], 5);
      continue;
    }

    if (parsed.cwd && artifact.startsWith(`${parsed.cwd}/`)) {
      const relative = artifact.slice(parsed.cwd.length + 1);
      scoreProjectCandidate(scores, relative.split('/')[0], 3);
      continue;
    }

    if (!artifact.startsWith('/') && !artifact.startsWith('~/') && !artifact.startsWith('./') && !artifact.startsWith('../') && artifact.includes('/')) {
      scoreProjectCandidate(scores, artifact.split('/')[0], 2);
    }
  }

  let bestName = '';
  let bestScore = 0;
  for (const [name, score] of scores.entries()) {
    if (score > bestScore) {
      bestName = name;
      bestScore = score;
    }
  }

  return bestScore >= 3 ? bestName : cwdProject;
}

export function buildImportedCheckpoint(parsed, options = {}) {
  const recentMessages = selectRecentMessages(parsed.messages, {
    maxMessages: options.maxMessages || 12,
    maxChars: options.maxChars || 6000,
  });
  const project = inferImportedProject(parsed, options, recentMessages);
  const sessionLabel = String(options.session || parsed.sessionId || '').trim() || null;
  const trigger = String(options.trigger || 'manual-import').trim();
  const kind = String(options.kind || 'compact').trim() || 'compact';
  const transcript = buildTranscript(recentMessages);
  const artifacts = [parsed.filePath, ...(extractArtifacts(recentMessages))].slice(0, 12);
  const openLoops = shortlistReplies(recentMessages, 'user', 4);
  const nextSteps = shortlistReplies(recentMessages, 'assistant', 3);
  const summaryParts = [
    `Imported Codex session snapshot triggered by ${trigger}.`,
    `session_id: ${parsed.sessionId || 'unknown'}`,
    parsed.cwd ? `cwd: ${parsed.cwd}` : '',
    parsed.startedAt ? `started_at: ${parsed.startedAt}` : '',
    '',
    'recent_transcript:',
    transcript || '[no recent transcript captured]',
  ].filter(Boolean);

  const record = buildCheckpointRecord({
    project,
    session: sessionLabel,
    summary: summaryParts.join('\n'),
    openLoops,
    nextSteps,
    artifacts,
    cwd: parsed.cwd,
    gitBranch: options.gitBranch || '',
    checkpointKind: kind,
    labels: ['imported-session', trigger],
  });

  record.metadata = {
    ...record.metadata,
    schema: 'mem9.codex.imported_session.v1',
    imported_session_id: parsed.sessionId,
    imported_session_file: parsed.filePath,
    trigger,
    message_count: parsed.messages.length,
    recent_message_count: recentMessages.length,
  };

  return record;
}
