import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildImportedCheckpoint, extractArtifacts, inferImportedProject, parseSessionFile, selectRecentMessages } from '../src/codex-session.mjs';

test('parseSessionFile extracts user and assistant messages', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-session-'));
  const filePath = path.join(dir, 'session.jsonl');
  const lines = [
    JSON.stringify({ type: 'session_meta', payload: { id: 'sess-1', cwd: '/tmp/demo', timestamp: '2026-03-21T01:00:00Z' } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-03-21T01:00:01Z', payload: { type: 'user_message', message: '继续处理 CASE-ORR-20' } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-03-21T01:00:02Z', payload: { type: 'agent_message', message: '我会先检查 code-analysis 卡点。' } }),
  ].join('\n');
  await fs.writeFile(filePath, `${lines}\n`, 'utf8');

  const parsed = await parseSessionFile(filePath);
  assert.equal(parsed.sessionId, 'sess-1');
  assert.equal(parsed.cwd, '/tmp/demo');
  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.messages[0].role, 'user');
  assert.equal(parsed.messages[1].role, 'assistant');
});

test('selectRecentMessages respects count and order', () => {
  const input = [
    { role: 'user', text: 'a' },
    { role: 'assistant', text: 'b' },
    { role: 'user', text: 'c' },
  ];
  const picked = selectRecentMessages(input, { maxMessages: 2, maxChars: 10 });
  assert.deepEqual(picked.map((item) => item.text), ['b', 'c']);
});

test('buildImportedCheckpoint carries transcript and metadata', () => {
  const record = buildImportedCheckpoint(
    {
      filePath: '/tmp/sess.jsonl',
      sessionId: 'sess-1',
      cwd: '/tmp/demo',
      startedAt: '2026-03-21T01:00:00Z',
      messages: [
        { role: 'user', text: '修复 mem9 的 compact 自动保存' },
        { role: 'assistant', text: '我会补一个 history watcher。' },
      ],
    },
    { trigger: 'history:/compact', kind: 'compact-command' },
  );

  assert.equal(record.metadata.imported_session_id, 'sess-1');
  assert.equal(record.metadata.trigger, 'history:/compact');
  assert.ok(record.tags.includes('label:history-compact'));
  assert.match(record.content, /recent_transcript:/);
});

test('extractArtifacts keeps useful refs and drops noisy slash fragments', () => {
  const artifacts = extractArtifacts([
    {
      role: 'assistant',
      text: [
        'Repo `https://github.com/Benjamin2037/mem9` and file `codex-plugin/src/index.mjs`.',
        'Keep `~/.codex/config.toml` and `skills/mnemos-setup/SKILL.md`.',
        'Drop //mem9.ai, / handoff, Claude/OpenCode/OpenClaw, and session/checkpoint.',
        'Track CASE-ORR-9 too.',
      ].join(' '),
    },
  ]);

  assert.deepEqual(artifacts, [
    'https://github.com/Benjamin2037/mem9',
    'CASE-ORR-9',
    'codex-plugin/src/index.mjs',
    '~/.codex/config.toml',
    'skills/mnemos-setup/SKILL.md',
  ]);
});

test('inferImportedProject falls back to repo-like artifact when cwd is generic', () => {
  const project = inferImportedProject(
    {
      cwd: '/Users/demo/project',
      messages: [],
    },
    {},
    [
      {
        role: 'assistant',
        text: 'Updated `https://github.com/Benjamin2037/mem9` and `codex-plugin/src/index.mjs`.',
      },
    ],
  );

  assert.equal(project, 'mem9');
});
