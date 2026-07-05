import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_CAPS, tokenize, titleFromMarkdown, walkMarkdown } from './bm25.js';

export const ZBRAIN_DIR = '.zbrain';
export const CONFIG_PATH = '.zbrain/config.json';
export const DB_PATH = '.zbrain/index.sqlite';

export function initProject({ root, force = false, cwd = process.cwd() }) {
  if (!root) throw new Error('--path is required');
  const absRoot = path.resolve(cwd, root);
  assertInside(cwd, absRoot, 'collection root must stay inside project directory');
  mkdirSync(path.join(cwd, ZBRAIN_DIR), { recursive: true });
  const configPath = path.join(cwd, CONFIG_PATH);
  if (existsSync(configPath) && !force) throw new Error('config exists; pass --force to overwrite');
  const relativeRoot = path.relative(cwd, absRoot).replace(/\\/g, '/') || '.';
  writeFileSync(configPath, `${JSON.stringify({ schemaVersion: 1, root: relativeRoot }, null, 2)}\n`);
  ensureGitignore(cwd);
  return { configPath: CONFIG_PATH, root: relativeRoot };
}

function ensureGitignore(cwd) {
  const gitignore = path.join(cwd, '.gitignore');
  const line = '.zbrain/';
  const current = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
  if (!current.split(/\r?\n/).includes(line)) writeFileSync(gitignore, `${current}${current.endsWith('\n') || current.length === 0 ? '' : '\n'}${line}\n`);
}

export function loadConfig(cwd = process.cwd()) {
  const configPath = path.join(cwd, CONFIG_PATH);
  if (!existsSync(configPath)) throw new Error('No .zbrain/config.json. Run: zbrain init --path <dir>');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (config.schemaVersion !== 1) throw new Error('unsupported config schemaVersion');
  if (!config.root || path.isAbsolute(config.root)) throw new Error('config root must be relative');
  const root = path.resolve(cwd, config.root);
  assertInside(cwd, root, 'configured root escapes project directory');
  return { ...config, rootAbs: root };
}

export function indexProject({ cwd = process.cwd() } = {}) {
  const config = loadConfig(cwd);
  preflightSqlite();
  mkdirSync(path.join(cwd, ZBRAIN_DIR), { recursive: true });
  const db = path.join(cwd, DB_PATH);
  const tmp = `${db}.tmp`;
  const bak = `${db}.bak`;
  rmSync(tmp, { force: true });
  const docs = readDocuments(config.rootAbs, cwd);
  createIndexDb(tmp, docs);
  validateDb(tmp, docs.length);
  if (existsSync(db)) copyFileSync(db, bak);
  renameSync(tmp, db);
  return { dbPath: DB_PATH, documents: docs.length };
}

function readDocuments(root, cwd) {
  const rootReal = realpathSync(root);
  const files = walkMarkdown(rootReal);
  if (files.length > DEFAULT_CAPS.maxDocuments) throw new Error(`corpus exceeds maxDocuments (${files.length} > ${DEFAULT_CAPS.maxDocuments})`);
  let totalBytes = 0;
  return files.map((file) => {
    const real = realpathSync(file);
    assertInside(rootReal, real, 'file escapes configured root');
    const rel = path.relative(rootReal, real).replace(/\\/g, '/');
    const body = readFileSync(real, 'utf8');
    const stat = statSync(real);
    totalBytes += stat.size;
    if (totalBytes > DEFAULT_CAPS.maxTotalBytes) throw new Error(`corpus exceeds maxTotalBytes (${totalBytes} > ${DEFAULT_CAPS.maxTotalBytes})`);
    return {
      id: rel,
      path: rel,
      title: titleFromMarkdown(body, rel),
      body,
      hash: createHash('sha256').update(body).digest('hex').slice(0, 16),
      mtimeMs: Math.floor(stat.mtimeMs),
      sizeBytes: stat.size,
      chunks: chunkBody(body),
    };
  });
}

function chunkBody(body, linesPerChunk = 120) {
  const lines = body.split('\n');
  const chunks = [];
  for (let i = 0; i < lines.length; i += linesPerChunk) {
    const slice = lines.slice(i, i + linesPerChunk);
    chunks.push({ lineStart: i + 1, lineEnd: i + slice.length, text: slice.join('\n') });
  }
  return chunks.length ? chunks : [{ lineStart: 1, lineEnd: 1, text: '' }];
}

function createIndexDb(db, docs) {
  const statements = [schemaSql(), 'BEGIN;'];
  for (const doc of docs) {
    statements.push(`INSERT INTO documents(id,path,title,hash,mtime_ms,size_bytes,body,updated_at) VALUES (${q(doc.id)},${q(doc.path)},${q(doc.title)},${q(doc.hash)},${doc.mtimeMs},${doc.sizeBytes},${q(doc.body)},${q(new Date().toISOString())});`);
    for (let i = 0; i < doc.chunks.length; i += 1) {
      const chunk = doc.chunks[i];
      const chunkId = `${doc.id}#${i}`;
      statements.push(`INSERT INTO chunks_fts(chunk_id,document_id,path,hash,line_start,line_end,title,text) VALUES (${q(chunkId)},${q(doc.id)},${q(doc.path)},${q(doc.hash)},${chunk.lineStart},${chunk.lineEnd},${q(doc.title)},${q(chunk.text)});`);
    }
  }
  statements.push('COMMIT;');
  runSql(db, statements.join('\n'));
}

