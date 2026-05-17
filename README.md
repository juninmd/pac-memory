# PAC-MEMORY

Autonomous local knowledge system with collectors, full-text memory, Ollama-assisted Q&A and a live operational cockpit.

## Run

```bash
pnpm install
pnpm dev
```

Dashboard: `http://localhost:3000`

## CLI

```bash
pnpm dev:status
pnpm tsx src/cli/index.ts search "github workflow"
pnpm tsx src/cli/index.ts agents
pnpm dev:learn
pnpm tsx src/cli/index.ts papers
pnpm tsx src/cli/index.ts publish-ia-know
pnpm tsx src/cli/index.ts insights
pnpm tsx src/cli/index.ts export pac-memory-digest.md
```

## Features

- Local SQLite knowledge base with FTS5 search.
- Collectors for system, network, environment, GitHub and web monitoring.
- Live WebSocket event feed.
- Ollama-assisted summarization, categorization, Q&A and self-evolution.
- Autonomous allowlisted RSS learning cycle with SSRF protection.
- AI/LLM paper aggregation from arXiv into the local knowledge base.
- IA Know dataset publishing with generated Markdown/JSON plus automatic git commit/push.
- Deterministic intelligence digest for value, freshness, source coverage and operational risks.
- Related knowledge discovery.
- Markdown/JSON digest export.
- Manual cockpit controls for collection and evolution.

## Environment

Copy `.env.example` to `.env` and set what you need:

```env
GITHUB_TOKEN=
GITHUB_USERNAME=
LITELLM_BASE_URL=http://127.0.0.1:4000
LITELLM_MODEL=ollama/llama3.1:8b
LITELLM_API_KEY=
LITELLM_TIMEOUT_MS=60000
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1:8b
OLLAMA_TIMEOUT_MS=60000
CONTROL_API_TOKEN=
PORT=3000
HOST=127.0.0.1
DB_PATH=data/pac-memory.db
PAPER_AGGREGATOR_ENABLED=true
PAPER_AGGREGATOR_MAX_ITEMS=50
PAPER_AGGREGATOR_QUERY=cat:cs.AI OR cat:cs.CL OR cat:cs.LG OR cat:stat.ML
IA_KNOW_REPO_URL=https://github.com/juninmd/ia-know.git
IA_KNOW_REPO_PATH=temp/ia-know
IA_KNOW_AUTO_PUBLISH=false
IA_KNOW_AUTO_PUSH=true
```

Ollama is used through LiteLLM, including the ADK coordinator. Start Ollama, pull the configured model, then expose it through the LiteLLM OpenAI-compatible proxy before running LLM-backed features:

```bash
ollama pull llama3.1:8b
OLLAMA_API_BASE=http://127.0.0.1:11434 litellm --model ollama/llama3.1:8b --port 4000
```

Autonomous learning uses built-in curated RSS sources by default. Set `LEARNING_RSS_SOURCES` and `LEARNING_ALLOWED_DOMAINS` for custom feeds before exposing it in production.

Paper aggregation uses the arXiv Atom API by default and stores relevant AI/LLM papers as `paper-aggregator` knowledge. Run `pnpm tsx src/cli/index.ts papers` to collect papers, then `pnpm tsx src/cli/index.ts publish-ia-know` to generate `docs/papers/ia-llms.md` and `docs/papers/ia-llms.json` in `IA_KNOW_REPO_PATH`, commit them, and push when `IA_KNOW_AUTO_PUSH=true`. Set `IA_KNOW_AUTO_PUBLISH=true` to publish automatically after `learn`.

The `Publish IA Know Papers` GitHub Actions workflow runs every 6 hours and can be triggered manually. Configure repository secret `IA_KNOW_PUSH_TOKEN` with write access to `juninmd/ia-know` so the workflow can push generated commits.

Set `CONTROL_API_TOKEN` in production to protect control routes such as collect, learn, evolve and source mutations. The cockpit can send this token from the local token field in Mission Control.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
See [docs/plans/pac-memory-autonomous-brain.md](docs/plans/pac-memory-autonomous-brain.md) for the autonomous brain rollout plan.
