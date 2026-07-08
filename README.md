# ZBrain

Local-first markdown/doc RAG system for private work context.

ZBrain aims to merge useful doc-retrieval ideas from QMD and gbrain while keeping the default path local and auditable. It indexes markdown only; markdown files inside code folders are fine, raw code retrieval is out of scope.

## Status

Current local markdown/doc-RAG CLI exists:

- project-local or full-brain `.zbrain/`
- explicit local query aliases
- SQLite/FTS5 index
- `init`, `preflight`, `import`, `index`, `query`, `search`, `hquery`, `answer`, `get`, `status`
- local embeddings through loopback Ollama
- incremental indexing and `embed --stale`
- metadata filters
- local stdio MCP server: `zbrain-mcp --root <brain>`
- synthetic benchmark harness
- local-only runner smoke test

No pgvector, remote MCP transport, auto-indexing daemon, or briefings yet.

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

`.zbrain/` contains local config and raw indexed markdown text in SQLite. It is gitignored and should be treated as sensitive local data.

## Full brain import

M18 adds a safe first step toward indexing `~/private-docs` as one local brain.

Preflight scans aggregate corpus shape without building an index. Default output avoids file paths; use `--include-paths` only when you need relative largest/skipped file paths locally.

```bash
zbrain preflight ~/private-docs --json
zbrain preflight ~/private-docs --include-paths --json
```

Import creates or reuses `~/private-docs/.zbrain/config.json`, ensures `~/private-docs/.gitignore` contains `.zbrain/`, and builds `~/private-docs/.zbrain/index.sqlite`.

```bash
zbrain import ~/private-docs --json
cd ~/private-docs
zbrain query "what did we decide about vector-heavy hybrid?" --json
```

`import` is non-destructive by default. It fails if the target has an incompatible `.zbrain/config.json` or an existing `.zbrain/index.sqlite`; pass `--force` to back up and overwrite local ZBrain state.

The index stores raw Markdown bodies/chunks locally in SQLite. It is not uploaded by ZBrain, but do not commit or share `.zbrain/`.

After first import, maintain the index from inside the target repo:

```bash
cd ~/private-docs
zbrain index --json
zbrain embed --stale --json
zbrain hquery "what did we decide about vector-heavy hybrid?" --json
```

`index` updates changed/deleted Markdown docs incrementally when an index already exists. `embed --stale` embeds only chunks missing the active model's current embedding input hash.

Narrow retrieval with local metadata filters:

```bash
zbrain query "hybrid" --project zbrain --type reports --from-date 2026-07-01 --json
zbrain hquery "vector retrieval" --path-prefix projects/zbrain --json
```

Filters are local SQL only. They are not added to embedding prompts. Metadata is path-derived: `projects/<slug>/<type>/...` sets project/type, top-level folders set type, and the first `YYYY-MM-DD` in the relative path sets date.

Use a gbrain-like search command:

```bash
zbrain search "vector-heavy hybrid" --project zbrain
zbrain search "semantic retrieval" --mode broad --project zbrain --json
```

Get an extractive cited evidence digest:

```bash
zbrain answer "what did we decide about vector-heavy hybrid?" --project zbrain --json
```

`answer` defaults to exact/BM25 mode and quotes indexed source lines with citations. It reports `evidence_found`, `weak_evidence`, or `insufficient_evidence`; it does not generate abstractive answers.

Run local MCP server for agents:

```bash
zbrain-mcp --root ~/private-docs
```

Example MCP config:

```json
{
  "mcpServers": {
    "zbrain": {
      "command": "zbrain-mcp",
      "args": ["--root", "/Users/zhach/private-docs"]
    }
  }
}
```

MCP tools are read-only and bounded. Tool output can contain private snippets/paths; local MCP clients are trusted to see them.

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

Embed only missing or stale chunks after an incremental index:

```bash
zbrain embed --stale --json
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
- explicit `--mode hybrid` runs vector-heavy offline RRF over BM25 and vector results

```bash
zbrain hquery "session 2026-06-30 mewrite release" --json
zbrain hquery "papers about quantum materials" --json
zbrain hquery "papers about quantum materials" --mode hybrid --explain --json
```

`hquery` is explicit; regular `query` behavior is unchanged.
