# ZBrain

Local-first brain/RAG system for docs, code, and daily work context.

ZBrain aims to merge useful ideas from QMD, gbrain, and Codescry while keeping the default path local and auditable.

## Status

M1 local doc-RAG CLI exists as alpha code:

- project-local `.zbrain/`
- SQLite/FTS5 index
- `init`, `index`, `query`, `get`, `status`
- synthetic benchmark harness
- local-only runner smoke test

No external embeddings, pgvector, MCP runtime, auto-indexing, or briefings yet.

## Requirements

- Node.js >=22
- `sqlite3` CLI with FTS5 enabled

Check SQLite/FTS5:

```bash
sqlite3 --version
sqlite3 :memory: 'CREATE VIRTUAL TABLE x USING fts5(y);'
```

## Quickstart

```bash
npm test
npm run bench:synthetic
```

Try retrieval on synthetic docs:

```bash
cd /tmp
mkdir zbrain-demo && cd zbrain-demo
cp -R /Users/zhach/code/ZBrain/fixtures/synthetic/docs ./docs
node /Users/zhach/code/ZBrain/scripts/local-only-runner.js node /Users/zhach/code/ZBrain/bin/zbrain.js init --path ./docs --json
node /Users/zhach/code/ZBrain/scripts/local-only-runner.js node /Users/zhach/code/ZBrain/bin/zbrain.js index --json
node /Users/zhach/code/ZBrain/scripts/local-only-runner.js node /Users/zhach/code/ZBrain/bin/zbrain.js query "silver kite acronym" --json
node /Users/zhach/code/ZBrain/scripts/local-only-runner.js node /Users/zhach/code/ZBrain/bin/zbrain.js get acronyms/adsb.md --from 1 --lines 4 --json
node /Users/zhach/code/ZBrain/scripts/local-only-runner.js node /Users/zhach/code/ZBrain/bin/zbrain.js status --json
```

`.zbrain/` contains local config and raw indexed markdown text in SQLite. It is gitignored.

## Local-only behavior

M1 rejects `--allow-network`. `npm run bench:synthetic` runs through `scripts/local-only-runner.js`:

- macOS: `sandbox-exec` with `(deny network*)`
- Linux: `unshare --net` when available

This is a privacy smoke test, not formal proof of no possible egress.

## Roadmap

Roadmap lives in `docs/ROADMAP.md`; canonical private planning source lives in `~/private-docs/projects/zbrain/`.
