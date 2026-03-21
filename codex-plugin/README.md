# Codex Plugin for mem9

Shared memory support for Codex using two pieces:

- `src/index.mjs` — a local MCP server that exposes `mem9_*` tools inside Codex
- `src/launcher.mjs` — a small wrapper that asks whether to start a named session, resume a shared mem9 checkpoint, or resume a local Codex session

This gives Codex a workable answer to the current gap versus Claude Code / OpenCode / OpenClaw:

- local `codex resume` already exists for same-machine continuation
- mem9 adds cross-machine shared checkpoints and project memory
- the launcher adds the startup prompt you wanted without patching Codex itself
- a history watcher can auto-save a checkpoint when you trigger `/compact` or `/reset`
- checkpoint raw payload is preserved in `metadata.checkpoint_content`, so restore still works even when mem9 reconciles the visible memory text into an insight

## What it supports today

- save compact or handoff checkpoints with `mem9_checkpoint_save`
- recall recent shared checkpoints with `mem9_context_recall`
- store durable project facts with `mem9_memory_store`
- search prior facts with `mem9_memory_search`
- start Codex with a named session or bootstrap a new session from a shared mem9 checkpoint
- import a Codex transcript snapshot from `~/.codex/sessions`
- auto-save a session snapshot on `/compact` and `/reset` through a background watcher

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

## Import a Codex session snapshot

Dry run:

```bash
cd codex-plugin
node src/import-session.mjs --last --dry-run
```

Store a specific session:

```bash
cd codex-plugin
node src/import-session.mjs --session-id 019cfe6f-7011-73c1-a0a6-4176207e5f43
```

Store and wait until the imported checkpoint is visible in mem9:

```bash
cd codex-plugin
node src/import-session.mjs --last --wait --wait-ms 20000
```

The importer reads `~/.codex/sessions/**/*.jsonl`, extracts recent `user_message` and `agent_message` entries, and stores a checkpoint-style memory in mem9.
If your workspace root has a generic name like `project`, the importer also tries to infer a better project name from recent repo/file references.

## Auto-save on `/compact`

Run the watcher manually:

```bash
cd codex-plugin
node src/history-watcher.mjs
```

What it does:

1. polls `~/.codex/history.jsonl`
2. detects `/compact` and `/reset`
3. resolves the corresponding session file
4. imports a checkpoint snapshot into mem9

Install the macOS launch agent so this starts at login:

```bash
cd codex-plugin
node src/install-launch-agent.mjs
launchctl unload ~/Library/LaunchAgents/com.benjamin2037.codex.mem9-watcher.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.benjamin2037.codex.mem9-watcher.plist
```

Logs:

```bash
tail -f ~/.codex/log/mem9-watcher.log
```

## Recommended Codex workflow

1. start Codex from the launcher
2. at session start, call `mem9_context_recall` for the current project/session if relevant
3. during long work, use `mem9_memory_store` for durable facts, decisions, and environment notes
4. before compact, handoff, or pause, call `mem9_checkpoint_save`
5. on another machine, run the launcher and pick a shared checkpoint to bootstrap a fresh Codex session
6. if the watcher is enabled, `/compact` and `/reset` also create an automatic imported-session checkpoint

Note: mem9's `POST /memories` currently reconciles content into an insight memory. The Codex plugin compensates by storing the full checkpoint text inside `metadata.checkpoint_content`, and the launcher restores from that field.

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

5. **No first-class Codex lifecycle hook**
   - The watcher works by monitoring local Codex history, not by a native pre-compact callback.
   - Better: if Codex exposes official lifecycle hooks, replace the watcher with a true pre-compact / post-resume integration.
