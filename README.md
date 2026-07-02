# PAC-MEMORY

[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6.svg)]()
[![Node.js](https://img.shields.io/badge/Runtime-Node.js-339933.svg)]()
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)]()

> **Autonomous Knowledge & Self-Evolution System**. Sistema de conhecimento local autônomo com coletores, memória full-text, Q&A assistida por Ollama e cockpit operacional ao vivo.

## ✨ Funcionalidades

- **Base de Conhecimento Local**: SQLite com busca FTS5
- **Coletores**: Sistema, rede, ambiente, GitHub e web monitoring
- **Live WebSocket**: Feed de eventos ao vivo no cockpit
- **Ollama Integration**: Sumarização, categorização, Q&A e auto-evolução
- **RSS Learning**: Ciclo de aprendizado autônomo com proteção SSRF
- **Paper Aggregator**: Coleta de artigos AI/LLM do arXiv
- **IA Know Publishing**: Geração de Markdown/JSON com git commit/push automático
- **Relatórios**: Digest de inteligência (valor, frescor, cobertura, riscos)
- **CLI Completa**: Comandos para coleta, aprendizado, evolução, exportação

## 🛠️ Tech Stack

| Categoria | Tecnologias |
|-----------|------------|
| **Runtime** | Node.js, TypeScript |
| **Banco** | SQLite (FTS5) |
| **LLM** | Ollama, LiteLLM |
| **CLI** | Commander-based |
| **Dashboard** | Web (HTTP + WebSocket) |
| **Build** | TypeScript (tsc) |
| **Linting** | ESLint |
| **Testing** | Vitest |

## 📦 Instalação

```bash
pnpm install
```

## ⚙️ Ambiente

Copie `.env.example` para `.env`:

```env
GITHUB_TOKEN=
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1:8b
LITELLM_BASE_URL=http://127.0.0.1:4000
PORT=3000
DB_PATH=data/pac-memory.db
```

Inicie o Ollama + LiteLLM:

```bash
ollama pull llama3.1:8b
OLLAMA_API_BASE=http://127.0.0.1:11434 litellm --model ollama/llama3.1:8b --port 4000
```

## 🚀 Uso

```bash
pnpm dev              # Iniciar cockpit
pnpm dev:status       # Status do sistema
pnpm dev:collect      # Coletar dados
pnpm dev:learn        # Ciclo de aprendizado
pnpm dev:evolve       # Auto-evolução
pnpm dev:insights     # Gerar insights
pnpm dev:export       # Exportar digest
pnpm dev:mcp          # MCP server
```

Dashboard: `http://localhost:3000`

## 🏗️ Arquitetura

```
pac-memory/
├── src/
│   ├── cli/          # CLI commands
│   ├── agents/       # Agent system
│   ├── knowledge/    # Knowledge base (SQLite)
│   ├── llm/          # LLM integration (Ollama/LiteLLM)
│   ├── learning/     # RSS learning engine
│   ├── evolution/    # Self-evolution
│   ├── gemini/       # Gemini integration
│   ├── mcp/          # MCP protocol
│   ├── publishers/   # IA Know publishing
│   ├── web/          # Web dashboard
│   └── shared/       # Shared utilities
├── data/             # SQLite database
├── docs/             # Architecture docs
└── scripts/          # Build scripts
```

## 📄 Licença

ISC
