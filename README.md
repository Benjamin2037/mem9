<p align="center">
  <img src="assets/logo.png" alt="mnemos" width="180" />
</p>

<h1 align="center">mnemos</h1>

<p align="center">
  <strong>Persistent Memory for AI Agents.</strong><br/>
  Your agents forget everything between sessions. mnemos fixes that.
</p>

<p align="center">
  <a href="https://tidbcloud.com"><img src="https://img.shields.io/badge/Powered%20by-TiDB%20Starter-E60C0C?style=flat&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIj48cGF0aCBkPSJNMTEuOTk4NCAxLjk5OTAyTDMuNzE4NzUgNy40OTkwMkwzLjcxODc1IDE3TDExLjk5NjQgMjIuNUwyMC4yODE0IDE3VjcuNDk5MDJMMTEuOTk4NCAxLjk5OTAyWiIgZmlsbD0id2hpdGUiLz48L3N2Zz4=" alt="Powered by TiDB Starter"></a>
  <a href="https://goreportcard.com/report/github.com/qiffang/mnemos/server"><img src="https://goreportcard.com/badge/github.com/qiffang/mnemos/server" alt="Go Report Card"></a>
  <a href="https://github.com/qiffang/mnemos/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
  <a href="https://github.com/qiffang/mnemos"><img src="https://img.shields.io/github/stars/qiffang/mnemos?style=social" alt="Stars"></a>
</p>

---

## 🚀 Quick Start

**Server-based memory via mnemo-server.**

```bash
# 1. Deploy mnemo-server
cd server && MNEMO_DSN="user:pass@tcp(host:4000)/mnemos?parseTime=true" go run ./cmd/mnemo-server
```

**2. Install plugin for your agent (pick one):**

| Platform | Install |
|----------|---------|
| **Codex** | Add the local mem9 MCP server via `codex mcp add mem9 -- node /path/to/codex-plugin/src/index.mjs` |
| **Claude Code** | `/plugin marketplace add qiffang/mnemos` then `/plugin install mnemo-memory@mnemos` |
| **OpenCode** | Add `"plugin": ["mnemo-opencode"]` to `opencode.json` |
| **OpenClaw** | Add `mnemo` to `openclaw.json` plugins (see [openclaw-plugin/README](openclaw-plugin/README.md)) |

```bash
# 3. Provision a tenant and set credentials
curl -s -X POST localhost:8080/v1alpha1/mem9s
# → {"id":"...", "claim_url":"..."}

export MNEMO_API_URL="http://localhost:8080"
export MNEMO_TENANT_ID="..."
```

All agents pointing at the same tenant ID share one memory pool.

---

## The Problem

AI coding agents — Claude Code, OpenCode, OpenClaw, and others — often maintain separate local memory files. The result:

- 🧠 **Amnesia** — Agent forgets everything when a session ends
- 🏝️ **Silos** — One agent can't access what another learned yesterday
- 📁 **Local files** — Memory is tied to a single machine, lost when you switch devices
- 🚫 **No team sharing** — Your teammate's agent can't benefit from your agent's discoveries

