import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { isDeniedPath } from './denylist.js';

export const DEFAULT_CAPS = {
  maxFileBytes: 1024 * 1024,
  maxDocuments: 20_000,
  maxTotalBytes: 100 * 1024 * 1024,
  maxDepth: 25,
  maxQueryMs: 5_000,
};

export function tokenize(text) {
  return String(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) || [];
}

export function walkMarkdown(root, rel = '', options = {}) {
  const caps = { ...DEFAULT_CAPS, ...options };
  const depth = rel ? rel.split(path.sep).length : 0;
  if (depth > caps.maxDepth) return [];
  const dir = path.join(root, rel);
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const childRel = path.join(rel, entry.name);
    if (isDeniedPath(childRel)) continue;
    const full = path.join(root, childRel);
    if (entry.isDirectory()) files.push(...walkMarkdown(root, childRel, caps));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const stat = statSync(full);
      if (stat.size <= caps.maxFileBytes) files.push(full);
    }
  }
  return files;
}

export function titleFromMarkdown(body, fallback) {
  const line = body.split('\n').find((l) => l.startsWith('# '));
  return line ? line.replace(/^#\s+/, '').trim() : fallback;
}

export function buildIndex(root, options = {}) {
  const caps = { ...DEFAULT_CAPS, ...options };
  const started = performance.now();
  const files = walkMarkdown(root, '', caps);
  if (files.length > caps.maxDocuments) {
    throw new Error(`corpus exceeds maxDocuments (${files.length} > ${caps.maxDocuments})`);
  }
  const documents = [];
  let totalBytes = 0;
  for (const file of files) {
    const body = readFileSync(file, 'utf8');
    totalBytes += Buffer.byteLength(body);
    if (totalBytes > caps.maxTotalBytes) throw new Error(`corpus exceeds maxTotalBytes (${totalBytes} > ${caps.maxTotalBytes})`);
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const title = titleFromMarkdown(body, rel);
    const tokens = tokenize(`${title} ${rel} ${body}`);
    const freq = new Map();
    for (const token of tokens) freq.set(token, (freq.get(token) || 0) + 1);
    documents.push({ id: rel, path: rel, title, body, freq, length: tokens.length, bytes: Buffer.byteLength(body) });
  }
  const df = new Map();
  for (const doc of documents) {
    for (const term of doc.freq.keys()) df.set(term, (df.get(term) || 0) + 1);
  }
  const totalLength = documents.reduce((sum, doc) => sum + doc.length, 0);
  return {
    documents,
    df,
    avgdl: totalLength / (documents.length || 1) || 1,
    totalBytes,
    buildMs: performance.now() - started,
    caps,
  };
}

export function searchBm25(index, query, { limit = 10, maxQueryMs = index.caps?.maxQueryMs ?? DEFAULT_CAPS.maxQueryMs } = {}) {
  const started = performance.now();
  const terms = [...new Set(tokenize(query))];
  const n = index.documents.length || 1;
  const k1 = 1.2;
  const b = 0.75;
  const scored = [];
  for (const doc of index.documents) {
    let score = 0;
    const titleLower = doc.title.toLowerCase();
    const pathLower = doc.path.toLowerCase();
    for (const term of terms) {
      const f = doc.freq.get(term) || 0;
      if (!f) continue;
      const termDf = index.df.get(term) || 0;
      const idf = Math.log(1 + (n - termDf + 0.5) / (termDf + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (doc.length / index.avgdl))));
      if (titleLower.includes(term)) score += 2;
      if (pathLower.includes(term)) score += 1;
    }
    if (score > 0) scored.push({ id: doc.id, path: doc.path, title: doc.title, score, snippet: snippet(doc.body, terms) });
    if (performance.now() - started > maxQueryMs) throw new Error(`query exceeded maxQueryMs (${maxQueryMs})`);
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

function snippet(body, terms) {
  const lines = body.split('\n');
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const lower = lines[i].toLowerCase();
    const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return lines.slice(Math.max(0, best - 1), Math.min(lines.length, best + 3)).join('\n');
}
