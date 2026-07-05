# QMD BM25 baseline plan

M0 requires QMD BM25 as the private-docs baseline before M1 private-docs work.

## Private corpus rule

Private corpus runs stay local and network-denied. Raw private queries, paths, snippets, expected docs, and per-query rows stay outside the repo under:

```text
~/.zbrain/evals/private-docs/runs/<run-id>/
```

Repo-bound reports are aggregate-only.

## Baseline command shape

Use the same frozen private manifest as ZBrain. For each query, run QMD BM25 only:

```bash
qmd search "<query>" --json -n 10
```

The baseline runner must execute under the local-only runner. If QMD cannot run under local-only mode, M1 private-docs work is blocked.

## Metrics

Compare QMD and ZBrain using the same aggregate metrics:

- recall@1 / recall@3 / recall@10
- MRR
- negative hit@10
- provenance correctness
- snippet usefulness
- p50 / p95 / p99 latency
- failure rate

## M1 gate

M1 must beat QMD BM25 on recall@10 and MRR, meet M0 absolute floors, and pass snippet/provenance rubrics. Recall@10 alone is not enough.
