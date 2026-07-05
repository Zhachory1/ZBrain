# ZBrain evals

M0/M1 evals measure recall, latency, negative hits, provenance correctness, and snippet usefulness.

Synthetic fixtures live in `fixtures/synthetic/` and are safe to commit. The current synthetic suite covers all approved query classes.

Private fixtures live outside the repo. Only aggregate redacted reports may be committed.

## QMD BM25 baseline

See `docs/qmd-bm25-baseline.md`.

M1 private-docs success requires QMD BM25 private baseline plus ZBrain comparison. If QMD/private corpus is unavailable, M1 readout must say blocked rather than successful for private-docs.

## Synthetic command

```bash
npm run bench:synthetic
```

This writes aggregate reports to `.cache/synthetic-results.{json,md}` under the local-only runner.
