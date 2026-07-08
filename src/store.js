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
const EMBEDDING_INPUT_VERSION = 'v1:prompt-slice-500';

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

  const indexed = indexProject({ cwd: absTarget, forceRebuild: dbExists && force });
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

export function indexProject({ cwd = process.cwd(), forceRebuild = false } = {}) {
  const config = loadConfig(cwd);
  preflightSqlite();
  mkdirSync(path.join(cwd, ZBRAIN_DIR), { recursive: true });
  const db = path.join(cwd, DB_PATH);
  const docs = readDocuments(config.rootAbs, cwd);
  if (existsSync(db) && !forceRebuild) return updateIndexDb(db, docs);
  const tmp = `${db}.tmp`;
  rmSync(tmp, { force: true });
  createIndexDb(tmp, docs);
  validateDb(tmp, docs.length);
  if (existsSync(db)) {
    rmSync(`${db}-wal`, { force: true });
    rmSync(`${db}-shm`, { force: true });
  }
  renameSync(tmp, db);
  return { dbPath: DB_PATH, documents: docs.length, changed: docs.length, unchanged: 0, deleted: 0 };
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
      metadata: metadataFromPath(rel),
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

function updateIndexDb(db, docs) {
  const tmp = `${db}.tmp`;
  rmSync(tmp, { force: true });
  runSql(db, 'PRAGMA wal_checkpoint(FULL);');
  copyFileSync(db, tmp);
  ensureEmbeddingInputHashColumn(tmp);
  ensureDocumentMetadataColumns(tmp);
  backfillDocumentMetadata(tmp);
  const existing = runSqlJson(tmp, 'SELECT id, hash, project, doc_type, doc_date FROM documents;');
  const existingById = new Map(existing.map((row) => [row.id, row]));
  const incomingIds = new Set(docs.map((doc) => doc.id));
  let changed = 0;
  let unchanged = 0;
  let deleted = 0;
  const statements = ['BEGIN IMMEDIATE;'];
  for (const row of existing) {
    if (!incomingIds.has(row.id)) {
      statements.push(`DELETE FROM documents WHERE id = ${q(row.id)};`);
      statements.push(`DELETE FROM chunks_fts WHERE document_id = ${q(row.id)};`);
      statements.push(`DELETE FROM chunk_embeddings WHERE document_id = ${q(row.id)};`);
      deleted += 1;
    }
  }
  for (const doc of docs) {
    const existingDoc = existingById.get(doc.id);
    if (existingDoc?.hash === doc.hash && metadataMatches(existingDoc, doc.metadata)) {
      unchanged += 1;
      continue;
    }
    statements.push(`DELETE FROM chunks_fts WHERE document_id = ${q(doc.id)};`);
    statements.push(`DELETE FROM chunk_embeddings WHERE document_id = ${q(doc.id)};`);
    statements.push(documentInsertSql(doc));
    for (let i = 0; i < doc.chunks.length; i += 1) statements.push(chunkInsertSql(doc, i));
    changed += 1;
  }
  statements.push('COMMIT;');
  runSql(tmp, statements.join('\n'));
  validateDb(tmp, docs.length);
  validateIndexInvariants(tmp, docs);
  copyFileSync(db, `${db}.bak`);
  renameSync(tmp, db);
  return { dbPath: DB_PATH, documents: docs.length, changed, unchanged, deleted };
}

function createIndexDb(db, docs) {
  const statements = [schemaSql(), 'BEGIN;'];
  for (const doc of docs) {
    statements.push(documentInsertSql(doc));
    for (let i = 0; i < doc.chunks.length; i += 1) statements.push(chunkInsertSql(doc, i));
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
  project TEXT,
  doc_type TEXT,
  doc_date TEXT,
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
  input_hash TEXT,
  updated_at TEXT NOT NULL
);
`;
}

function documentInsertSql(doc) {
  return `INSERT OR REPLACE INTO documents(id,path,title,hash,project,doc_type,doc_date,mtime_ms,size_bytes,body,updated_at) VALUES (${q(doc.id)},${q(doc.path)},${q(doc.title)},${q(doc.hash)},${q(doc.metadata.project)},${q(doc.metadata.type)},${q(doc.metadata.date)},${doc.mtimeMs},${doc.sizeBytes},${q(doc.body)},${q(new Date().toISOString())});`;
}

function chunkInsertSql(doc, i) {
  const chunk = doc.chunks[i];
  const chunkId = `${doc.id}#${i}`;
  return `INSERT INTO chunks_fts(chunk_id,document_id,path,hash,line_start,line_end,title,text) VALUES (${q(chunkId)},${q(doc.id)},${q(doc.path)},${q(doc.hash)},${chunk.lineStart},${chunk.lineEnd},${q(doc.title)},${q(chunk.text)});`;
}

function validateDb(db, expectedDocs) {
  const status = statusIndex({ dbPath: db });
  if (status.status.schemaVersion !== 1) throw new Error('invalid schemaVersion after index');
  if (status.status.documents !== expectedDocs) throw new Error('document count mismatch after index');
}

function validateIndexInvariants(db, docs) {
  const expectedChunks = docs.reduce((sum, doc) => sum + doc.chunks.length, 0);
  const rows = runSqlJson(db, `SELECT (SELECT COUNT(*) FROM chunks_fts) AS chunks, (SELECT COUNT(*) FROM chunks_fts WHERE document_id NOT IN (SELECT id FROM documents)) AS fts_orphans, (SELECT COUNT(*) FROM chunk_embeddings WHERE document_id NOT IN (SELECT id FROM documents)) AS embedding_orphans;`);
  const row = rows[0] || {};
  if (Number(row.chunks) !== expectedChunks) throw new Error('chunk count mismatch after index');
  if (Number(row.fts_orphans) !== 0) throw new Error('fts orphan rows after index');
  if (Number(row.embedding_orphans) !== 0) throw new Error('embedding orphan rows after index');
}

export function assertMetadataReady({ cwd = process.cwd(), dbPath = path.join(cwd, DB_PATH) } = {}) {
  const cols = runSqlJson(dbPath, 'PRAGMA table_info(documents);').map((row) => row.name);
  if (!cols.includes('project') || !cols.includes('doc_type') || !cols.includes('doc_date')) {
    const error = new Error('index metadata missing; run zbrain index');
    error.code = 'index_requires_upgrade';
    error.nextStep = 'zbrain index';
    throw error;
  }
}

function ensureDocumentMetadataColumns(db) {
  const cols = runSqlJson(db, 'PRAGMA table_info(documents);').map((row) => row.name);
  if (!cols.includes('project')) runSql(db, 'ALTER TABLE documents ADD COLUMN project TEXT;');
  if (!cols.includes('doc_type')) runSql(db, 'ALTER TABLE documents ADD COLUMN doc_type TEXT;');
  if (!cols.includes('doc_date')) runSql(db, 'ALTER TABLE documents ADD COLUMN doc_date TEXT;');
}

function backfillDocumentMetadata(db) {
  const rows = runSqlJson(db, 'SELECT id,path,project,doc_type,doc_date FROM documents;');
  const statements = [];
  for (const row of rows) {
    const metadata = metadataFromPath(row.path);
    if (!metadataMatches(row, metadata)) statements.push(`UPDATE documents SET project=${q(metadata.project)}, doc_type=${q(metadata.type)}, doc_date=${q(metadata.date)} WHERE id=${q(row.id)};`);
  }
  if (statements.length) runSql(db, statements.join('\n'));
}

function metadataFromPath(relPath) {
  const normalized = normalizeRel(relPath);
  const parts = normalized.split('/').filter(Boolean);
  let project = null;
  let type = parts[0] || null;
  if (parts[0] === 'projects' && parts[1]) {
    project = parts[1];
    type = parts[2] || 'overview';
  }
  const date = (normalized.match(/\b\d{4}-\d{2}-\d{2}\b/) || [null])[0];
  return { project, type, date };
}

function metadataMatches(row, metadata) {
  return (row.project ?? null) === (metadata.project ?? null)
    && (row.doc_type ?? null) === (metadata.type ?? null)
    && (row.doc_date ?? null) === (metadata.date ?? null);
}

function normalizeFilters(filters = {}) {
  const normalized = {};
  if (filters.pathPrefix) {
    const prefix = normalizeRel(filters.pathPrefix).replace(/^\.\//, '').replace(/\/$/, '');
    if (!prefix || path.isAbsolute(prefix) || prefix.split('/').includes('..')) throw new Error('path-prefix must be a relative path');
    normalized.pathPrefix = prefix;
  }
  if (filters.project) normalized.project = String(filters.project);
  if (filters.type) normalized.type = String(filters.type);
  if (filters.fromDate) normalized.fromDate = normalizeDate(filters.fromDate, 'from-date');
  if (filters.toDate) normalized.toDate = normalizeDate(filters.toDate, 'to-date');
  if (normalized.fromDate && normalized.toDate && normalized.fromDate > normalized.toDate) throw new Error('from-date must be <= to-date');
  return normalized;
}

function normalizeDate(value, label) {
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`${label} must be valid YYYY-MM-DD`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== text) throw new Error(`${label} must be valid YYYY-MM-DD`);
  return text;
}

function hasFilters(filters) {
  return Object.keys(filters).length > 0;
}

function documentFilterWhereSql(filters, alias = null) {
  const col = (name) => (alias ? `${alias}.${name}` : name);
  const clauses = [];
  if (filters.pathPrefix) clauses.push(`(${col('path')} = ${q(filters.pathPrefix)} OR substr(${col('path')}, 1, ${filters.pathPrefix.length + 1}) = ${q(`${filters.pathPrefix}/`)})`);
  if (filters.project) clauses.push(`${col('project')} = ${q(filters.project)}`);
  if (filters.type) clauses.push(`${col('doc_type')} = ${q(filters.type)}`);
  if (filters.fromDate) clauses.push(`${col('doc_date')} >= ${q(filters.fromDate)}`);
  if (filters.toDate) clauses.push(`${col('doc_date')} <= ${q(filters.toDate)}`);
  return clauses.join(' AND ');
}

function documentFilterSubquerySql(filters, documentColumn) {
  if (!hasFilters(filters)) return '';
  const where = documentFilterWhereSql(filters);
  return ` AND ${documentColumn} IN (SELECT id FROM documents WHERE ${where})`;
}

function ensureEmbeddingInputHashColumn(db) {
  const cols = runSqlJson(db, 'PRAGMA table_info(chunk_embeddings);').map((row) => row.name);
  if (!cols.includes('input_hash')) runSql(db, 'ALTER TABLE chunk_embeddings ADD COLUMN input_hash TEXT;');
}

export function queryIndex({ query, limit = 10, cwd = process.cwd(), dbPath = path.join(cwd, DB_PATH), filters = {} }) {
  if (!query) throw new Error('query is required');
  const terms = [...new Set(tokenize(query))].slice(0, 64);
  if (terms.length === 0) throw new Error('query has no searchable terms');
  const normalizedFilters = normalizeFilters(filters);
  if (hasFilters(normalizedFilters)) assertMetadataReady({ cwd, dbPath });
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
  const match = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
  const filterSql = documentFilterSubquerySql(normalizedFilters, 'document_id');
  const sql = `SELECT document_id, chunk_id, path, hash, line_start, line_end, title, text, bm25(chunks_fts) AS raw_score FROM chunks_fts WHERE chunks_fts MATCH ${q(match)}${filterSql} ORDER BY raw_score ASC, path ASC, line_start ASC LIMIT ${safeLimit};`;
  const rows = runSqlJson(dbPath, sql);
  const output = {
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
  if (hasFilters(normalizedFilters)) output.query = { filters: normalizedFilters };
  return output;
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


export async function embedProject({ cwd = process.cwd(), dbPath = path.join(cwd, DB_PATH), staleOnly = false } = {}) {
  if (!existsSync(dbPath)) throw new Error('no index found. Run: zbrain index');
  const config = loadConfig(cwd);
  const embeddingConfig = resolveEmbeddingConfig(config);
  ensureEmbeddingInputHashColumn(dbPath);
  const chunks = runSqlJson(dbPath, `SELECT chunk_id, document_id, path, line_start, line_end, title, text FROM chunks_fts;`);
  const existing = staleOnly ? new Map(runSqlJson(dbPath, `SELECT chunk_id, input_hash FROM chunk_embeddings WHERE model = ${q(embeddingConfig.model)};`).map((row) => [row.chunk_id, row.input_hash])) : new Map();
  let embedded = 0;
  let skipped = 0;
  for (const chunk of chunks) {
    const prompt = embeddingInput(chunk);
    const inputHash = embeddingInputHash(prompt);
    if (staleOnly && existing.get(chunk.chunk_id) === inputHash) {
      skipped += 1;
      continue;
    }
    const { embedding, model } = await embedText(prompt, embeddingConfig);
    runSql(dbPath, `INSERT OR REPLACE INTO chunk_embeddings(chunk_id,document_id,path,line_start,line_end,title,text,model,dims,embedding_json,input_hash,updated_at) VALUES (${q(chunk.chunk_id)},${q(chunk.document_id)},${q(chunk.path)},${Number(chunk.line_start)},${Number(chunk.line_end)},${q(chunk.title)},${q(chunk.text)},${q(model)},${embedding.length},${q(JSON.stringify(embedding))},${q(inputHash)},${q(new Date().toISOString())});`);
    embedded += 1;
  }
  return { schemaVersion: 1, embedded, skipped, model: embeddingConfig.model };
}

function embeddingInput(chunk) {
  return `title: ${chunk.title}\npath: ${chunk.path}\ntext: ${chunk.text}`;
}

function embeddingInputHash(prompt) {
  return createHash('sha256').update(`${EMBEDDING_INPUT_VERSION}\n${String(prompt).slice(0, 500)}`).digest('hex').slice(0, 16);
}

export async function vqueryIndex({ query, limit = 10, cwd = process.cwd(), dbPath = path.join(cwd, DB_PATH), filters = {} }) {
  if (!query) throw new Error('query is required');
  const config = loadConfig(cwd);
  const embeddingConfig = resolveEmbeddingConfig(config);
  const normalizedFilters = normalizeFilters(filters);
  if (hasFilters(normalizedFilters)) assertMetadataReady({ cwd, dbPath });
  const model = embeddingConfig.model;
  const globalRows = runSqlJson(dbPath, `SELECT COUNT(*) AS count FROM chunk_embeddings WHERE model = ${q(model)};`);
  if (Number(globalRows[0]?.count || 0) === 0) throw new Error('no embeddings found. Run: zbrain embed');
  const where = documentFilterWhereSql(normalizedFilters, 'd');
  const rows = runSqlJson(dbPath, `SELECT e.chunk_id, e.document_id, e.path, d.hash, e.line_start, e.line_end, e.title, e.text, e.model, e.dims, e.embedding_json FROM chunk_embeddings e JOIN documents d ON d.id = e.document_id WHERE e.model = ${q(model)}${where ? ` AND ${where}` : ''};`);
  if (rows.length === 0) return { schemaVersion: 1, query: { retrievalMode: 'vector', scoreKind: 'cosine', embeddingModel: model, filters: hasFilters(normalizedFilters) ? normalizedFilters : undefined }, results: [] };
  const { embedding } = await embedText(query, embeddingConfig);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
  const scored = rows.map((row) => ({ row, score: cosine(embedding, JSON.parse(row.embedding_json)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, safeLimit);
  return {
    schemaVersion: 1,
    query: { retrievalMode: 'vector', scoreKind: 'cosine', embeddingModel: model, dims: embedding.length, filters: hasFilters(normalizedFilters) ? normalizedFilters : undefined },
    results: scored.map((hit, i) => ({
      id: hit.row.document_id,
      chunkId: hit.row.chunk_id,
      title: hit.row.title,
      rank: i + 1,
      score: hit.score,
      provenance: { path: hit.row.path, lineStart: Number(hit.row.line_start), lineEnd: Number(hit.row.line_end), hash: hit.row.hash },
      snippet: hit.row.text,
    })),
  };
}

export function preflightSqlite() {
  sqliteVersion();
  if (!fts5Available()) throw new Error('SQLite FTS5 unavailable. Install a SQLite build with FTS5.');
}

function sqliteVersion() {
  const result = spawnSync('sqlite3', ['--version'], { encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) throw new Error('sqlite3 not found. Install SQLite with FTS5 support.');
  return result.stdout.trim().split(/\s+/)[0];
}

function fts5Available() {
  const result = spawnSync('sqlite3', [':memory:'], { input: 'CREATE VIRTUAL TABLE x USING fts5(y);', encoding: 'utf8', timeout: 10_000 });
  return result.status === 0;
}

function runSql(db, sql) {
  const result = spawnSync('sqlite3', [db], { input: `.bail on\n${sql}`, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024, timeout: 10_000 });
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
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function assertInside(root, candidate, message) {
  const rootReal = realpathSync(root);
  const candidateReal = existsSync(candidate) ? realpathSync(candidate) : path.resolve(candidate);
  const relative = path.relative(rootReal, candidateReal);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(message);
}
