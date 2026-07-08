import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { embedProject, indexProject, initProject } from '../src/store.js';

const bin = path.resolve('bin/zbrain-mcp.js');

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'zbrain-mcp-'));
  mkdirSync(path.join(dir, 'projects/zbrain/reports'), { recursive: true });
  writeFileSync(path.join(dir, 'projects/zbrain/reports/2026-07-08-mcp.md'), '# MCP Report\n\nmcpneedle search evidence line\n\nsecond line\n');
  initProject({ cwd: dir, root: '.' });
  indexProject({ cwd: dir });
  return dir;
}

function startServer(root, env = {}) {
  const child = spawn(process.execPath, [bin, '--root', root], { cwd: tmpdir(), env: { ...process.env, ...env } });
  const responses = [];
  let stdout = Buffer.alloc(0);
  child.stdout.on('data', (chunk) => {
    stdout = Buffer.concat([stdout, chunk]);
    while (stdout.length) {
      const marker = Buffer.from('\r\n\r\n');
      const headerEnd = stdout.indexOf(marker);
      if (headerEnd < 0) break;
      const header = stdout.slice(0, headerEnd).toString('ascii');
      const length = Number((header.match(/Content-Length:\s*(\d+)/i) || [])[1]);
      const start = headerEnd + marker.length;
      if (!Number.isFinite(length) || stdout.length < start + length) break;
      responses.push(JSON.parse(stdout.slice(start, start + length).toString('utf8')));
      stdout = stdout.slice(start + length);
    }
  });
  return { child, responses, send: (msg) => child.stdin.write(`${typeof msg === 'string' ? msg : JSON.stringify(msg)}\n`), sendFramed: (msg) => { const body = JSON.stringify(msg); child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`); }, close: () => child.kill() };
}

async function waitFor(responses, count, timeoutMs = 1000) {
  const started = Date.now();
  while (responses.length < count) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${count} responses, got ${responses.length}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('mcp accepts Content-Length framed unicode request', async () => {
  const dir = fixture();
  const server = startServer(dir);
  try {
    server.sendFramed({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'zbrain.search', arguments: { query: 'mcpneedle café' } } });
    await waitFor(server.responses, 1);
    assert.equal(server.responses[0].result.isError, false);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mcp accepts Content-Length framed initialize', async () => {
  const dir = fixture();
  const server = startServer(dir);
  try {
    server.sendFramed({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await waitFor(server.responses, 1);
    assert.equal(server.responses[0].result.serverInfo.name, 'zbrain');
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mcp initialize list and call search get answer status', async () => {
  const dir = fixture();
  const server = startServer(dir);
  try {
    server.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    server.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    server.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    await waitFor(server.responses, 2);
    assert.equal(server.responses[0].result.serverInfo.name, 'zbrain');
    assert.equal(server.responses[1].result.tools.length, 4);
    assert.equal(server.responses[1].result.tools[0].inputSchema.additionalProperties, false);
    server.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'zbrain.search', arguments: { query: 'mcpneedle', filters: { project: 'zbrain' } } } });
    await waitFor(server.responses, 3);
    const search = JSON.parse(server.responses[2].result.content[0].text);
    assert.equal(search.results[0].id, 'projects/zbrain/reports/2026-07-08-mcp.md');
    server.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'zbrain.get', arguments: { id: search.results[0].id, lines: 1 } } });
    server.send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'zbrain.answer', arguments: { query: 'mcpneedle search', filters: { project: 'zbrain' } } } });
    server.send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'zbrain.status', arguments: {} } });
    await waitFor(server.responses, 6);
    assert.equal(JSON.parse(server.responses[3].result.content[0].text).document.id, search.results[0].id);
    const answer = JSON.parse(server.responses[4].result.content[0].text);
    assert.equal(answer.answer.status, 'evidence_found');
    assert.equal(answer.evidence[0].documentId, search.results[0].id);
    assert.equal(JSON.parse(server.responses[5].result.content[0].text).effectiveRoot, realpathSync(dir));
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mcp rejects unknown args and malformed json without exiting', async () => {
  const dir = fixture();
  const server = startServer(dir);
  try {
    const before = treeHash(path.join(dir, '.zbrain'));
    server.send('{bad json');
    server.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'zbrain.search', arguments: { query: 'x', root: '/' } } });
    server.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'zbrain.search', arguments: { query: 'x', filters: { nope: 'bad' } } } });
    server.send({ jsonrpc: '2.0', id: 4, method: 'unknown', params: {} });
    await waitFor(server.responses, 4);
    assert.equal(server.responses[0].error.code, -32700);
    assert.equal(server.responses[1].result.isError, true);
    assert.equal(server.responses[2].result.isError, true);
    assert.equal(server.responses[3].error.code, -32601);
    assert.equal(treeHash(path.join(dir, '.zbrain')), before);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mcp returns upgrade error when index is missing', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zbrain-mcp-noindex-'));
  try {
    initProject({ cwd: dir, root: '.' });
    const before = treeHash(path.join(dir, '.zbrain'));
    const server = startServer(dir);
    try {
      server.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'zbrain.search', arguments: { query: 'x' } } });
      await waitFor(server.responses, 1);
      const payload = JSON.parse(server.responses[0].result.content[0].text);
      assert.equal(server.responses[0].result.isError, true);
      assert.equal(payload.error.code, 'index_requires_upgrade');
      assert.equal(treeHash(path.join(dir, '.zbrain')), before);
    } finally {
      server.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mcp filtered search on stale metadata schema returns upgrade error without mutation', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zbrain-mcp-stale-'));
  try {
    mkdirSync(path.join(dir, '.zbrain'), { recursive: true });
    writeFileSync(path.join(dir, '.zbrain/config.json'), JSON.stringify({ schemaVersion: 1, root: '.' }, null, 2));
    const db = path.join(dir, '.zbrain/index.sqlite');
    const sql = `
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO meta(key,value) VALUES ('schemaVersion','1');
CREATE TABLE documents(id TEXT PRIMARY KEY,path TEXT,title TEXT,hash TEXT,mtime_ms INTEGER,size_bytes INTEGER,body TEXT,updated_at TEXT);
CREATE VIRTUAL TABLE chunks_fts USING fts5(chunk_id UNINDEXED,document_id UNINDEXED,path UNINDEXED,hash UNINDEXED,line_start UNINDEXED,line_end UNINDEXED,title,text);
CREATE TABLE chunk_embeddings(chunk_id TEXT PRIMARY KEY,document_id TEXT,path TEXT,line_start INTEGER,line_end INTEGER,title TEXT,text TEXT,model TEXT,dims INTEGER,embedding_json TEXT,updated_at TEXT);
INSERT INTO documents VALUES ('doc.md','doc.md','Doc','hash',0,1,'# Doc','now');
INSERT INTO chunks_fts(chunk_id,document_id,path,hash,line_start,line_end,title,text) VALUES ('doc.md#0','doc.md','doc.md','hash',1,1,'Doc','staleterm');
`;
    assert.equal(spawnSync('sqlite3', [db], { input: sql, encoding: 'utf8' }).status, 0);
    const before = treeHash(path.join(dir, '.zbrain'));
    const server = startServer(dir);
    try {
      server.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'zbrain.search', arguments: { query: 'staleterm', filters: { project: 'zbrain' } } } });
      await waitFor(server.responses, 1);
      const payload = JSON.parse(server.responses[0].result.content[0].text);
      assert.equal(server.responses[0].result.isError, true);
      assert.equal(payload.error.code, 'index_requires_upgrade');
      assert.equal(treeHash(path.join(dir, '.zbrain')), before);
    } finally {
      server.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mcp get caps lines and tools are read-only for exact paths', async () => {
  const dir = fixture();
  const before = treeHash(path.join(dir, '.zbrain'));
  const server = startServer(dir);
  try {
    server.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'zbrain.get', arguments: { id: 'projects/zbrain/reports/2026-07-08-mcp.md', lines: 999 } } });
    server.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'zbrain.search', arguments: { query: 'mcpneedle', filters: { project: 'zbrain' } } } });
    server.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'zbrain.answer', arguments: { query: 'mcpneedle search', filters: { project: 'zbrain' } } } });
    server.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'zbrain.status', arguments: {} } });
    await waitFor(server.responses, 4);
    assert.equal(JSON.parse(server.responses[0].result.content[0].text).document.lineEnd <= 200, true);
    assert.equal(treeHash(path.join(dir, '.zbrain')), before);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mcp broad and hybrid tools are logically read-only', async () => {
  const ok = createServer((req, res) => { req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ embedding: [1, 0, 0] })); });
  await new Promise((resolve) => ok.listen(0, '127.0.0.1', resolve));
  const dir = fixture();
  try {
    const configPath = path.join(dir, '.zbrain/config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.embeddings = { provider: 'ollama', baseUrl: `http://127.0.0.1:${ok.address().port}`, model: 'mock' };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    await embedProject({ cwd: dir });
    const before = treeHash(path.join(dir, '.zbrain'));
    const server = startServer(dir);
    try {
      server.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'zbrain.search', arguments: { query: 'mcpneedle', mode: 'broad' } } });
      server.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'zbrain.search', arguments: { query: 'mcpneedle', mode: 'hybrid' } } });
      server.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'zbrain.answer', arguments: { query: 'mcpneedle search', mode: 'broad' } } });
      server.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'zbrain.answer', arguments: { query: 'mcpneedle search', mode: 'hybrid' } } });
      await waitFor(server.responses, 4);
      assert.equal(treeHash(path.join(dir, '.zbrain')), before);
    } finally {
      server.close();
    }
  } finally {
    await new Promise((resolve) => ok.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mcp timeout keeps server alive', async () => {
  let hangRequest = null;
  const hang = createServer((req, res) => { req.resume(); hangRequest = { req, res }; });
  const ok = createServer((req, res) => { req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ embedding: [1, 0, 0] })); });
  await new Promise((resolve) => ok.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => hang.listen(0, '127.0.0.1', resolve));
  const dir = fixture();
  try {
    const configPath = path.join(dir, '.zbrain/config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.embeddings = { provider: 'ollama', baseUrl: `http://127.0.0.1:${ok.address().port}`, model: 'mock' };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    await embedProject({ cwd: dir });
    config.embeddings.baseUrl = `http://127.0.0.1:${hang.address().port}`;
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    const before = treeHash(path.join(dir, '.zbrain'));
    const server = startServer(dir, { ZBRAIN_MCP_LOOPBACK_TIMEOUT_MS: '50' });
    try {
      server.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'zbrain.search', arguments: { query: 'mcpneedle', mode: 'broad' } } });
      await waitFor(server.responses, 1, 1000);
      assert.equal(server.responses[0].result.isError, true);
      server.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'zbrain.status', arguments: {} } });
      await waitFor(server.responses, 2, 1000);
      assert.equal(server.responses[1].result.isError, false);
      assert.equal(treeHash(path.join(dir, '.zbrain')), before);
    } finally {
      server.close();
    }
  } finally {
    hangRequest?.res?.destroy();
    await new Promise((resolve) => ok.close(resolve));
    await new Promise((resolve) => hang.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

function treeHash(root) {
  const hash = createHash('sha256');
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (name.endsWith('-wal') || name.endsWith('-shm')) continue;
      const stat = statSync(full);
      hash.update(path.relative(root, full));
      hash.update(String(stat.size));
      if (stat.isDirectory()) walk(full);
      else hash.update(readFileSync(full));
    }
  }
  walk(root);
  return hash.digest('hex');
}
