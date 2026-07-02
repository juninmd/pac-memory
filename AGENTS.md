# AGENTS.md - PAC-MEMORY

## Tech Stack Summary

- **Runtime**: Node.js (ESM), TypeScript
- **Build**: tsc (TypeScript compiler)
- **Testing**: Vitest
- **Linting**: ESLint
- **Database**: SQLite (better-sqlite3, FTS5 full-text search)
- **LLM**: Ollama (local), LiteLLM proxy (OpenAI-compatible)
- **Web**: HTTP server, WebSocket events
- **CLI**: Commander.js
- **Key Dependencies**: better-sqlite3, commander, ws, ollama, litellm (via OpenAI-compatible API)

## Project Structure

```
pac-memory/
├── src/
│   ├── cli/           # CLI entry and commands (start, status, collect, learn, evolve, etc.)
│   ├── agents/         # Autonomous agent system
│   ├── knowledge/      # SQLite knowledge base with FTS5
│   ├── llm/            # LLM abstraction (Ollama/LiteLLM)
│   ├── learning/       # RSS autonomous learning with SSRF protection
│   ├── evolution/      # Self-evolution engine
│   ├── gemini/         # Google Gemini integration
│   ├── mcp/            # Model Context Protocol server
│   ├── publishers/     # IA Know dataset publishing
│   ├── web/            # Dashboard server
│   ├── daily/          # Daily routines
│   ├── security/       # Security utilities
│   └── shared/         # Shared types and utilities
├── data/              # SQLite database storage
├── docs/              # Architecture and plans
├── scripts/           # Build and utility scripts
├── tests/             # Test files
├── prompts/           # LLM prompt templates
└── k8s/               # Kubernetes manifests
```

## Coding Conventions

- **TypeScript**: Strict mode, ES modules (`"type": "module"`)
- **Imports**: Relative paths within src/
- **Error Handling**: Async/await with try-catch, console-based logging
- **Architecture**: Modular, CLI-driven, event-based WebSocket updates
- **Database**: Raw SQL via better-sqlite3, FTS5 for search
- **LLM Calls**: OpenAI-compatible interface (LiteLLM), fallback to direct Ollama

## Build & Test Commands

```bash
pnpm install          # Install dependencies
pnpm build            # TypeScript compilation
pnpm dev              # Run in dev mode (tsx)
pnpm test             # Run Vitest tests
pnpm test:watch       # Watch mode
pnpm lint             # ESLint
pnpm typecheck        # TypeScript check (no emit)
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_TOKEN` | - | GitHub API token |
| `GITHUB_USERNAME` | - | GitHub username |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3.1:8b` | Ollama model name |
| `LITELLM_BASE_URL` | `http://127.0.0.1:4000` | LiteLLM proxy URL |
| `LITELLM_MODEL` | `ollama/llama3.1:8b` | LiteLLM model identifier |
| `PORT` | `3000` | Dashboard server port |
| `DB_PATH` | `data/pac-memory.db` | SQLite database path |
| `CONTROL_API_TOKEN` | - | Auth token for control routes |
| `IA_KNOW_REPO_URL` | - | IA Know git repo URL |
| `IA_KNOW_AUTO_PUBLISH` | `false` | Auto-publish after learn |
| `PAPER_AGGREGATOR_ENABLED` | `true` | Enable arXiv paper collection |
