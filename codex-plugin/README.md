# Codex Plugin for mem9

Shared memory support for Codex using two pieces:

- `src/index.mjs` — a local MCP server that exposes `mem9_*` tools inside Codex
- `src/launcher.mjs` — a small wrapper that asks whether to start a named session, resume a shared mem9 checkpoint, or resume a local Codex session

This gives Codex a workable answer to the current gap versus Claude Code / OpenCode / OpenClaw:

- local `codex resume` already exists for same-machine continuation
- mem9 adds cross-machine shared checkpoints and project memory
- the launcher adds the startup prompt you wanted without patching Codex itself

## What it supports today

- save compact or handoff checkpoints with `mem9_checkpoint_save`
- recall recent shared checkpoints with `mem9_context_recall`
- store durable project facts with `mem9_memory_store`
- search prior facts with `mem9_memory_search`
- start Codex with a named session or bootstrap a new session from a shared mem9 checkpoint

## Prerequisites

- running `mnemo-server`
- `MNEMO_API_URL` set
- `MNEMO_TENANT_ID` set
- Codex CLI installed
- Node.js 20+

## Install

```bash
cd codex-plugin
npm install
```

Register the MCP server with Codex:

```bash
codex mcp add mem9 \
  --env MNEMO_API_URL="$MNEMO_API_URL" \
  --env MNEMO_TENANT_ID="$MNEMO_TENANT_ID" \
  --env MNEMO_AGENT_ID="codex-$(hostname -s)" \
  -- node /absolute/path/to/mem9/codex-plugin/src/index.mjs
```

Then verify:

```bash
codex mcp get mem9
```

## Launch with session chooser

```bash
cd codex-plugin
node src/launcher.mjs -- --search
```

The launcher offers:

1. new named Codex session
2. resume from a shared mem9 checkpoint
3. resume the local Codex session picker

It also exports `MNEMO_PROJECT` and `MNEMO_SESSION` into the launched Codex process so the MCP tools can default to the active project/session.

## Recommended Codex workflow

1. start Codex from the launcher
2. at session start, call `mem9_context_recall` for the current project/session if relevant
3. during long work, use `mem9_memory_store` for durable facts, decisions, and environment notes
4. before compact, handoff, or pause, call `mem9_checkpoint_save`
5. on another machine, run the launcher and pick a shared checkpoint to bootstrap a fresh Codex session

## Suggested `AGENTS.md` snippet

```md
## Shared Memory

This repo uses mem9 shared memory for Codex.

- At the start of multi-step work, recall relevant context with `mem9_context_recall`.
- Store durable discoveries with `mem9_memory_store`.
- Before compacting, handing off, or pausing, save a checkpoint with `mem9_checkpoint_save`.
```

## Current gaps worth improving in mem9

These are the main product gaps I found while wiring Codex support:

1. **No first-class checkpoint object**
   - Today checkpoints are stored as tagged memories.
   - Better: add a dedicated checkpoint/session API with `project`, `session`, `kind`, `summary`, `open_loops`, `next_steps`, `artifacts` fields.

2. **No upsert-by-key for durable facts**
   - Codex often wants stable keys like `restore-anchor`, `env:prod`, or `runbook:deploy`.
   - Better: add `key`-based upsert in the core API.

3. **Codex log ingest is not native yet**
   - Claude/OpenCode/OpenClaw already have lifecycle hooks/plugins.
   - Better: add a `codex-session-import` helper that understands `~/.codex/sessions/*.jsonl` directly.

4. **Search filtering is memory-centric, not session-centric**
   - Query search is great for content, but session restore wants first-class filtering on project/session/checkpoint type.
   - Better: expose dedicated restore/list endpoints for recent checkpoints.

5. **No automatic compact hook in Codex**
   - This is partly a Codex-side limitation today, so the current flow is explicit rather than automatic.
   - Better: if Codex later exposes lifecycle hooks, mem9 can add parity with the Claude/OpenCode/OpenClaw integrations.
