# PAC-MEMORY Architecture

PAC-MEMORY is an autonomous local knowledge system. It collects signals from the machine, network, environment, GitHub and web feeds, stores them in SQLite with full-text search, then exposes a cockpit for search, Q&A, operational control and self-evolution.

## Architectural Layers

1. **Collectors**
   - Location: `src/agents`
   - Purpose: gather raw knowledge from local and remote sources.
   - Contract: every collector returns `KnowledgeInput[]`.

2. **Knowledge Core**
   - Location: `src/knowledge`
   - Purpose: SQLite persistence, FTS5 search, categorization, summarization, analytics and related-item discovery.
   - Database schema lives in `schema.ts`; repository functions are the persistence boundary.

3. **Orchestration**
   - Location: `src/agents/orchestrator.agent.ts`
   - Purpose: schedules collectors, emits live events, runs manual collection and evolution cycles.
   - Evolution uses gap analysis plus generated collector validation/deployment.

4. **Interfaces**
   - CLI: `src/cli/index.ts`
   - Web API: `src/web/routes`
   - Cockpit UI: `src/web/public`

## Current Capabilities

- Full-text knowledge search with FTS5.
- Local Q&A over retrieved knowledge through LiteLLM-backed Ollama behavior.
- Live WebSocket log of agents and evolution events.
- Manual run controls for collection and evolution.
- Intelligence digest with health, value density, stale knowledge, source coverage and recommended actions.
- Related knowledge discovery per entry.
- Markdown/JSON digest export.
- CLI commands for status, search, agents, insights and export.

## Key Decisions

- **SQLite remains the system of record.** It is enough for local autonomous memory, supports FTS5, and keeps deployment simple.
- **Insights are deterministic by default.** The cockpit should remain useful when LiteLLM/Ollama is unavailable.
- **LLM use is additive.** LiteLLM-backed Ollama improves summaries, categorization, Q&A and evolution, but the core can still collect, search and diagnose locally.
- **Generated collectors are isolated.** Evolution writes to `generated/` and validates TypeScript before deployment.
- **The dashboard is operational.** It can trigger collection/evolution and export digests, not just display data.

## Extension Points

- Add a collector in `src/agents` returning `KnowledgeInput[]`.
- Register the collector in `runFullCollection()` and `startScheduler()`.
- Add richer scoring in `src/knowledge/insights.ts`.
- Add API routes under `src/web/routes` and register them in `server.ts`.
- Add cockpit widgets in `src/web/public/index.html`, `app.js` and `styles.css`.

## Deployment Notes

- The app listens on `HOST` and `PORT`, with `127.0.0.1:3000` as the local default.
- Docker and Kubernetes manifests already exist.
- GitHub Actions should use the reusable Docker action from `juninmd/base-actions` when publishing GHCR images.
- ArgoCD deployment should be coordinated through `D:\Solutions\pessoal\app-charts`.