function schemaSql() {
  return `
PRAGMA journal_mode=WAL;
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO meta(key,value) VALUES ('schemaVersion','1');
CREATE TABLE documents(
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  hash TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  chunk_id UNINDEXED,
  document_id UNINDEXED,
  path UNINDEXED,
  hash UNINDEXED,
  line_start UNINDEXED,
  line_end UNINDEXED,
  title,
  text
);
`;
}

function validateDb(db, expectedDocs) {
  const status = statusIndex({ dbPath: db });
  if (status.status.schemaVersion !== 1) throw new Error('invalid schemaVersion after index');
  if (status.status.documents !== expectedDocs) throw new Error('document count mismatch after index');
}

export function queryIndex({ query, limit = 10, cwd = process.cwd(), dbPath = path.join(cwd, DB_PATH) }) {
  if (!query) throw new Error('query is required');
  const terms = [...new Set(tokenize(query))].slice(0, 64);
  if (terms.length === 0) throw new Error('query has no searchable terms');
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
  const match = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
  const sql = `SELECT document_id, chunk_id, path, hash, line_start, line_end, title, text, bm25(chunks_fts) AS raw_score FROM chunks_fts WHERE chunks_fts MATCH ${q(match)} ORDER BY raw_score ASC, path ASC, line_start ASC LIMIT ${safeLimit};`;
  const rows = runSqlJson(dbPath, sql);
  return {
    schemaVersion: 1,
    results: rows.map((row, i) => ({
      id: row.document_id,
      chunkId: row.chunk_id,
      title: row.title,
      rank: i + 1,
      score: -Number(row.raw_score),
      provenance: { path: row.path, lineStart: Number(row.line_start), lineEnd: Number(row.line_end), hash: row.hash },
      snippet: row.text,
    })),
  };
}

export function getDocument({ id, from = 1, lines = null, cwd = process.cwd(), dbPath = path.join(cwd, DB_PATH) }) {
  if (!id) throw new Error('document id is required');
  if (String(id).includes('#')) throw new Error('get accepts document id, not chunk id');
  const rows = runSqlJson(dbPath, `SELECT id,path,title,hash,body FROM documents WHERE id = ${q(id)} LIMIT 1;`);
  if (!rows.length) throw new Error(`document not found: ${id}`);
  const doc = rows[0];
  const allLines = String(doc.body).split('\n');
  const start = Math.max(1, Number(from) || 1);
  const count = lines === null ? allLines.length : Math.max(1, Number(lines) || allLines.length);
  const selected = allLines.slice(start - 1, start - 1 + count);
  return {
    schemaVersion: 1,
    document: {
      id: doc.id,
      title: doc.title,
      provenance: { path: doc.path, hash: doc.hash },
      lineStart: start,
      lineEnd: start + selected.length - 1,
      content: selected.join('\n'),
    },
  };
}

export function statusIndex({ cwd = process.cwd(), dbPath = path.join(cwd, DB_PATH) } = {}) {
  const dbExists = existsSync(dbPath);
  if (!dbExists) return { schemaVersion: 1, status: { dbExists: false, dbPath: path.relative(cwd, dbPath), schemaVersion: null, documents: 0, chunks: 0, sqliteVersion: sqliteVersion(), fts5: fts5Available() } };
  const rows = runSqlJson(dbPath, `SELECT (SELECT value FROM meta WHERE key='schemaVersion') AS schema_version, (SELECT COUNT(*) FROM documents) AS documents, (SELECT COUNT(*) FROM chunks_fts) AS chunks;`);
  const row = rows[0] || {};
  return {
    schemaVersion: 1,
    status: {
      dbExists: true,
      schemaVersion: Number(row.schema_version),
      dbPath: path.relative(cwd, dbPath),
      documents: Number(row.documents || 0),
      chunks: Number(row.chunks || 0),
      dbSizeBytes: statSync(dbPath).size,
      sqliteVersion: sqliteVersion(),
      fts5: fts5Available(),
    },
  };
}

export function preflightSqlite() {
  sqliteVersion();
  if (!fts5Available()) throw new Error('SQLite FTS5 unavailable. Install a SQLite build with FTS5.');
}

function sqliteVersion() {
  const result = spawnSync('sqlite3', ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('sqlite3 not found. Install SQLite with FTS5 support.');
  return result.stdout.trim().split(/\s+/)[0];
}

function fts5Available() {
  const result = spawnSync('sqlite3', [':memory:'], { input: 'CREATE VIRTUAL TABLE x USING fts5(y);', encoding: 'utf8' });
  return result.status === 0;
}

function runSql(db, sql) {
  const result = spawnSync('sqlite3', [db], { input: sql, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 10_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'sqlite3 failed').trim());
  return result.stdout;
}

function runSqlJson(db, sql) {
  const output = runSql(db, `.mode json\n${sql}\n`);
  if (!output.trim()) return [];
  return JSON.parse(output);
}

function q(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function assertInside(root, candidate, message) {
  const rootReal = realpathSync(root);
  const candidateReal = existsSync(candidate) ? realpathSync(candidate) : path.resolve(candidate);
  const relative = path.relative(rootReal, candidateReal);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(message);
}
