# Private eval runbook

Private evals are for local private corpora such as `~/private-docs`. They are never committed raw.

## Layout

```text
~/.zbrain/evals/private-docs/
├── manifest.json
└── runs/<run-id>/
    ├── raw-local.json        # optional, private only
    ├── aggregate.json        # redacted aggregate
    └── aggregate.md          # redacted aggregate
```

Recommended permissions:

```bash
chmod 700 ~/.zbrain ~/.zbrain/evals ~/.zbrain/evals/private-docs
chmod 600 ~/.zbrain/evals/private-docs/manifest.json
```

## Manifest rules

Private manifests must set:

```json
{
  "schemaVersion": 1,
  "suiteId": "private-docs-m0-v1",
  "corpusClass": "private",
  "allowExternalCorpusRoot": true,
  "corpusRoot": "/Users/zhach/private-docs",
  "queries": []
}
```

Query classes must be one of:

- `exact_lookup`
- `recent_session`
- `decision_lookup`
- `project_status`
- `fuzzy_memory`
- `acronym_heavy`

## Safe aggregate output

Private repo-bound reports are aggregate-only. They must not include raw query text, expected paths, snippets, query IDs, hashed query IDs, or per-query rows.

For repo-bound aggregate export, use explicit approval flag after redaction checks:

```bash
zbrain bench \
  --manifest ~/.zbrain/evals/private-docs/manifest.json \
  --json reports/private-docs-aggregate.json \
  --md reports/private-docs-aggregate.md \
  --allow-repo-aggregate-output
```

## Unsafe local raw output

Raw private debugging artifacts, if ever added, must stay under `~/.zbrain/evals/private-docs/runs/<run-id>/` and never be copied to the repo.

M0 does not expose raw private output by default.
