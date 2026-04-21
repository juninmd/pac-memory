# PAC-MEMORY

Autonomous local knowledge system with collectors, full-text memory, Gemini-assisted Q&A and a live operational cockpit.

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
pnpm tsx src/cli/index.ts insights
pnpm tsx src/cli/index.ts export pac-memory-digest.md
```

## Features

- Local SQLite knowledge base with FTS5 search.
- Collectors for system, network, environment, GitHub and web monitoring.
- Live WebSocket event feed.
- Gemini-assisted summarization, categorization, Q&A and self-evolution.
- Deterministic intelligence digest for value, freshness, source coverage and operational risks.
- Related knowledge discovery.
- Markdown/JSON digest export.
- Manual cockpit controls for collection and evolution.

## Environment

Copy `.env.example` to `.env` and set what you need:

```env
GEMINI_API_KEY=
GITHUB_TOKEN=
GITHUB_USERNAME=
PORT=3000
HOST=127.0.0.1
DB_PATH=data/pac-memory.db
```

Gemini CLI is optional for the core system, but required for LLM summaries, Q&A and evolution.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
