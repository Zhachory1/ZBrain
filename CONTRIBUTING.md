# Contributing to ZBrain

ZBrain is a local-first markdown/doc RAG system. Contributions keep the default
path local, auditable, and privacy-preserving.

## Prerequisites

- Node.js >= 22
- `sqlite3` CLI with FTS5 enabled (verify: `sqlite3 :memory: 'CREATE VIRTUAL TABLE x USING fts5(y);'`)

## Setup

```bash
git clone https://github.com/Zhachory1/ZBrain.git
cd ZBrain
npm install
```

## Validation

Run before opening a PR:

```bash
npm test              # node --test unit/integration suite
npm run bench:synthetic   # retrieval benchmark over public synthetic fixtures
npm run check         # test + synthetic + semantic benches
```

Benchmarks run through `scripts/local-only-runner.js` (macOS `sandbox-exec` /
Linux `unshare --net`) to smoke-test the local-only privacy boundary.

## Development workflow

Every milestone follows the flow in `docs/ROADMAP.md`:

1. PRD
2. DD (design doc)
3. Council review
4. Writing plans
5. Implementation
6. Code review
7. Docs
8. Council review
9. Push to `main`
10. Release / readout

Canonical private planning lives in `~/private-docs/projects/zbrain/`.

## Branches & PRs

- Branch from fresh `origin/main`.
- Keep PRs focused and atomic.
- Reference the issue (e.g. `issue-3`) in the branch name and PR.

## Privacy rules (non-negotiable)

- Default path stays local; no network egress except `zbrain brief --allow-network` (explicit opt-in, audited).
- `.zbrain/` holds raw indexed markdown in SQLite — it is gitignored; never commit or share it.
- Embeddings only go to a loopback Ollama endpoint.
- Metadata filters are local SQL only; they are not added to embedding prompts.

## Contracts

Keep behavior aligned with the documented contracts:

- CLI: `docs/cli-contract.md`
- MCP server: `docs/mcp-contract.md`
- Privacy model: `docs/privacy.md`
