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

## preflight

```bash
zbrain preflight <path> [--include-paths] [--json]
```

Scans Markdown corpus shape without building an index.

Default JSON avoids file paths:

```json
{
  "schemaVersion": 1,
  "preflight": {
    "documents": 3,
    "totalBytes": 1234,
    "skippedFiles": 1,
    "skippedReasons": {
      "deniedPath": 1,
      "oversized": 0,
      "symlink": 0,
      "maxDepth": 0,
      "unreadable": 0
    },
    "largestFiles": [
      { "path": null, "sizeBytes": 999 }
    ],
    "caps": {
      "maxFileBytes": 1048576,
      "maxDocuments": 20000,
      "maxTotalBytes": 104857600,
      "maxDepth": 25,
      "maxQueryMs": 5000
    },
    "fitsCaps": true,
    "warnings": []
  }
}
```

`--include-paths` adds relative paths for largest/skipped local files. Do not commit private preflight output when paths are included.

## import

```bash
zbrain import <path> [--force] [--json]
```

Creates or reuses a target-local ZBrain config, ensures target `.gitignore` contains `.zbrain/`, and builds `<path>/.zbrain/index.sqlite`.

Success:

```json
{
  "schemaVersion": 1,
  "import": {
    "configPath": ".zbrain/config.json",
    "dbPath": ".zbrain/index.sqlite",
    "configAction": "created",
    "dbAction": "created",
    "backups": {},
    "indexed": { "dbPath": ".zbrain/index.sqlite", "documents": 3 },
    "status": { "documents": 3, "chunks": 3, "dbSizeBytes": 4096 }
  }
}
```

Action enums:

- `configAction`: `created`, `reused`, `overwritten`
- `dbAction`: `created`, `overwritten`

Safety behavior:

- compatible existing config with root `.` is reused
- incompatible existing config fails unless `--force`
- existing `.zbrain/index.sqlite` fails unless `--force`
- `--force` backs up overwritten config/DB and reports relative backup paths

`.zbrain/index.sqlite` stores raw Markdown bodies/chunks locally. It is gitignored and should be treated as sensitive local data.

## index

```bash
zbrain index [--json]
```

Builds `.zbrain/index.sqlite` from Markdown. First run creates the DB. Later runs update existing DBs incrementally by document hash and report `changed`, `unchanged`, and `deleted` counts while preserving unchanged embeddings.

## Retrieval filters

`query`, `vquery`, and `hquery` accept optional local metadata filters:

```bash
--path-prefix projects/zbrain
--project zbrain
--type reports
--from-date 2026-07-01
--to-date 2026-07-31
```

Metadata derivation:

- `projects/<slug>/<type>/file.md` gives `project=<slug>` and `type=<type>`
- top-level folders give `type`, e.g. `people`, `companies`, `meetings`, `inbox`
- date is the first `YYYY-MM-DD` in the relative path
- frontmatter metadata is not parsed yet

Semantics:

- filters combine with AND
- path-prefix is POSIX relative, rejects absolute paths and `..`
- path-prefix matches exact path or segment boundary only
- project/type are exact slug matches
- dates are inclusive `YYYY-MM-DD`
- invalid dates and `from-date > to-date` are errors
- unknown retrieval flags are errors
- filters stay local SQL only; they are not added to embedding prompts

## query

```bash
zbrain query <text> [--limit N] [--project slug] [--type type] [--path-prefix path] [--from-date YYYY-MM-DD] [--to-date YYYY-MM-DD] [--json] [--no-aliases] [--explain]
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
zbrain embed [--stale] [--json]
```

Embeds current indexed chunks using configured local Ollama provider.

`--stale` skips chunks that already have an embedding for the active model and the current embedding input hash. Existing rows without an input hash are treated as stale.

Success:

```json
{ "schemaVersion": 1, "embedded": 1, "skipped": 843, "model": "mxbai-embed-large:latest" }
```

## vquery

```bash
zbrain vquery <text> [--limit N] [--project slug] [--type type] [--path-prefix path] [--from-date YYYY-MM-DD] [--to-date YYYY-MM-DD] [--json]
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
zbrain hquery <text> [--mode exact|broad|hybrid] [--limit N] [--project slug] [--type type] [--path-prefix path] [--from-date YYYY-MM-DD] [--to-date YYYY-MM-DD] [--json] [--explain]
```

Intent-aware retrieval:

- `exact` / `bm25`: BM25 + aliases
- `broad` / `vector`: vector retrieval
- `hybrid`: vector-heavy reciprocal rank fusion over BM25 and vector

Auto intent is heuristic and conservative. Exact/session/ticket/version queries stay lexical. Broad/topic/research queries use vector.

`--explain --json` includes aliases and/or source ranks when available.
