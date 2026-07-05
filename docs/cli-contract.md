# ZBrain CLI contract draft

M0 CLI is benchmark-only. M1 may add retrieval CLI if M0 readout approves.

## Command: bench

```bash
zbrain bench --manifest <path> [--mode bm25] [--json out.json] [--md out.md]
```

Local-only is always on in M0. `--allow-network` is rejected.

### Manifest v1

```json
{
  "schemaVersion": 1,
  "suiteId": "synthetic-m0-v1",
  "corpusClass": "synthetic",
  "corpusRoot": "docs",
  "baselineId": "zbrain-bm25-m0",
  "thresholds": {},
  "queries": [
    {
      "id": "exact-release-note",
      "class": "exact_lookup",
      "query": "release note",
      "expected": ["releases/v1.md"],
      "negative": ["plans/v1-plan.md"],
      "expectedSnippetTerms": ["local-only"]
    }
  ]
}
```

### Query classes

Allowed values:

- `exact_lookup`
- `recent_session`
- `decision_lookup`
- `project_status`
- `fuzzy_memory`
- `acronym_heavy`

### Report v1

Synthetic reports may include per-query rows. Private repo-bound reports are aggregate-only.

Aggregate fields:

- `schemaVersion`
- `corpusClass`
- `redacted`
- `mode`
- `suite`
- `indexStats`
- `metrics`
- `byClass`

Metrics:

- `recallAt1`
- `recallAt3`
- `recallAt10`
- `mrr`
- `negativeHitAt10`
- `provenanceCorrectRate`
- `snippetUsefulRate`
- `p50LatencyMs`
- `p95LatencyMs`
- `p99LatencyMs`
- `failureRate`

## Command: privacy-probe

```bash
zbrain privacy-probe
```

Runs local-only network-deny probe through the same CLI path.

## Error behavior

M0 errors are plain CLI errors. M1 will formalize stable JSON error envelopes for retrieval commands.

### Raw synthetic rows

`bench` writes aggregate reports by default. Synthetic per-query rows require:

```bash
--allow-raw-public-report
```

Private reports never include per-query rows in repo-bound output.
