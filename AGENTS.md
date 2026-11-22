# AGENTS.md

PAC-MEMORY: a local, autonomous knowledge base. It collects signals from the machine, the network, GitHub and the web, stores them in SQLite with FTS5, and shows them in a live cockpit. Runs on Node.js with TypeScript (ESM).

## Stack
- Node.js (ESM, `"type": "module"`), TypeScript strict. Container image on `node:26-slim`
- SQLite via `better-sqlite3`, FTS5 full-text search
- LLM: Ollama (local default) or a LiteLLM proxy (OpenAI-compatible). Other providers are configurable in `.env.example`
- Web: HTTP server with WebSocket events. CLI: Commander. MCP server in `src/mcp/`
- Tests: Vitest. Lint: ESLint

## Commands
- Install: `pnpm install`
- Dev (collect, learn, cockpit and web): `pnpm dev`. Single tasks: `pnpm dev:collect`, `pnpm dev:learn`, `pnpm dev:evolve`, `pnpm dev:web`, `pnpm dev:status`, `pnpm dev:insights`, `pnpm dev:export`, `pnpm dev:mcp`
- Build: `pnpm build` (tsc, then copies the web assets). Run the build: `pnpm start`
- Test: `pnpm test` (`vitest run`); watch mode: `pnpm test:watch`
- Lint: `pnpm lint` (ESLint on `src/`). Typecheck: `pnpm typecheck`

## Structure
- `src/cli/`: CLI entry point and commands
- `src/agents/`: autonomous agents (env, GitHub, network, system, web monitor, orchestrator)
- `src/knowledge/`: SQLite knowledge base, FTS5 search, categorizer, embedder, summarizer, insights
- `src/llm/`: LLM client abstraction (Ollama, LiteLLM)
- `src/learning/`: RSS and arXiv learning sources and cycle
- `src/evolution/`: self-evolution (gap analysis, code generation, validation, deploy)
- `src/mcp/`, `src/publishers/` (IA Know dataset), `src/web/` (dashboard, routes, auth), `src/daily/` (digest), `src/security/` (URL policy), `src/shared/` (config, events, logger, types)
- `prompts/`: LLM prompt templates. `docs/`: architecture and plans. `k8s/`: manifests. `scripts/`: build helpers. `tests/`: Vitest suites
- `data/`: SQLite file, created at runtime (`DB_PATH`, default `data/pac-memory.db`)

## Conventions
- Strict TypeScript, ES modules, relative imports within `src/`
- Raw SQL through `better-sqlite3`; FTS5 for search
- Async/await with try/catch; console-based logging, with `LOG_LEVEL`
- Modular and CLI-driven. Real-time updates go through WebSocket events
- LLM calls use the OpenAI-compatible interface (LiteLLM), with fallback to direct Ollama
- Configuration is read from environment variables. `.env.example` is the full list; keep it in sync when you add one

## Gotchas
- **Outbound fetches** for learning sources go through `src/security/url-policy.ts` (SSRF protection, domain allowlist via `LEARNING_ALLOWED_DOMAINS`). Any new fetch must use it
- **Control routes** require `CONTROL_API_TOKEN`. If it is unset, `src/shared/config.ts` generates an ephemeral token and prints it to the log. Always set it explicitly before exposing the dashboard
- **IA Know publishing:** `IA_KNOW_AUTO_PUBLISH` publishes after `learn`, and `IA_KNOW_AUTO_PUSH` pushes to `IA_KNOW_REPO_URL`. Check both before enabling them
- **Deploy:** the Kubernetes manifest runs one replica of the app (`ghcr.io/juninmd/pac-memory:latest`) next to a LiteLLM deployment. SQLite is a single-writer store; keep one replica
- **Secrets:** `GITHUB_TOKEN`, LLM keys and `CONTROL_API_TOKEN` come only from the environment. Never commit them

<!-- base-actions-main-policy -->
## GitHub Actions — padrão obrigatório (@main)

- Referencie as actions internas sempre pelo branch, nunca por SHA:
  - `uses: juninmd/base-actions/<action>@main`
  - `uses: juninmd/base-actions/.github/workflows/<arquivo>.yml@main`
- Não fixe `@<sha>` em `juninmd/base-actions`: a atualização é centralizada no
  `main` e passa a valer no próximo run.
- PRs cujos checks não iniciam por billing/spending limit são mesclados pelo bot central
  `juninmd/base-actions/.github/workflows/auto-merge-billing-blocked.yml`.
  Para impedir o merge automático de um PR, aplique a label `do-not-merge`.