# Retrieval investigation summary

This document records why ZBrain's retrieval roadmap contains BM25, aliases, local embeddings, calibration, and public benchmarks.

## Scope

ZBrain is **markdown/doc retrieval only**. Raw code retrieval, tree-sitter, symbols, and call graphs are out of scope. Markdown files inside code repositories are in scope.

## Key benchmark results

### Private-docs: ZBrain BM25 vs QMD BM25

15 known-answer `~/private-docs` queries.

| Mode | R@1 | R@3 | R@10 | MRR | Miss | p50 | p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| ZBrain BM25 | 1.000 | 1.000 | 1.000 | 1.000 | 0 | 0.26s | 0.28s |
| QMD BM25 | 0.467 | 0.467 | 0.467 | 0.467 | 8 | 0.29s | 0.32s |

Conclusion: ZBrain BM25 is much better for exact/provenance lookup in private-docs.

### Private semantic BM25 baseline (M3A)

12 semantic-style private-docs queries.

| Gap type | R@1 | R@3 | R@10 | MRR | Neg@10 | Miss |
|---|---:|---:|---:|---:|---:|---:|
| overall | 0.417 | 0.667 | 0.750 | 0.544 | 0.333 | 3 |
| paraphrase | 0.000 | 0.333 | 0.333 | 0.111 | 0.000 | 2 |
| alias | 0.667 | 0.667 | 0.667 | 0.667 | 0.333 | 1 |
| conceptual | 0.333 | 0.667 | 1.000 | 0.567 | 0.333 | 0 |
| negative-near-miss | 0.667 | 1.000 | 1.000 | 0.833 | 0.667 | 0 |

Conclusion: lexical BM25 is weak on paraphrase/alias questions.

### Private aliases (M4)

Manual/local aliases over the same private semantic suite.

| Mode | R@1 | R@3 | R@10 | MRR | Neg@10 | Miss | p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| M3A BM25 | 0.417 | 0.667 | 0.750 | 0.544 | 0.333 | 3 | 220ms |
| M4 aliases | 0.583 | 0.917 | 1.000 | 0.757 | 0.417 | 0 | 218ms |

Conclusion: explicit aliases are highly effective for this corpus, but require curation.

### Private local Ollama vector (M6)

Local `mxbai-embed-large` over ZBrain chunks.

| Mode | R@1 | R@3 | R@10 | MRR | Neg@10 | Miss | p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Ollama vector | 0.333 | 0.667 | 0.917 | 0.508 | 0.333 | 1 | 21.8ms |

Conclusion: vector improves paraphrase recall but does not beat aliases overall.

### Public README-style markdown (M9)

`davidmyersdev/markdown-dataset`, 120 README-like docs, heading/repo-name labels.

| Mode | R@1 | R@3 | R@10 | MRR | Miss | p95 |
|---|---:|---:|---:|---:|---:|---:|
| BM25 | 0.900 | 0.958 | 0.967 | 0.929 | 4 | 312ms |
| Vector | 0.892 | 0.933 | 0.967 | 0.915 | 4 | 402ms |

Conclusion: close; labels likely favor lexical retrieval.

### arXiv abstract-keyword labels (M10)

`marcodsn/arxiv-markdown`, 200 papers, abstract-keyword generated queries.

| Mode | R@1 | R@3 | R@10 | MRR | Miss | p95 |
|---|---:|---:|---:|---:|---:|---:|
| BM25 | 0.980 | 0.995 | 1.000 | 0.988 | 0 | 322ms |
| Vector | 0.960 | 0.980 | 0.995 | 0.973 | 1 | 211ms |

Conclusion: both strong; vector faster; labels still lexical-ish.

### arXiv natural questions (M11)

25 hand-authored natural-language questions over 40 papers.

| Mode | R@1 | R@3 | R@10 | MRR | Miss | p95 |
|---|---:|---:|---:|---:|---:|---:|
| BM25 | 1.000 | 1.000 | 1.000 | 1.000 | 0 | 287ms |
| Vector | 1.000 | 1.000 | 1.000 | 1.000 | 0 | 170ms |

Conclusion: tie on quality; vector faster.

### arXiv small qrels smoke (M12)

10 hand-authored multi-relevance qrels over 40 papers.

| Mode | nDCG@10 | Recall@10 | MRR | NearMiss@10 | p95 |
|---|---:|---:|---:|---:|---:|
| BM25 | 0.973 | 0.975 | 1.000 | 0.600 | 280ms |
| Vector | 0.988 | 1.000 | 1.000 | 0.500 | 173ms |

Conclusion: vector slight edge, but qrels too small/single-reviewer.

### arXiv category qrels smoke (M13)

500 papers, arXiv category metadata as weak qrels.

| Mode | nDCG@10 | Recall@10 | MRR | p95 |
|---|---:|---:|---:|---:|
| BM25 | 0.363 | 0.167 | 0.695 | 290ms |
| Vector | 0.579 | 0.253 | 0.750 | 232ms |

Conclusion: vector meaningfully wins on broad topical/category retrieval. Labels are weak taxonomy labels, but this is directional evidence.

## Current interpretation

- BM25 + aliases is best for exact/project/session/private-doc workflows.
- Vector helps broad topical and paraphrase retrieval.
- QMD local vector was weak in private-docs tests; ZBrain's local Ollama vector is stronger.
- No evidence yet justifies making vector the default for all queries.
- Evidence supports an eventual intent-aware hybrid: lexical/BM25 dominance for exact lookups, vector lift for broad/topical queries.

## Product implication

Future hybrid/default work should preserve exact lookup behavior while using vector for broad/topical queries. Do not overfit defaults to private-docs alone.
