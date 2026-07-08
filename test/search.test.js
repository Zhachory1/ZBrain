import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { embedProject, indexProject, initProject } from '../src/store.js';

const bin = path.resolve('bin/zbrain.js');

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

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'zbrain-search-'));
  mkdirSync(path.join(dir, 'projects/zbrain/reports'), { recursive: true });
  mkdirSync(path.join(dir, 'projects/other/reports'), { recursive: true });
  writeFileSync(path.join(dir, 'projects/zbrain/reports/2026-07-08-search.md'), '# Search Report\n\nneedle search evidence\n');
  writeFileSync(path.join(dir, 'projects/other/reports/2026-07-08-search.md'), '# Other Report\n\nneedle other evidence\n');
  initProject({ cwd: dir, root: '.' });
  indexProject({ cwd: dir });
  return dir;
}

test('search text output includes path and snippet', () => {
  const dir = fixture();
  try {
    const result = spawnSync(process.execPath, [bin, 'search', 'needle'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /projects\/zbrain|projects\/other/);
    assert.match(result.stdout, /needle/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('search json includes id and supports filters', () => {
  const dir = fixture();
  try {
    const result = spawnSync(process.execPath, [bin, 'search', 'needle', '--project', 'zbrain', '--json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.query.mode, 'exact');
    assert.equal(parsed.results.length, 1);
    assert.equal(parsed.results[0].id, 'projects/zbrain/reports/2026-07-08-search.md');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('search broad mode uses loopback embeddings explicitly', async () => {
  const server = createServer((req, res) => { req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ embedding: [1, 0, 0] })); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dir = fixture();
  try {
    const configPath = path.join(dir, '.zbrain/config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.embeddings = { provider: 'ollama', baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'mock' };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    await embedProject({ cwd: dir });
    const result = await runNode([bin, 'search', 'needle', '--mode', 'broad', '--json'], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).query.network, 'loopback');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('search exact default does not require embeddings', () => {
  const dir = fixture();
  try {
    const result = spawnSync(process.execPath, [bin, 'search', 'needle', '--json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).query.network, 'none');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
