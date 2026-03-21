import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCheckpointRecord,
  buildMemoryRecord,
  inferProjectName,
  slugify,
} from '../src/helpers.mjs';

test('slugify normalizes mixed input', () => {
  assert.equal(slugify('TiForge RCA / Batch 9'), 'tiforge-rca-batch-9');
});

test('inferProjectName prefers explicit value', () => {
  assert.equal(inferProjectName('mem9', '/tmp/demo'), 'mem9');
});

test('buildCheckpointRecord emits project and checkpoint tags', () => {
  const record = buildCheckpointRecord({
    project: 'TiForge',
    session: 'ORR-43',
    summary: 'Finished the batch report refresh and paused CASE-ORR-20/21.',
    openLoops: ['Resume CASE-ORR-20'],
    nextSteps: ['Fix code-analysis fallback'],
  });

  assert.ok(record.tags.includes('kind:checkpoint'));
  assert.ok(record.tags.includes('project:tiforge'));
  assert.ok(record.tags.includes('session:orr-43'));
  assert.match(record.content, /summary:/);
  assert.equal(record.metadata.project, 'TiForge');
  assert.equal(record.metadata.checkpoint_content, record.content);
  assert.match(record.metadata.checkpoint_summary, /Finished the batch report refresh/);
});

test('buildMemoryRecord carries key metadata', () => {
  const record = buildMemoryRecord({
    project: 'TiForge',
    session: 'ORR-43',
    content: 'ORR-43 is the restore anchor for the RCA evaluation batch.',
    key: 'restore-anchor',
    kind: 'fact',
  });

  assert.ok(record.tags.includes('kind:fact'));
  assert.equal(record.metadata.key, 'restore-anchor');
  assert.equal(record.metadata.session, 'ORR-43');
});
