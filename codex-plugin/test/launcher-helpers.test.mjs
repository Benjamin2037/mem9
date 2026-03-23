import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { parseLauncherArgs, resolveCodexBin, splitArgs } from '../src/launcher-helpers.mjs';

test('splitArgs keeps launcher flags and forwards remaining Codex args without divider', () => {
  const result = splitArgs(['--project', 'BearWorkSpace', '--session', 'BearWorkSpace', '--print-startup', '-m', 'gpt-5.4']);
  assert.deepEqual(result.launcherArgs, ['--project', 'BearWorkSpace', '--session', 'BearWorkSpace', '--print-startup']);
  assert.deepEqual(result.codexArgs, ['-m', 'gpt-5.4']);
});

test('splitArgs respects explicit divider for Codex args', () => {
  const result = splitArgs(['--project', 'BearWorkSpace', '--', '--approval-mode', 'never']);
  assert.deepEqual(result.launcherArgs, ['--project', 'BearWorkSpace']);
  assert.deepEqual(result.codexArgs, ['--approval-mode', 'never']);
});

test('parseLauncherArgs reads boolean and value flags', () => {
  const args = parseLauncherArgs(['--project', 'BearWorkSpace', '--session', 's1', '--local-resume', '--print-startup']);
  assert.equal(args.project, 'BearWorkSpace');
  assert.equal(args.session, 's1');
  assert.equal(args.localResume, true);
  assert.equal(args.printStartup, true);
});

test('resolveCodexBin prefers CODEX_BIN then local npm-global fallback', () => {
  const localFallback = path.join(os.homedir(), 'local', 'npm-global', 'bin', 'codex');
  assert.equal(resolveCodexBin({ CODEX_BIN: '/tmp/custom-codex' }), '/tmp/custom-codex');
  const resolved = resolveCodexBin({});
  assert.ok(resolved === 'codex' || resolved === localFallback);
});
