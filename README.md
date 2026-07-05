# ZBrain

Local-first brain/RAG system for docs, code, and daily work context.

ZBrain aims to merge the useful parts of:

- QMD: thin markdown/doc RAG and small MCP surface
- gbrain: strong retrieval, automation, and durable work memory
- Codescry: code-aware indexing and retrieval

Core stance: private by default. Everything local unless user explicitly configures an external embedding provider.

## Goals

- Local-first document and code retrieval
- Optional external embedding adapters
- Optional SQLite or pgvector/Postgres storage
- Automatic content tracking and embedding
- Morning briefings and EOD summaries
- MCP-friendly interface
- Performance target: <10s average retrieval, preferably <5s
- Quality target: >=70% recall on private-docs and selected RAG evals

## Status

Planning. Roadmap lives in `docs/ROADMAP.md` and the private planning source of truth lives in `~/private-docs/projects/zbrain/`.
