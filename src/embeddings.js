const DEFAULT_EMBEDDINGS = {
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'mxbai-embed-large:latest',
};

const OPENAI_DEFAULTS = {
  baseUrl: 'https://api.openai.com',
  model: 'text-embedding-3-small',
  apiKeyEnv: 'OPENAI_API_KEY',
};

export function resolveEmbeddingConfig(config = {}) {
  const source = config.embeddings || (config.provider ? config : {});
  if (source.provider === 'openai') return resolveOpenAiConfig(source);
  const embeddings = { ...DEFAULT_EMBEDDINGS, ...source };
  if (embeddings.provider !== 'ollama') throw new Error('embeddings provider must be ollama or openai');
  const url = new URL(embeddings.baseUrl);
  if (url.protocol !== 'http:') throw new Error('embedding baseUrl must use http loopback');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('embedding baseUrl must be loopback');
  return embeddings;
}

function resolveOpenAiConfig(source) {
  const embeddings = { ...OPENAI_DEFAULTS, ...source };
  if (embeddings.allowNetwork !== true) throw new Error('openai embeddings send corpus/query text to api.openai.com; set embeddings.allowNetwork: true to opt in');
  const url = new URL(embeddings.baseUrl);
  const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) throw new Error('openai embedding baseUrl must use https (http allowed only for loopback proxies)');
  const apiKey = process.env[embeddings.apiKeyEnv];
  if (!apiKey) throw new Error(`missing OpenAI API key in env ${embeddings.apiKeyEnv}`);
  return { ...embeddings, apiKey };
}

export async function embedText(text, config, { timeoutMs = 30_000 } = {}) {
  const embeddings = resolveEmbeddingConfig(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (embeddings.provider === 'openai') return await embedOpenAi(text, embeddings, controller.signal);
    const endpoint = new URL('/api/embeddings', embeddings.baseUrl);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: embeddings.model, prompt: String(text).slice(0, 500) }),
      redirect: 'manual',
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

async function embedOpenAi(text, embeddings, signal) {
  const endpoint = new URL('/v1/embeddings', embeddings.baseUrl);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${embeddings.apiKey}` },
    body: JSON.stringify({ model: embeddings.model, input: String(text).slice(0, 8000) }),
    redirect: 'manual',
    signal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`openai embeddings failed: ${response.status} ${body}`.trim());
  }
  const data = await response.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) throw new Error('openai returned no embedding');
  return { embedding, model: embeddings.model };
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
