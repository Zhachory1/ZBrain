# ZBrain evals

M0 evals measure recall, latency, negative hits, provenance correctness, and snippet usefulness.

Synthetic fixtures live in `fixtures/synthetic/` and are safe to commit.

Private fixtures live outside the repo. Only aggregate redacted reports may be committed.

Synthetic runs may include per-query rows. Private repo-bound reports may contain only aggregates and by-class aggregates.

## QMD BM25 baseline

See `docs/qmd-bm25-baseline.md`.

M1 cannot start private-docs retrieval work until the QMD BM25 private baseline exists or is explicitly blocked with a documented reason.
