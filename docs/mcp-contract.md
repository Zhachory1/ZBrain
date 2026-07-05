# ZBrain MCP contract draft

M0 does not implement MCP. M0 only drafts the future M1 contract.

M1 may expose three tools if this does not delay CLI-first retrieval readout:

- `query`
- `get`
- `status`

All responses include `schemaVersion`.

## Shared result shape

```json
{
  "id": "doc-id-or-path",
  "title": "Document title",
  "score": 0.98,
  "provenance": {
    "collection": "docs",
    "path": "releases/v1.md",
    "lineStart": 1,
    "lineEnd": 8
  },
  "snippet": "..."
}
```

## query

Request:

```json
{
  "schemaVersion": 0,
  "query": "release note",
  "limit": 10
}
```

Response:

```json
{
  "schemaVersion": 0,
  "results": []
}
```

## get

Request:

```json
{
  "schemaVersion": 0,
  "id": "releases/v1.md",
  "fromLine": 1,
  "maxLines": 80
}
```

Response:

```json
{
  "schemaVersion": 0,
  "document": {
    "id": "releases/v1.md",
    "title": "ZBrain v1 release note",
    "content": "...",
    "provenance": { "path": "releases/v1.md" }
  }
}
```

## status

Response:

```json
{
  "schemaVersion": 0,
  "capabilities": ["query", "get", "status"],
  "localOnly": true,
  "collections": []
}
```

## Error envelope

```json
{
  "ok": false,
  "error": {
    "code": "not_indexed",
    "message": "Collection not indexed",
    "retryable": false
  }
}
```

Error codes start closed:

- `not_indexed`
- `invalid_request`
- `not_found`
- `permission_denied`
- `internal_error`

Until v1, schema changes are additive only.
