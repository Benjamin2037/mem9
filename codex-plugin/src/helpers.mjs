import os from 'node:os';
import path from 'node:path';

export function slugify(value, fallback = 'default') {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) {
    return fallback;
  }
  const slug = text.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || fallback;
}

export function normalizeList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
}

export function inferProjectName(explicitProject, cwd = process.cwd()) {
  const fromEnv = String(process.env.MNEMO_PROJECT || '').trim();
  if (String(explicitProject || '').trim()) {
    return String(explicitProject).trim();
  }
  if (fromEnv) {
    return fromEnv;
  }
  return path.basename(cwd);
}

export function inferSessionName(explicitSession) {
  const fromEnv = String(process.env.MNEMO_SESSION || '').trim();
  if (String(explicitSession || '').trim()) {
    return String(explicitSession).trim();
  }
  return fromEnv;
}

export function defaultAgentId() {
  const explicit = String(process.env.MNEMO_AGENT_ID || '').trim();
  if (explicit) {
    return explicit;
  }
  return `codex-${slugify(os.hostname(), 'host')}`;
}

export function buildTags({ project, session, kind, labels = [] }) {
  const tags = [
    'agent:codex',
    `kind:${slugify(kind || 'note')}`,
    `project:${slugify(project, 'project')}`,
  ];
  const sessionName = inferSessionName(session);
  if (sessionName) {
    tags.push(`session:${slugify(sessionName, 'session')}`);
  }
  for (const label of normalizeList(labels)) {
    tags.push(`label:${slugify(label, 'label')}`);
  }
  return [...new Set(tags)];
}

export function buildCheckpointContent({
  project,
  session,
  summary,
  openLoops = [],
  nextSteps = [],
  artifacts = [],
  cwd = '',
  gitBranch = '',
  checkpointKind = 'compact',
}) {
  const lines = [
    '[mem9-codex-checkpoint]',
    `project: ${project}`,
    `session: ${session || 'unspecified'}`,
    `checkpoint_kind: ${checkpointKind}`,
  ];

  if (cwd) {
    lines.push(`cwd: ${cwd}`);
  }
  if (gitBranch) {
    lines.push(`git_branch: ${gitBranch}`);
  }

  lines.push('', 'summary:', summary.trim());

  const sections = [
    ['open_loops', openLoops],
    ['next_steps', nextSteps],
    ['artifacts', artifacts],
  ];

  for (const [name, values] of sections) {
    const items = normalizeList(values);
    if (items.length === 0) {
      continue;
    }
    lines.push('', `${name}:`);
    for (const item of items) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join('\n');
}

export function buildCheckpointRecord(input) {
  const project = inferProjectName(input.project, input.cwd);
  const session = inferSessionName(input.session);
  const checkpointKind = String(input.checkpointKind || 'compact').trim() || 'compact';
  const openLoops = normalizeList(input.openLoops);
  const nextSteps = normalizeList(input.nextSteps);
  const artifacts = normalizeList(input.artifacts);
  const labels = normalizeList(input.labels);
  const cwd = String(input.cwd || '').trim();
  const gitBranch = String(input.gitBranch || '').trim();
  const summary = String(input.summary || '').trim();
  const checkpointContent = buildCheckpointContent({
    project,
    session,
    summary,
    openLoops,
    nextSteps,
    artifacts,
    cwd,
    gitBranch,
    checkpointKind,
  });
  const metadata = {
    schema: 'mem9.codex.checkpoint.v1',
    agent: 'codex',
    project,
    project_slug: slugify(project, 'project'),
    session: session || null,
    session_slug: session ? slugify(session, 'session') : null,
    checkpoint_kind: checkpointKind,
    cwd: cwd || null,
    git_branch: gitBranch || null,
    open_loops: openLoops,
    next_steps: nextSteps,
    artifacts,
    labels,
    checkpoint_summary: summary,
    checkpoint_content: checkpointContent,
    created_at: new Date().toISOString(),
  };

  return {
    project,
    session,
    tags: buildTags({ project, session, kind: 'checkpoint', labels: [checkpointKind, ...labels] }),
    content: checkpointContent,
    metadata,
  };
}

export function buildMemoryRecord(input) {
  const project = inferProjectName(input.project, input.cwd);
  const session = inferSessionName(input.session);
  const kind = String(input.kind || 'fact').trim() || 'fact';
  const labels = normalizeList(input.labels);
  const metadata = {
    schema: 'mem9.codex.memory.v1',
    agent: 'codex',
    project,
    project_slug: slugify(project, 'project'),
    session: session || null,
    session_slug: session ? slugify(session, 'session') : null,
    key: input.key ? String(input.key).trim() : null,
    kind,
    labels,
    created_at: new Date().toISOString(),
    ...(input.metadata || {}),
  };

  return {
    project,
    session,
    tags: [...new Set([...(normalizeList(input.tags)), ...buildTags({ project, session, kind, labels })])],
    content: String(input.content || '').trim(),
    metadata,
  };
}

export function parseMetadata(memory) {
  if (!memory || memory.metadata == null) {
    return null;
  }
  if (typeof memory.metadata === 'object') {
    return memory.metadata;
  }
  try {
    return JSON.parse(memory.metadata);
  } catch {
    return null;
  }
}

export function summarizeMemory(memory) {
  const metadata = parseMetadata(memory) || {};
  const session = metadata.session || 'n/a';
  const updatedAt = memory.updated_at || memory.updatedAt || 'unknown';
  const content = String(metadata.checkpoint_summary || metadata.checkpoint_content || memory.content || '').replace(/\s+/g, ' ').trim();
  return `${session} | ${updatedAt} | ${content.slice(0, 120)}`;
}

export function toTextBlock(value) {
  return JSON.stringify(value, null, 2);
}
