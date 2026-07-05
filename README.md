# ZBrain

Local-first brain/RAG system for docs, code, and daily work context.

ZBrain aims to merge useful ideas from:

- QMD: thin markdown/doc RAG and small MCP surface
- gbrain: strong retrieval, automation, and durable work memory
- Codescry: code-aware indexing and retrieval

Core stance: private by default. Everything local unless user explicitly configures an external provider in a later milestone.

## Status

M0 implementation scaffold is local-only and benchmark-focused.

Current M0 includes:

- synthetic benchmark fixture
- BM25 benchmark adapter
- local-only network-denied runner
- aggregate-only private report rules
- eval/privacy/MCP draft docs

M0 does **not** include product retrieval, MCP runtime, external embeddings, pgvector, auto-indexing, or briefings.

## Quickstart

Requires Node.js >=22.

```bash
npm test
npm run bench:synthetic
```

Expected:

- all tests pass
- synthetic benchmark writes:
  - `.cache/synthetic-results.json`
  - `.cache/synthetic-results.md`

Run help:

```bash
node bin/zbrain.js help
```

## Local-only behavior

M0 rejects `--allow-network`. `npm run bench:synthetic` runs through `scripts/local-only-runner.js`:

- macOS: `sandbox-exec` with `(deny network*)`
- Linux: `unshare --net` when available

## Roadmap

Roadmap lives in `docs/ROADMAP.md`; canonical private planning source lives in `~/private-docs/projects/zbrain/`.
