# ZBrain CLI contract

M4 CLI is local-only and retrieval-focused. `--allow-network` is rejected.

## Common error envelope for `--json`

```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "invalid_request",
    "message": "query is required",
    "retryable": false
  }
}
```

## init

```bash
zbrain init --path <dir> [--force] [--json]
```

Creates `.zbrain/config.json` and ensures `.zbrain/` is in `.gitignore`. In M1/M4, `<dir>` must stay inside the current project directory.

Success:

```json
{ "configPath": ".zbrain/config.json", "root": "docs" }
```

## index

```bash
zbrain index [--json]
```

Builds `.zbrain/index.sqlite` from markdown.

## query

```bash
zbrain query <text> [--limit N] [--json] [--no-aliases] [--explain]
```

Result:

```json
{
  "schemaVersion": 1,
  "results": [
    {
      "id": "releases/v1.md",
      "chunkId": "releases/v1.md#0",
      "title": "ZBrain v1 release note",
      "rank": 1,
      "score": 12.3,
      "provenance": {
        "path": "releases/v1.md",
        "lineStart": 1,
        "lineEnd": 40,
        "hash": "abc123"
      },
      "snippet": "..."
    }
  ]
}
```

Query grammar:

- Unicode word/number tokenizer
- lowercase
- no raw FTS syntax
- no phrase support in M1/M4 FTS
- OR across sanitized terms
- empty query is invalid
- rank is authoritative; score is higher-is-better normalized relevance

## get

```bash
zbrain get <documentId> [--from N] [--lines N] [--json]
```

`get` accepts document ids from query `id`, not chunk ids.

## status

```bash
zbrain status [--json]
```

Reports DB, SQLite/FTS5, document, chunk, and size status.

## bench

```bash
zbrain bench --manifest <path> [--mode bm25] [--json out.json] [--md out.md]
```

Synthetic per-query rows require:

```bash
--allow-raw-public-report
```

Private repo-bound reports are aggregate-only.

## Alias config

M4 supports explicit query-time aliases in `.zbrain/config.json`:

```json
{
  "schemaVersion": 1,
  "root": "docs",
  "aliases": {
    "sign-in": ["login", "authentication"]
  }
}
```

Validation limits:

- max aliases: 200
- max expansions per alias: 10
- max key length: 80 chars
- max value length: 80 chars
- string keys and string-array values only
- no regex

Matching:

- exact normalized phrase match
- ordered/adjacent terms only
- no token-anywhere matching

Flags:

- `--no-aliases`: bypass expansion
- `--explain --json`: include `query.aliasesApplied`

Example explain shape:

```json
{
  "schemaVersion": 1,
  "query": {
    "aliasesApplied": [
      { "term": "sign-in", "expanded": ["login", "authentication"] }
    ]
  },
  "results": []
}
```

## embed

```bash
zbrain embed [--json]
```

Embeds current indexed chunks using configured local Ollama provider.

## vquery

```bash
zbrain vquery <text> [--limit N] [--json]
```

Returns vector/cosine ranked results with the same result shape as `query` plus:

```json
{
  "query": {
    "retrievalMode": "vector",
    "scoreKind": "cosine",
    "embeddingModel": "mxbai-embed-large:latest",
    "dims": 1024
  }
}
```

Embedding config supports local Ollama loopback only.

## tune

```bash
zbrain tune --manifest <manifest.json> --output <proposal.json> [--json]
```

Runs BM25 benchmark over the manifest and writes editable alias suggestions for missed queries. It does not modify `.zbrain/config.json`.

Private manifests must write output under `~/.zbrain/tuning/`.

Proposal shape:

```json
{
  "schemaVersion": 1,
  "aliases": {
    "sign problem": ["login", "authentication"]
  },
  "evidence": {
    "sign problem": { "queryId": "q1", "rank": null }
  },
  "warning": "manual_review_required"
}
```

## hquery

```bash
zbrain hquery <text> [--mode exact|broad|hybrid] [--limit N] [--json] [--explain]
```

Intent-aware retrieval:

- `exact` / `bm25`: BM25 + aliases
- `broad` / `vector`: vector retrieval
- `hybrid`: reciprocal rank fusion over BM25 and vector

Auto intent is heuristic and conservative. Exact/session/ticket/version queries stay lexical. Broad/topic/research queries use vector.

`--explain --json` includes aliases and/or source ranks when available.
