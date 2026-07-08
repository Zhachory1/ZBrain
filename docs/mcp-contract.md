# ZBrain MCP contract

M22 implements a local stdio MCP-compatible server:

```bash
zbrain-mcp --root /absolute/path/to/brain
```

Root can also come from `ZBRAIN_ROOT`, or from cwd only when cwd contains `.zbrain/config.json`. Tool calls do not accept per-call roots.

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

## Tools

- `zbrain.search` — ranked retrieval, exact/BM25 by default
- `zbrain.get` — bounded excerpt from indexed document id
- `zbrain.answer` — extractive cited evidence
- `zbrain.status` — index status + effective root

All tools are read-only and bounded. Output may include private snippets and paths; local MCP clients are trusted to see them.

## Wire behavior

Supported methods:

- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call`

Responses are JSON-RPC 2.0. Tool results use MCP content blocks:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{ "type": "text", "text": "{...JSON payload...}" }],
    "isError": false
  }
}
```

Tool errors use `isError: true` with payload:

```json
{
  "schemaVersion": 1,
  "error": { "code": "invalid_request", "message": "...", "nextStep": "..." },
  "truncated": false
}
```

## Tool inputs

### zbrain.search

```json
{ "query": "hybrid", "mode": "exact", "limit": 10, "filters": { "project": "zbrain" } }
```

- `mode`: `exact`, `broad`, or `hybrid`; default `exact`
- `limit`: 1-20

### zbrain.get

```json
{ "id": "projects/zbrain/reports/M21-cited-evidence-api.md", "from": 1, "lines": 40 }
```

- `id`: indexed document id from search results or answer evidence `documentId`
- `from`: 1-5000
- `lines`: 1-200, default 40

### zbrain.answer

```json
{ "query": "vector-heavy hybrid", "mode": "exact", "limit": 5, "filters": { "project": "zbrain" } }
```

Returns M21 cited evidence JSON with `documentId` added to citations/evidence.

### zbrain.status

```json
{}
```

Returns:

```json
{ "schemaVersion": 1, "effectiveRoot": "/abs/root", "status": { "dbExists": true, "documents": 1, "chunks": 1 } }
```

## Bounds

- response max: 100 KB
- process output budget: 1 MB
- exact/get/status deadline: 10s
- broad/hybrid/answer with embeddings: 35s
- caps are accidental-output controls, not malicious-client exfiltration prevention
