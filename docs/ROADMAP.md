# ZBrain Roadmap

Canonical private roadmap: `~/private-docs/projects/zbrain/plans/2026-07-05-roadmap.md`.

## Approved scope

Only M0/M1 are approved as roadmap scope. M2+ are candidate backlog and need new approval after M1 readout.

## Required milestone flow

Every milestone follows:

1. PRD
2. DD
3. Council review
4. writing-plans
5. Implementation
6. code-review
7. Docs
8. Council review
9. Push to main
10. Release/readout

## Current status

M0 PRD/DD passed council. M0 implementation scaffold exists locally and is under final implementation/docs council review.

## Milestones

### M0 — charter, eval harness, privacy smoke test

Goal: freeze measurement and smoke-test local-only privacy boundary before retrieval work.

Outputs:

- product charter
- benchmark harness
- synthetic public fixtures
- private eval boundary
- local-only no-network smoke test
- QMD BM25 baseline plan
- MCP/CLI schema draft

### M1 — thin local doc-RAG MVP

Goal: smallest useful local markdown retrieval tool.

Outputs:

- collection config
- markdown crawler/chunker
- SQLite BM25 index
- `query`, `get`, `status` CLI
- optional stdio MCP shim if it does not delay retrieval readout
- provenance and line ranges

### Candidate backlog

Not approved yet:

- semantic retrieval / embedding adapters
- hybrid ranking
- code-aware retrieval
- auto-indexing
- pgvector/Postgres
- briefings/EOD summaries
- Me Write/RoktCode integration
- enterprise hardening
