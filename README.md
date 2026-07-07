# ZBrain

Local-first markdown/doc RAG system for private work context.

ZBrain aims to merge useful doc-retrieval ideas from QMD and gbrain while keeping the default path local and auditable. It indexes markdown only; markdown files inside code folders are fine, raw code retrieval is out of scope.

## Status

M4 local markdown/doc-RAG CLI exists:

- project-local `.zbrain/`
- explicit local query aliases
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


## Alias expansion

Aliases are explicit local config in `.zbrain/config.json`. They are query-time only and never generated automatically.

```json
{
  "schemaVersion": 1,
  "root": "docs",
  "aliases": {
    "sign-in": ["login", "authentication"]
  }
}
```

Use aliases:

```bash
node "$REPO/scripts/local-only-runner.js" node "$REPO/bin/zbrain.js" query "sign-in problem" --json
```

Disable aliases for one query:

```bash
node "$REPO/scripts/local-only-runner.js" node "$REPO/bin/zbrain.js" query "sign-in problem" --no-aliases --json
```

Inspect aliases applied:

```bash
node "$REPO/scripts/local-only-runner.js" node "$REPO/bin/zbrain.js" query "sign-in problem" --explain --json
```

Aliases may reveal private vocabulary. `.zbrain/` is gitignored.

## Local embeddings

M6 adds local Ollama embeddings for markdown chunks.

Configure `.zbrain/config.json` (defaults shown):

```json
{
  "schemaVersion": 1,
  "root": "docs",
  "embeddings": {
    "provider": "ollama",
    "baseUrl": "http://127.0.0.1:11434",
    "model": "mxbai-embed-large:latest"
  }
}
```

Embed chunks:

```bash
zbrain embed --json
```

Vector query:

```bash
zbrain vquery "manual release workflow" --json
```

ZBrain only allows loopback Ollama URLs. Chunk/query text is sent to your local Ollama process; if your Ollama setup forwards remotely, that is outside ZBrain's privacy guarantee.

## Retrieval calibration

M8 adds local alias proposal generation. It never edits config automatically.

```bash
node "$REPO/scripts/local-only-runner.js" node "$REPO/bin/zbrain.js" tune \
  --manifest fixtures/synthetic/manifest.json \
  --output "$DEMO/proposal.json" \
  --json
```

Private manifests must write proposals under `~/.zbrain/tuning/`.

## Intent-aware query

`hquery` chooses a retrieval path from the query shape:

- exact/session/ticket/version-like queries use BM25 + aliases
- broad/topical queries use vector retrieval
- explicit `--mode hybrid` runs offline RRF over BM25 and vector results

```bash
zbrain hquery "session 2026-06-30 mewrite release" --json
zbrain hquery "papers about quantum materials" --json
zbrain hquery "papers about quantum materials" --mode hybrid --explain --json
```

`hquery` is explicit; regular `query` behavior is unchanged.
