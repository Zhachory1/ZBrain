# ZBrain privacy model

Default mode is local-only. M0 commands run under an OS no-network wrapper on supported platforms. M0 rejects `--allow-network`; external-provider runs are not implemented yet. Later milestones must require explicit approval and an audit row before any egress.

Private benchmark artifacts live outside the repo under `~/.zbrain/evals/private-docs/`.

Repo-bound private reports are aggregate-only. They must not contain raw private queries, paths, snippets, expected docs, query IDs, hashed query IDs, or per-query rows.

M0 private reports are aggregate-only. Per-query private rows, even hashed, stay outside the repo under `~/.zbrain/evals/private-docs/runs/<run-id>/`.
