# ZBrain privacy model

Default mode is local-only. Commands run under an OS no-network wrapper on supported platforms and reject `--allow-network`.

Embeddings default to loopback-only Ollama (`127.0.0.1`). Optionally, the embeddings provider can be set to `openai`, which sends document chunks (`embed`) and query text (`vquery`/broad `search`/`answer`) to `api.openai.com`. This requires explicit `embeddings.allowNetwork: true`; without it the provider errors. The API key comes from an env var (`apiKeyEnv`, default `OPENAI_API_KEY`) and is never stored in config. Non-loopback URLs must use https. Every network embedding run appends an audit row to `<corpus>/.zbrain/embed-audit.log`.

Another exception is `brief`. With `--allow-network` (or `briefings.agent.allowNetwork: true`) it hands retrieved doc content to a configured local agent CLI for prose summarization. With the default agent (mewrite) that model is a cloud provider, so corpus content leaves the machine. This is opt-in per run, never the default: without opt-in, `brief` produces an offline structured listing and stays inside the local-only boundary. Every network run appends an audit row to `<corpus>/.zbrain/brief-audit.log` (`ts`, `provider`, `network`, `corpus`, `artifact`). All other commands still reject `--allow-network`.

Private benchmark artifacts live outside the repo under `~/.zbrain/evals/private-docs/`.

Repo-bound private reports are aggregate-only. They must not contain raw private queries, paths, snippets, expected docs, query IDs, hashed query IDs, or per-query rows.

M0 private reports are aggregate-only. Per-query private rows, even hashed, stay outside the repo under `~/.zbrain/evals/private-docs/runs/<run-id>/`.
