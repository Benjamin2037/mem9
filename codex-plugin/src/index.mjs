#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { MnemoClient } from './client.mjs';
import {
  buildCheckpointRecord,
  buildMemoryRecord,
  buildTags,
  inferProjectName,
  inferSessionName,
  parseMetadata,
  toTextBlock,
} from './helpers.mjs';

const client = new MnemoClient();
const server = new McpServer({
  name: 'mem9-codex',
  version: '0.1.0',
});

function ok(structuredContent) {
  return {
    content: [{ type: 'text', text: toTextBlock(structuredContent) }],
    structuredContent,
  };
}

function fail(error) {
  return {
    content: [{ type: 'text', text: String(error instanceof Error ? error.message : error) }],
    isError: true,
  };
}

function mapMemories(memories = []) {
  return memories.map((memory) => ({
    id: memory.id,
    content: memory.content,
    tags: memory.tags || [],
    updated_at: memory.updated_at || memory.updatedAt || null,
    metadata: parseMetadata(memory),
  }));
}

server.registerTool(
  'mem9_checkpoint_save',
  {
    description: 'Save a compact Codex checkpoint to mem9 before compact, handoff, or pause.',
    inputSchema: {
      project: z.string().optional().describe('Project name. Defaults to MNEMO_PROJECT or current folder name.'),
      session: z.string().optional().describe('Human-friendly session name. Defaults to MNEMO_SESSION if set.'),
      summary: z.string().min(20).describe('Compact summary of the current state.'),
      openLoops: z.array(z.string()).optional().describe('Outstanding questions, blockers, or unfinished items.'),
      nextSteps: z.array(z.string()).optional().describe('Recommended next actions when the session resumes.'),
      artifacts: z.array(z.string()).optional().describe('Important file paths, issue keys, or URLs.'),
      cwd: z.string().optional().describe('Working directory for this checkpoint.'),
      gitBranch: z.string().optional().describe('Current git branch name.'),
      checkpointKind: z.string().optional().describe('compact, handoff, milestone, or custom label.'),
      labels: z.array(z.string()).optional().describe('Extra labels for filtering later.'),
    },
    outputSchema: {
      saved: z.boolean(),
      accepted: z.boolean(),
      memory_id: z.string(),
      project: z.string(),
      session: z.string().nullable(),
      tags: z.array(z.string()),
    },
  },
  async (input) => {
    try {
      const record = buildCheckpointRecord(input);
      const response = await client.createMemory({
        content: record.content,
        tags: record.tags,
        metadata: record.metadata,
      });
      const memory = response?.data;
      return ok({
        saved: true,
        accepted: response.status === 202,
        memory_id: memory?.id || '',
        project: record.project,
        session: record.session || null,
        tags: record.tags,
      });
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  'mem9_context_recall',
  {
    description: 'Recall recent shared checkpoints or project context from mem9.',
    inputSchema: {
      project: z.string().optional().describe('Project name. Defaults to MNEMO_PROJECT or current folder name.'),
      session: z.string().optional().describe('Optional session name to narrow the checkpoint list.'),
      query: z.string().optional().describe('Semantic/keyword query for checkpoint search.'),
      limit: z.number().int().min(1).max(20).optional().describe('Max results to return.'),
      labels: z.array(z.string()).optional().describe('Extra labels that were attached at save time.'),
    },
    outputSchema: {
      project: z.string(),
      session: z.string().nullable(),
      count: z.number(),
      memories: z.array(
        z.object({
          id: z.string(),
          content: z.string(),
          tags: z.array(z.string()),
          updated_at: z.string().nullable(),
          metadata: z.any().nullable(),
        }),
      ),
    },
  },
  async ({ project, session, query, limit, labels }) => {
    try {
      const resolvedProject = inferProjectName(project);
      const resolvedSession = inferSessionName(session);
      const tags = buildTags({
        project: resolvedProject,
        session: resolvedSession,
        kind: 'checkpoint',
        labels,
      }).filter((tag) => !tag.startsWith('session:') || resolvedSession);

      const response = await client.listMemories({
        query,
        tags,
        limit: limit || 5,
      });

      const memories = mapMemories(response?.memories || []);
      return ok({
        project: resolvedProject,
        session: resolvedSession || null,
        count: memories.length,
        memories,
      });
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  'mem9_memory_store',
  {
    description: 'Store a durable project fact, decision, or runbook note for Codex.',
    inputSchema: {
      project: z.string().optional().describe('Project name. Defaults to MNEMO_PROJECT or current folder name.'),
      session: z.string().optional().describe('Optional session name for traceability.'),
      content: z.string().min(5).describe('The fact, decision, or context to persist.'),
      kind: z.string().optional().describe('fact, decision, runbook, env, bug, or custom label.'),
      tags: z.array(z.string()).optional().describe('Extra tags to attach to the memory.'),
      labels: z.array(z.string()).optional().describe('Additional labels for filtering.'),
      key: z.string().optional().describe('Optional stable key identifier.'),
      metadata: z.record(z.string(), z.any()).optional().describe('Extra JSON metadata to persist.'),
      cwd: z.string().optional().describe('Optional working directory.'),
    },
    outputSchema: {
      saved: z.boolean(),
      accepted: z.boolean(),
      memory_id: z.string(),
      project: z.string(),
      session: z.string().nullable(),
      tags: z.array(z.string()),
    },
  },
  async (input) => {
    try {
      const record = buildMemoryRecord(input);
      const response = await client.createMemory({
        content: record.content,
        tags: record.tags,
        metadata: record.metadata,
      });
      const memory = response?.data;
      return ok({
        saved: true,
        accepted: response.status === 202,
        memory_id: memory?.id || '',
        project: record.project,
        session: record.session || null,
        tags: record.tags,
      });
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  'mem9_memory_search',
  {
    description: 'Search durable Codex memories for a project.',
    inputSchema: {
      project: z.string().optional().describe('Project name. Defaults to MNEMO_PROJECT or current folder name.'),
      query: z.string().optional().describe('Semantic/keyword query. Leave empty to list latest notes.'),
      session: z.string().optional().describe('Optional session name to narrow results.'),
      kind: z.string().optional().describe('Optional kind filter, such as fact or decision.'),
      labels: z.array(z.string()).optional().describe('Extra labels to include in the filter.'),
      limit: z.number().int().min(1).max(20).optional().describe('Max results to return.'),
    },
    outputSchema: {
      project: z.string(),
      session: z.string().nullable(),
      count: z.number(),
      memories: z.array(
        z.object({
          id: z.string(),
          content: z.string(),
          tags: z.array(z.string()),
          updated_at: z.string().nullable(),
          metadata: z.any().nullable(),
        }),
      ),
    },
  },
  async ({ project, query, session, kind, labels, limit }) => {
    try {
      const resolvedProject = inferProjectName(project);
      const resolvedSession = inferSessionName(session);
      const tags = buildTags({
        project: resolvedProject,
        session: resolvedSession,
        kind: kind || 'fact',
        labels,
      }).filter((tag) => !tag.startsWith('session:') || resolvedSession);

      const response = await client.listMemories({
        query,
        tags,
        limit: limit || 10,
      });

      const memories = mapMemories(response?.memories || []);
      return ok({
        project: resolvedProject,
        session: resolvedSession || null,
        count: memories.length,
        memories,
      });
    } catch (error) {
      return fail(error);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
