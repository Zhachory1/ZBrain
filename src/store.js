import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_CAPS, tokenize, titleFromMarkdown, walkMarkdown } from './bm25.js';
import { isDeniedPath } from './denylist.js';
import { cosine, embedText, resolveEmbeddingConfig } from './embeddings.js';

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

export function ensureGitignore(cwd) {
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

export function preflightProject({ root, cwd = process.cwd(), includePaths = false, caps = DEFAULT_CAPS } = {}) {
  if (!root) throw new Error('path is required');
  const absRoot = resolveUserPath(root, cwd);
  if (!existsSync(absRoot) || !statSync(absRoot).isDirectory()) throw new Error('path must be an existing directory');
  const scan = scanMarkdownCorpus(absRoot, { includePaths, caps });
  const warnings = [];
  if (scan.documents > caps.maxDocuments) warnings.push({ code: 'max_documents_exceeded', message: `documents exceeds maxDocuments (${scan.documents} > ${caps.maxDocuments})` });
  if (scan.totalBytes > caps.maxTotalBytes) warnings.push({ code: 'max_total_bytes_exceeded', message: `totalBytes exceeds maxTotalBytes (${scan.totalBytes} > ${caps.maxTotalBytes})` });
  return {
    schemaVersion: 1,
    preflight: {
      documents: scan.documents,
      totalBytes: scan.totalBytes,
      skippedFiles: scan.skippedFiles,
      skippedReasons: scan.skippedReasons,
      largestFiles: scan.largestFiles.map((file) => ({ path: includePaths ? file.path : null, sizeBytes: file.sizeBytes })),
      skipped: includePaths ? scan.skipped : undefined,
      caps,
      fitsCaps: warnings.length === 0,
      warnings,
    },
  };
}

export function importProject({ target, cwd = process.cwd(), force = false } = {}) {
  if (!target) throw new Error('path is required');
  const absTarget = resolveUserPath(target, cwd);
  if (!existsSync(absTarget) || !statSync(absTarget).isDirectory()) throw new Error('path must be an existing directory');
  const preflight = preflightProject({ root: absTarget, cwd, includePaths: false }).preflight;
  if (!preflight.fitsCaps) throw new Error(`preflight failed caps: ${preflight.warnings.map((w) => w.code).join(', ')}`);

  ensureGitignore(absTarget);
  const configPath = path.join(absTarget, CONFIG_PATH);
  const dbPath = path.join(absTarget, DB_PATH);
  const configExists = existsSync(configPath);
  const dbExists = existsSync(dbPath);
  let configAction = 'created';
  if (configExists) {
    const existing = JSON.parse(readFileSync(configPath, 'utf8'));
    if (existing.schemaVersion === 1 && existing.root === '.') configAction = 'reused';
    else if (!force) throw new Error('config exists with incompatible root; pass --force to overwrite');
    else configAction = 'overwritten';
  }
  if (dbExists && !force) throw new Error('index exists; pass --force to overwrite');

  mkdirSync(path.join(absTarget, ZBRAIN_DIR), { recursive: true });
  const backups = {};
  if (configExists && configAction === 'overwritten') {
    backups.configPath = backupLocalFile(configPath, absTarget);
    initProject({ cwd: absTarget, root: '.', force: true });
  } else if (!configExists) {
    initProject({ cwd: absTarget, root: '.', force: false });
  }

  let dbAction = 'created';
  if (dbExists) {
    backups.dbPath = backupLocalFile(dbPath, absTarget);
    dbAction = 'overwritten';
  }

  const indexed = indexProject({ cwd: absTarget });
  const status = statusIndex({ cwd: absTarget }).status;
  return {
    schemaVersion: 1,
    import: {
      configPath: CONFIG_PATH,
      dbPath: DB_PATH,
      configAction,
      dbAction,
      backups,
      indexed,
      status: { documents: status.documents, chunks: status.chunks, dbSizeBytes: status.dbSizeBytes },
    },
  };
}

function resolveUserPath(value, cwd) {
  const input = String(value);
  if (input === '~') return process.env.HOME || cwd;
  if (input.startsWith('~/')) return path.join(process.env.HOME || cwd, input.slice(2));
  return path.resolve(cwd, input);
}

function backupLocalFile(file, root) {
  const parsed = path.parse(file);
  const backup = path.join(parsed.dir, `${parsed.base}.${Date.now()}.bak`);
  copyFileSync(file, backup);
  return path.relative(root, backup).replace(/\\/g, '/');
}

function scanMarkdownCorpus(root, { includePaths = false, caps = DEFAULT_CAPS } = {}) {
  const skippedReasons = { deniedPath: 0, oversized: 0, symlink: 0, maxDepth: 0, unreadable: 0 };
  const skipped = [];
  const largest = [];
  let documents = 0;
  let totalBytes = 0;
  function skip(reason, rel, sizeBytes = null) {
    skippedReasons[reason] += 1;
    if (includePaths) skipped.push({ reason, path: normalizeRel(rel), sizeBytes });
  }
  function walk(rel = '') {
    const depth = rel ? rel.split(path.sep).length : 0;
    if (depth > caps.maxDepth) { skip('maxDepth', rel); return; }
    const dir = path.join(root, rel);
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { skip('unreadable', rel); return; }
    for (const entry of entries) {
      const childRel = path.join(rel, entry.name);
      if (isDeniedPath(childRel)) { skip('deniedPath', childRel); continue; }
      if (entry.isSymbolicLink()) { skip('symlink', childRel); continue; }
      const full = path.join(root, childRel);
      if (entry.isDirectory()) { walk(childRel); continue; }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      let stat;
      try { stat = statSync(full); }
      catch { skip('unreadable', childRel); continue; }
      largest.push({ path: normalizeRel(childRel), sizeBytes: stat.size });
      if (stat.size > caps.maxFileBytes) { skip('oversized', childRel, stat.size); continue; }
      documents += 1;
      totalBytes += stat.size;
    }
  }
  walk();
  largest.sort((a, b) => b.sizeBytes - a.sizeBytes || a.path.localeCompare(b.path));
  return { documents, totalBytes, skippedFiles: Object.values(skippedReasons).reduce((a, b) => a + b, 0), skippedReasons, largestFiles: largest.slice(0, 5), skipped };
}

function normalizeRel(value) {
  return String(value).replace(/\\/g, '/');
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
CREATE TABLE IF NOT EXISTS chunk_embeddings (
  chunk_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  path TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,
  embedding_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
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


export async function embedProject({ cwd = process.cwd(), dbPath = path.join(cwd, DB_PATH) } = {}) {
  const config = loadConfig(cwd);
  const embeddingConfig = resolveEmbeddingConfig(config);
  const chunks = runSqlJson(dbPath, `SELECT chunk_id, document_id, path, line_start, line_end, title, text FROM chunks_fts;`);
  let embedded = 0;
  for (const chunk of chunks) {
    const prompt = `title: ${chunk.title}\npath: ${chunk.path}\ntext: ${chunk.text}`;
    const { embedding, model } = await embedText(prompt, embeddingConfig);
    runSql(dbPath, `INSERT OR REPLACE INTO chunk_embeddings(chunk_id,document_id,path,line_start,line_end,title,text,model,dims,embedding_json,updated_at) VALUES (${q(chunk.chunk_id)},${q(chunk.document_id)},${q(chunk.path)},${Number(chunk.line_start)},${Number(chunk.line_end)},${q(chunk.title)},${q(chunk.text)},${q(model)},${embedding.length},${q(JSON.stringify(embedding))},${q(new Date().toISOString())});`);
    embedded += 1;
  }
  return { schemaVersion: 1, embedded, model: embeddingConfig.model };
}

export async function vqueryIndex({ query, limit = 10, cwd = process.cwd(), dbPath = path.join(cwd, DB_PATH) }) {
  if (!query) throw new Error('query is required');
  const config = loadConfig(cwd);
  const embeddingConfig = resolveEmbeddingConfig(config);
  const { embedding, model } = await embedText(query, embeddingConfig);
  const rows = runSqlJson(dbPath, `SELECT chunk_id, document_id, path, line_start, line_end, title, text, model, dims, embedding_json FROM chunk_embeddings WHERE model = ${q(model)};`);
  if (rows.length === 0) throw new Error('no embeddings found. Run: zbrain embed');
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
  const scored = rows.map((row) => ({ row, score: cosine(embedding, JSON.parse(row.embedding_json)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, safeLimit);
  return {
    schemaVersion: 1,
    query: { retrievalMode: 'vector', scoreKind: 'cosine', embeddingModel: model, dims: embedding.length },
    results: scored.map((hit, i) => ({
      id: hit.row.document_id,
      chunkId: hit.row.chunk_id,
      title: hit.row.title,
      rank: i + 1,
      score: hit.score,
      provenance: { path: hit.row.path, lineStart: Number(hit.row.line_start), lineEnd: Number(hit.row.line_end) },
      snippet: hit.row.text,
    })),
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
  const result = spawnSync('sqlite3', [db], { input: sql, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024, timeout: 10_000 });
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
