# ZBrain CLI contract draft

M1 CLI is local-only and retrieval-focused. `--allow-network` is rejected.

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

Creates `.zbrain/config.json` and ensures `.zbrain/` is in `.gitignore`. In M1, `<dir>` must stay inside the current project directory.

JSON success:

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
zbrain query <text> [--limit N] [--json]
```

JSON success:

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
- no phrase support in M1
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
