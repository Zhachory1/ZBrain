import test from 'node:test';
import assert from 'node:assert/strict';
import { cosine, resolveEmbeddingConfig } from '../src/embeddings.js';

test('embedding config defaults to local ollama', () => {
  const config = resolveEmbeddingConfig({});
  assert.equal(config.provider, 'ollama');
  assert.equal(config.baseUrl, 'http://127.0.0.1:11434');
});

test('embedding config rejects non-loopback URLs', () => {
  assert.throws(() => resolveEmbeddingConfig({ embeddings: { provider: 'ollama', baseUrl: 'https://example.com', model: 'x' } }), /loopback|http/);
  assert.throws(() => resolveEmbeddingConfig({ embeddings: { provider: 'ollama', baseUrl: 'http://192.168.1.1:11434', model: 'x' } }), /loopback/);
});

test('cosine ranks identical vectors higher', () => {
  assert.equal(cosine([1, 0], [1, 0]) > cosine([1, 0], [0, 1]), true);
});
