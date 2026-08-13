# ZBrain: local-first RAG for your private work context

Your most useful context — decisions, PRDs, meeting notes, incident write-ups —
lives in markdown you'd never want to hand to a hosted RAG service. ZBrain is
built for exactly that: a **local-first markdown/doc RAG** where the default path
is local and auditable.

## What it is

ZBrain indexes your markdown into a searchable brain you can query from the CLI
or serve to AI agents over MCP. It merges useful doc-retrieval ideas from QMD and
gbrain while keeping everything on your machine by default. It indexes **markdown
only** — markdown inside code folders is fine, but raw code retrieval is out of
scope.

`.zbrain/` holds the local config and the indexed markdown text in SQLite. It's
gitignored and should be treated as sensitive local data.

## What works today

- Project-local or full-brain `.zbrain/`
- SQLite/FTS5 index with incremental indexing (`embed --stale`)
- Commands: `init`, `preflight`, `import`, `index`, `query`, `search`, `hquery`,
  `answer`, `get`, `status`
- Local embeddings through a loopback Ollama instance
- Metadata filters and explicit local query aliases
- A local stdio MCP server: `zbrain-mcp --root <brain>`
- A synthetic benchmark harness and a local-only runner smoke test

Not yet: pgvector, remote MCP transport, an auto-indexing daemon, or briefings.

## Query your own brain in a few steps

```bash
git clone https://github.com/Zhachory1/ZBrain.git
cd ZBrain && npm install
npm link                              # puts zbrain / zbrain-mcp on PATH

cd ~/private-docs                     # your markdown corpus
zbrain import ~/private-docs --json   # build local .zbrain/index.sqlite
zbrain embed --stale --json           # optional: local Ollama embeddings
zbrain answer "what did we decide about X?" --json

zbrain-mcp --root ~/private-docs      # serve the brain to MCP agents
```

You need Node.js >= 22 and the `sqlite3` CLI with FTS5 enabled.

## Local by default, on purpose

The design bias is auditability. `preflight` lets you scan the shape of a corpus
— aggregate stats — **before** building an index, and its default output avoids
file paths unless you explicitly ask for them with `--include-paths`. Embeddings
run through loopback Ollama, not a remote API. Nothing leaves your machine unless
you make it.

That's the whole pitch: the retrieval layer for your private context should be
something you can read, run, and trust locally. Full command and server
references live in [`docs/cli-contract.md`](../docs/cli-contract.md) and
[`docs/mcp-contract.md`](../docs/mcp-contract.md).
