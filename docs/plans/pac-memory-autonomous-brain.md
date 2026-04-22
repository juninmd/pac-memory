# PAC-MEMORY Autonomous Brain Plan

## Goal

Turn PAC-MEMORY into a continuously running personal knowledge brain that can safely learn from internet sources, categorize knowledge, connect related facts, and expose an operational cockpit for cloud deployment on Kubernetes.

## Principles

- The knowledge database is the source of truth. LLM output enriches records, but does not replace provenance.
- Every learned item must carry source, category, summary, confidence, freshness, and metadata.
- Internet collection is allowlisted, rate-limited, and protected against SSRF.
- Ollama is the default model runtime for private cloud operation, exposed to the app through LiteLLM.
- The web server, scheduler, worker behavior, and cockpit controls share the same cycle code.
- The system must degrade gracefully when Ollama is unavailable.

## Target Architecture

### Runtime Processes

- `pac-memory-api`: Fastify dashboard, API routes, WebSocket events, auth/control plane.
- `pac-memory-worker`: learning, enrichment, summarization, categorization, embeddings later.
- `pac-memory-scheduler`: cron triggers for collect, learn, evolve, verify, prune.
- `litellm`: private OpenAI-compatible LLM gateway used by the app and ADK.
- `ollama`: private in-cluster model runtime with persistent model cache.

The current single-process CLI can host all roles for local development. Kubernetes should eventually split roles by command and deployment.

### Learning Pipeline

1. Load active sources from config/database.
2. Validate each URL through an allowlist and SSRF guard.
3. Fetch RSS/feed content with timeout and size limits.
4. Normalize title, content, link, publication date, and source metadata.
5. Deduplicate through the existing `title + source` upsert boundary.
6. Summarize through LiteLLM/Ollama when a summary is missing.
7. Categorize through LiteLLM/Ollama when a category is missing or `uncategorized`.
8. Store enriched knowledge in SQLite/FTS5.
9. Emit operational events for dashboard refresh.

### Knowledge Model

The existing `knowledge` table remains the durable base. Enrichment fields that do not yet deserve columns live in `metadata`:

- `url`
- `pubDate`
- `learnedAt`
- `confidence`
- `freshness`
- `sourceType`
- `litellmModel`

When query and analytics needs grow, promote these metadata fields into indexed columns.

### Security Controls

- `LEARNING_ALLOWED_DOMAINS` controls internet collection.
- Only `http` and `https` URLs are accepted, with `https` expected for production.
- DNS resolution rejects private, loopback, link-local, multicast, and unspecified addresses.
- Requests use timeout and content-size limits.
- No arbitrary URL fetch route is exposed publicly.
- Control routes should be protected with an API token before internet exposure.
- Kubernetes should run the container as non-root, with a PVC for `data`, restricted NetworkPolicies, and LiteLLM/Ollama accessible only inside the namespace.

## Implementation Phases

### Phase 1 - Foundation

- Add LiteLLM-backed Ollama abstraction.
- Move summarization/categorization to the provider abstraction.
- Add URL safety policy.
- Add autonomous learning contracts and RSS cycle.
- Expose `learn` in CLI and `/api/control/learn`.
- Add tests for provider fallback and URL policy.

### Phase 2 - Operational Hardening

- Add API token middleware for control routes.
- Add source registry CRUD.
- Add learning status/digest route.
- Add dashboard cards for learning queue, source health, blocked URLs, and LiteLLM/Ollama health.
- Add Kubernetes manifests for API, worker, scheduler, LiteLLM, and Ollama.

Current status:

- Control routes and source mutations are protected when `CONTROL_API_TOKEN` is set.
- RSS sources can be listed, created, updated, and deleted through `/api/sources`.
- The cockpit can trigger `LEARN` and stores the control token in browser local storage.

### Phase 3 - Knowledge Quality

- Add semantic embeddings and vector search.
- Add stale fact verification cycles.
- Add entity extraction.
- Add relation graph.
- Add daily/weekly briefing generation.

### Phase 4 - Autonomy

- Let evolution suggest new safe sources, but require allowlist approval.
- Add pruning of low-value duplicates.
- Add topic goals and coverage scoring.
- Add alerts when important categories stop receiving updates.

## First Implementation Slice

This rollout starts Phase 1: LiteLLM/Ollama provider, safe RSS learning cycle, CLI/API entrypoints, and focused tests.
