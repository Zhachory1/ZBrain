import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cosine, embedText, resolveEmbeddingConfig } from '../src/embeddings.js';
import { embedProject, indexProject, initProject, vqueryIndex } from '../src/store.js';

const bin = path.resolve('bin/zbrain.js');

function runNode(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, encoding: 'utf8' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

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

test('embedText rejects loopback redirects instead of following them', async () => {
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(307, { location: 'http://192.168.1.1:11434/api/embeddings' });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(() => embedText('private prompt', { provider: 'ollama', baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'mock' }), /307|redirect|ollama embeddings failed/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('vector and hquery apply metadata filters', async () => {
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ embedding: [1, 0, 0] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dir = mkdtempSync(path.join(tmpdir(), 'zbrain-filter-vector-'));
  try {
    mkdirSync(path.join(dir, 'projects/zbrain/reports'), { recursive: true });
    mkdirSync(path.join(dir, 'projects/other/reports'), { recursive: true });
    writeFileSync(path.join(dir, 'projects/zbrain/reports/2026-07-07-a.md'), '# ZBrain\n\nsemanticfilter alpha\n');
    writeFileSync(path.join(dir, 'projects/other/reports/2026-07-07-b.md'), '# Other\n\nsemanticfilter beta\n');
    initProject({ cwd: dir, root: '.' });
    const configPath = path.join(dir, '.zbrain/config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.embeddings = { provider: 'ollama', baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'mock' };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    indexProject({ cwd: dir });
    await embedProject({ cwd: dir });
    const vector = await vqueryIndex({ cwd: dir, query: 'semanticfilter', filters: { project: 'zbrain' } });
    assert.equal(vector.results.length, 1);
    assert.equal(vector.results[0].id, 'projects/zbrain/reports/2026-07-07-a.md');
    assert.ok(vector.results[0].provenance.hash);
    const empty = await vqueryIndex({ cwd: dir, query: 'semanticfilter', filters: { project: 'missing' } });
    assert.equal(empty.results.length, 0);
    const exact = await runNode([bin, 'hquery', 'semanticfilter', '--mode', 'exact', '--project', 'zbrain', '--json', '--explain'], dir);
    assert.equal(exact.status, 0, exact.stderr);
    assert.equal(JSON.parse(exact.stdout).results.length, 1);
    const broad = await runNode([bin, 'hquery', 'papers about semanticfilter', '--project', 'zbrain', '--json', '--explain'], dir);
    assert.equal(broad.status, 0, broad.stderr);
    assert.equal(JSON.parse(broad.stdout).results.length, 1);
    const hybrid = await runNode([bin, 'hquery', 'semanticfilter', '--mode', 'hybrid', '--project', 'zbrain', '--json', '--explain'], dir);
    assert.equal(hybrid.status, 0, hybrid.stderr);
    const parsed = JSON.parse(hybrid.stdout);
    assert.equal(parsed.results.length, 1);
    assert.equal(parsed.query.filters.project, 'zbrain');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('embed --stale skips unchanged chunks and re-embeds changed chunks', async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      calls += 1;
      const parsed = JSON.parse(body);
      const seed = String(parsed.prompt).length;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ embedding: [seed, 1, 0] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const dir = mkdtempSync(path.join(tmpdir(), 'zbrain-stale-embed-'));
  try {
    mkdirSync(path.join(dir, 'docs'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'a.md'), '# Alpha\n\nfirst text\n');
    writeFileSync(path.join(dir, 'docs', 'b.md'), '# Beta\n\nsecond text\n');
    initProject({ cwd: dir, root: './docs' });
    const configPath = path.join(dir, '.zbrain/config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.embeddings = { provider: 'ollama', baseUrl: `http://127.0.0.1:${port}`, model: 'mock' };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    indexProject({ cwd: dir });
    const full = await embedProject({ cwd: dir });
    assert.equal(full.embedded, 2);
    assert.equal(calls, 2);
    const staleNoop = await embedProject({ cwd: dir, staleOnly: true });
    assert.equal(staleNoop.embedded, 0);
    assert.equal(staleNoop.skipped, 2);
    assert.equal(calls, 2);
    writeFileSync(path.join(dir, 'docs', 'a.md'), '# Alpha\n\nchanged text\n');
    indexProject({ cwd: dir });
    const staleChanged = await embedProject({ cwd: dir, staleOnly: true });
    assert.equal(staleChanged.embedded, 1);
    assert.equal(staleChanged.skipped, 1);
    assert.equal(calls, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
