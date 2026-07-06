const DEFAULT_EMBEDDINGS = {
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'mxbai-embed-large:latest',
};

export function resolveEmbeddingConfig(config = {}) {
  const embeddings = { ...DEFAULT_EMBEDDINGS, ...(config.embeddings || {}) };
  if (embeddings.provider !== 'ollama') throw new Error('M7 supports only ollama embeddings');
  const url = new URL(embeddings.baseUrl);
  if (url.protocol !== 'http:') throw new Error('embedding baseUrl must use http loopback');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('embedding baseUrl must be loopback');
  return embeddings;
}

export async function embedText(text, config, { timeoutMs = 30_000 } = {}) {
  const embeddings = resolveEmbeddingConfig(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const endpoint = new URL('/api/embeddings', embeddings.baseUrl);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: embeddings.model, prompt: String(text).slice(0, 1000) }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`ollama embeddings failed: ${response.status} ${body}`.trim());
    }
    const data = await response.json();
    if (!Array.isArray(data.embedding)) throw new Error('ollama returned no embedding');
    return { embedding: data.embedding, model: embeddings.model };
  } finally {
    clearTimeout(timeout);
  }
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
