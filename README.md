# ZBrain

Local-first brain/RAG system for docs, code, and daily work context.

ZBrain aims to merge useful ideas from QMD, gbrain, and Codescry while keeping the default path local and auditable.

## Status

M1 local doc-RAG CLI exists:

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
REPO=$(pwd)
DEMO=$(mktemp -d)
mkdir -p "$DEMO"
cp -R "$REPO/fixtures/synthetic/docs" "$DEMO/docs"
cd "$DEMO"
node "$REPO/scripts/local-only-runner.js" node "$REPO/bin/zbrain.js" init --path ./docs --json
node "$REPO/scripts/local-only-runner.js" node "$REPO/bin/zbrain.js" index --json
node "$REPO/scripts/local-only-runner.js" node "$REPO/bin/zbrain.js" query "silver kite acronym" --json
node "$REPO/scripts/local-only-runner.js" node "$REPO/bin/zbrain.js" get acronyms/adsb.md --from 1 --lines 4 --json
node "$REPO/scripts/local-only-runner.js" node "$REPO/bin/zbrain.js" status --json
```

`.zbrain/` contains local config and raw indexed markdown text in SQLite. It is gitignored.

## Local-only behavior

M1 rejects `--allow-network`. `npm run bench:synthetic` runs through `scripts/local-only-runner.js`:

- macOS: `sandbox-exec` with `(deny network*)`
- Linux: `unshare --net` when available

This is a privacy smoke test, not formal proof of no possible egress.

## Roadmap

Roadmap lives in `docs/ROADMAP.md`; canonical private planning source lives in `~/private-docs/projects/zbrain/`.

## Semantic fixture smoke

M2 adds a synthetic semantic-gap fixture. It validates fixture shape only; it does not recommend embeddings or semantic retrieval.

```bash
npm run bench:semantic
```

Outputs:

- `.cache/semantic-results.json`
- `.cache/semantic-results.md`
- `.cache/semantic-readout.md`