**mnemos** gives every agent a shared, cloud-persistent memory with hybrid vector + keyword search — powered by [TiDB Starter](https://tidbcloud.com).

## Why TiDB Starter?

mnemos uses [TiDB Starter](https://tidbcloud.com) (formerly TiDB Serverless) as the backing store for mnemo-server:

| Feature | What it means for you |
|---|---|
| **Free tier** | 25 GiB storage, 250M Request Units/month — enough for most individual and small team use |
| **TiDB Cloud Zero** | Instant database provisioning via API — no signup required for first 30 days |
| **Native VECTOR type** | Hybrid search (vector + keyword) without a separate vector database |
| **Auto-embedding (`EMBED_TEXT`)** | TiDB generates embeddings server-side — no OpenAI key needed for semantic search |
| **Zero ops** | No servers to manage, no scaling to worry about, automatic backups |
| **MySQL compatible** | Migrate to self-hosted TiDB or MySQL anytime |

This architecture keeps agent plugins **stateless** — all state lives in mnemo-server, backed by TiDB.

## Supported Agents

mnemos provides native plugins for major AI coding agent platforms:

| Platform | Plugin | How It Works | Install Guide |
|---|---|---|---|
| **Codex** | MCP tools + launcher | Shared checkpoint save/recall, plus a startup chooser for named or resumed sessions | [`codex-plugin/README.md`](codex-plugin/README.md) |
| **Claude Code** | Hooks + Skills | Auto-loads memories on session start, auto-saves on stop | [`claude-plugin/README.md`](claude-plugin/README.md) |
| **OpenCode** | Plugin SDK | `system.transform` injects memories, `session.idle` auto-captures | [`opencode-plugin/README.md`](opencode-plugin/README.md) |
| **OpenClaw** | Memory Plugin | Replaces built-in memory slot (`kind: "memory"`), framework manages lifecycle | [`openclaw-plugin/README.md`](openclaw-plugin/README.md) |
| **Any HTTP client** | REST API | `curl` to mnemo-server | [API Reference](#api-reference) |

All plugins expose the same 5 tools: `memory_store`, `memory_search`, `memory_get`, `memory_update`, `memory_delete`.

> **🤖 For AI Agents**: Use the Quick Start above to deploy mnemo-server and provision a tenant ID, then follow the platform-specific README for configuration details.

## Stateless Agents, Cloud Memory

A key design principle: **agent plugins carry zero state.** All memory lives in mnemo-server, backed by TiDB/MySQL. This means:

- **Agent plugins stay stateless** — deploy any number of agent instances freely; they all share the same memory pool via mnemo-server
- **Switch machines freely** — your agent's memory follows you, not your laptop
- **Multi-agent collaboration** — Codex, Claude Code, OpenCode, OpenClaw, and any HTTP client share memories when pointed at the same server
- **Centralized control** — rate limits and audit live in one place

## API Reference

Agent identity: `X-Mnemo-Agent-Id` header.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1alpha1/mem9s` | Provision tenant (no auth). Returns `{ "id", "claim_url" }`. |
| `POST` | `/v1alpha1/mem9s/{tenantID}/memories` | Unified write endpoint: `{content,...}` for direct create or `{messages,...}` for ingest pipeline. |
| `GET` | `/v1alpha1/mem9s/{tenantID}/memories` | Search: `?q=`, `?tags=`, `?source=`, `?key=`, `?limit=`, `?offset=` |
| `GET` | `/v1alpha1/mem9s/{tenantID}/memories/:id` | Get single memory |
| `PUT` | `/v1alpha1/mem9s/{tenantID}/memories/:id` | Update. Optional `If-Match` for version check. |
| `DELETE` | `/v1alpha1/mem9s/{tenantID}/memories/:id` | Delete |

## Self-Hosting

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MNEMO_DSN` | Yes | — | Database connection string |
| `MNEMO_PORT` | No | `8080` | HTTP listen port |
| `MNEMO_RATE_LIMIT` | No | `100` | Requests/sec per IP |
| `MNEMO_RATE_BURST` | No | `200` | Burst size |
| `MNEMO_EMBED_API_KEY` | No | — | Embedding provider API key |
| `MNEMO_EMBED_BASE_URL` | No | OpenAI | Custom embedding endpoint |
| `MNEMO_EMBED_MODEL` | No | `text-embedding-3-small` | Model name |
| `MNEMO_EMBED_DIMS` | No | `1536` | Vector dimensions |

### Build & Run

```bash
cd server
go build -o mnemo-server ./cmd/mnemo-server
MNEMO_DSN="user:pass@tcp(host:4000)/mnemos?parseTime=true" ./mnemo-server
```

### Docker

```bash
docker build -t mnemo-server ./server
docker run -e MNEMO_DSN="..." -p 8080:8080 mnemo-server
```

## Project Structure

```
mnemos/
├── server/                     # Go API server
│   ├── cmd/mnemo-server/       # Entry point
│   ├── internal/
│   │   ├── config/             # Env var config loading
│   │   ├── domain/             # Core types, errors, token generation
│   │   ├── embed/              # Embedding provider (OpenAI/Ollama/any)
│   │   ├── handler/            # HTTP handlers + chi router
│   │   ├── middleware/         # Auth + rate limiter
│   │   ├── repository/         # Interface + TiDB SQL implementation
│   │   └── service/            # Business logic (upsert, LWW, hybrid search)
│   ├── schema.sql
│   └── Dockerfile
│
├── opencode-plugin/            # OpenCode agent plugin (TypeScript)
│   └── src/                    # Plugin SDK tools + hooks + server backend
│
├── openclaw-plugin/            # OpenClaw agent plugin (TypeScript)
│   ├── index.ts                # Tool registration
│   └── server-backend.ts       # Server: fetch → mnemo API
│
├── codex-plugin/               # Codex MCP server + session launcher
│   ├── src/index.mjs           # MCP tools: checkpoint save/recall + memory store/search
│   └── src/launcher.mjs        # Named-session / resume launcher for Codex
│
├── claude-plugin/              # Claude Code plugin (Hooks + Skills)
│   ├── hooks/                  # Lifecycle hooks (bash + curl)
│   └── skills/                 # memory-recall + memory-store + mnemos-setup
│
├── skills/                     # Shared skills (OpenClaw ClawHub format)
│   └── mnemos-setup/           # Setup skill
│
└── docs/DESIGN.md              # Full design document
```

## Roadmap

| Phase | What | Status |
|-------|------|--------|
| **Phase 1** | Core server + CRUD + auth + hybrid search + upsert + plugins | ✅ Done |
| **Phase 3** | LLM-assisted conflict merge, auto-tagging | 🔜 Planned |
| **Phase 4** | Web dashboard, bulk import/export, CLI wizard | 📋 Planned |

Vector Clock CRDT was deferred and removed from the roadmap.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[Apache-2.0](LICENSE)

---

<p align="center">
  <a href="https://tidbcloud.com"><img src="assets/tidb-logo.png" alt="TiDB Starter" height="36" /></a>
  <br/>
  <sub>Built with <a href="https://tidbcloud.com">TiDB Starter</a> — zero-ops database with native vector search.</sub>
</p>
