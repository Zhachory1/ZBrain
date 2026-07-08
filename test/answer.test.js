import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { answerQuery } from '../src/answer.js';
import { embedProject, indexProject, initProject } from '../src/store.js';

const bin = path.resolve('bin/zbrain.js');

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'zbrain-answer-'));
  mkdirSync(path.join(dir, 'projects/zbrain/reports'), { recursive: true });
  mkdirSync(path.join(dir, 'projects/other/reports'), { recursive: true });
  writeFileSync(path.join(dir, 'projects/zbrain/reports/2026-07-07-hybrid.md'), '# Hybrid Report\n\nVector-heavy hybrid earns more for semantic retrieval.\n\n  Spacing term has  two   spaces.\n');
  writeFileSync(path.join(dir, 'projects/other/reports/2026-07-07-hybrid.md'), '# Other Report\n\nBM25 exact lookup remains useful.\n');
  initProject({ cwd: dir, root: '.' });
  indexProject({ cwd: dir });
  return dir;
}

function runNode(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('answerQuery rejects out-of-contract mode', async () => {
  const dir = fixture();
  try {
    await assert.rejects(() => answerQuery({ cwd: dir, query: 'semantic retrieval', mode: 'vector' }), /invalid answer mode/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI answer rejects out-of-contract mode', async () => {
  const dir = fixture();
  try {
    const result = await runNode([bin, 'answer', 'semantic retrieval', '--mode', 'vector', '--json'], dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /invalid answer mode/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('answer ignores decision-intent words when selecting evidence', async () => {
  const dir = fixture();
  try {
    const result = await answerQuery({ cwd: dir, query: 'what did we decide about vector-heavy hybrid', filters: { project: 'zbrain' } });
    assert.equal(result.answer.status, 'evidence_found');
    assert.match(result.evidence[0].quote, /Vector-heavy hybrid earns more/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('answer returns extractive evidence with exact citation line', async () => {
  const dir = fixture();
  try {
    const result = await answerQuery({ cwd: dir, query: 'semantic retrieval', filters: { project: 'zbrain' } });
    assert.equal(result.answer.status, 'evidence_found');
    assert.match(result.answer.text, /Vector-heavy hybrid earns more/);
    assert.equal(result.answer.citations.length, 1);
    assert.equal(result.answer.citations[0].path, 'projects/zbrain/reports/2026-07-07-hybrid.md');
    assert.equal(result.answer.citations[0].lineStart, 3);
    assert.equal(result.evidence[0].quote, 'Vector-heavy hybrid earns more for semantic retrieval.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('answer quotes exact indexed line whitespace', async () => {
  const dir = fixture();
  try {
    const result = await answerQuery({ cwd: dir, query: 'spacing term', filters: { project: 'zbrain' } });
    assert.equal(result.answer.status, 'evidence_found');
    assert.equal(result.evidence[0].quote, '  Spacing term has  two   spaces.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('answer uses indexed DB body instead of live file path', async () => {
  const dir = fixture();
  try {
    writeFileSync(path.join(dir, 'projects/zbrain/reports/2026-07-07-hybrid.md'), '# Hybrid Report\n\nChanged live file should not appear.\n');
    const result = await answerQuery({ cwd: dir, query: 'semantic retrieval', filters: { project: 'zbrain' } });
    assert.equal(result.answer.status, 'evidence_found');
    assert.match(result.answer.text, /Vector-heavy hybrid earns more/);
    assert.doesNotMatch(result.answer.text, /Changed live file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('answer respects metadata filters and text citations', async () => {
  const dir = fixture();
  try {
    const result = await runNode([bin, 'answer', 'exact lookup', '--project', 'other'], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /BM25 exact lookup remains useful/);
    assert.match(result.stdout, /Citations:/);
    assert.match(result.stdout, /projects\/other\/reports/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('answer returns insufficient_evidence when retrieval is empty', async () => {
  const dir = fixture();
  try {
    const result = await answerQuery({ cwd: dir, query: 'nonexistentuniqueterm' });
    assert.equal(result.answer.status, 'insufficient_evidence');
    assert.deepEqual(result.answer.citations, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('answer returns weak_evidence when retrieval has no quotable support lines', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zbrain-answer-weak-'));
  try {
    mkdirSync(path.join(dir, 'docs'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'heading.md'), '# LonelyTerm\n\n## LonelyTerm\n\n');
    initProject({ cwd: dir, root: './docs' });
    indexProject({ cwd: dir });
    const result = await answerQuery({ cwd: dir, query: 'LonelyTerm' });
    assert.equal(result.answer.status, 'weak_evidence');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('answer exact mode does not require embedding config', async () => {
  const dir = fixture();
  try {
    const configPath = path.join(dir, '.zbrain/config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.embeddings = { provider: 'ollama', baseUrl: 'http://192.168.1.1:11434', model: 'bad' };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    const result = await answerQuery({ cwd: dir, query: 'semantic retrieval', mode: 'exact' });
    assert.equal(result.query.network, 'none');
    assert.equal(result.answer.status, 'evidence_found');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('answer broad mode uses loopback embeddings and reports loopback', async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    req.resume();
    calls += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ embedding: [1, 0, 0] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dir = fixture();
  try {
    const configPath = path.join(dir, '.zbrain/config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.embeddings = { provider: 'ollama', baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'mock' };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    await embedProject({ cwd: dir });
    const result = await answerQuery({ cwd: dir, query: 'semantic retrieval', mode: 'broad', filters: { project: 'zbrain' } });
    assert.equal(result.query.network, 'loopback');
    assert.equal(result.answer.status, 'evidence_found');
    assert.ok(calls >= 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
