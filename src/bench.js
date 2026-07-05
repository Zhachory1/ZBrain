import { mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildIndex, searchBm25 } from './bm25.js';
import { negativeRankOf, rankOf, snippetUseful } from './metrics.js';
import { assertRepoSafePrivateReport, makeReport } from './redaction.js';

const CORPUS_CLASSES = new Set(['synthetic', 'private']);
const QUERY_CLASSES = new Set(['exact_lookup', 'recent_session', 'decision_lookup', 'project_status', 'fuzzy_memory', 'acronym_heavy']);

export function loadManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error('manifest schemaVersion must be 1');
  if (!manifest.suiteId) throw new Error('manifest suiteId is required');
  if (!CORPUS_CLASSES.has(manifest.corpusClass)) throw new Error('manifest corpusClass must be synthetic or private');
  if (!Array.isArray(manifest.queries)) throw new Error('manifest queries must be an array');
  for (const query of manifest.queries) {
    if (!query.id || !query.class || !query.query || !Array.isArray(query.expected)) {
      throw new Error(`invalid query in manifest: ${query.id || '<missing id>'}`);
    }
    if (!QUERY_CLASSES.has(query.class)) {
      throw new Error(`invalid query class in manifest: ${query.class}`);
    }
  }
  manifest.thresholds = sanitizeThresholds(manifest.thresholds || {});
  return manifest;
}



function hashFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
}

function fingerprintCorpus(root) {
  const hash = createHash('sha256');
  const files = listFiles(root).sort();
  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const stat = statSync(file);
    hash.update(`${rel}:${stat.size}:${stat.mtimeMs}\n`);
  }
  return hash.digest('hex').slice(0, 16);
}

function listFiles(root, rel = '') {
  const full = path.join(root, rel);
  const entries = readdirSync(full, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const childRel = path.join(rel, entry.name);
    const childFull = path.join(root, childRel);
    if (entry.isDirectory()) files.push(...listFiles(root, childRel));
    else if (entry.isFile()) files.push(childFull);
  }
  return files;
}


const THRESHOLD_KEYS = new Set(['recallAt1', 'recallAt3', 'recallAt10', 'mrr', 'negativeHitAt10', 'provenanceCorrectRate', 'snippetUsefulRate', 'failureRate', 'p95LatencyMs', 'p99LatencyMs']);

function sanitizeThresholds(thresholds) {
  const clean = {};
  for (const [key, value] of Object.entries(thresholds)) {
    if (!THRESHOLD_KEYS.has(key)) throw new Error(`invalid threshold key: ${key}`);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`invalid threshold value for ${key}`);
    clean[key] = value;
  }
  return clean;
}

function assertAllowedCorpusRoot({ manifest, manifestDir, corpusRoot }) {
  const realManifestDir = realpathSync(path.resolve(manifestDir));
  const realCorpusRoot = realpathSync(corpusRoot);
  const relative = path.relative(realManifestDir, realCorpusRoot);
  const insideManifestDir = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  if (insideManifestDir) return;
  if (manifest.corpusClass === 'private' && manifest.allowExternalCorpusRoot === true) return;
  throw new Error('manifest corpusRoot must stay inside manifest directory unless private allowExternalCorpusRoot is true');
}

export async function runBenchmark({ manifestPath, mode = 'bm25' }) {
  const runStarted = performance.now();
  const manifest = loadManifest(manifestPath);
  const manifestHash = hashFile(manifestPath);
  const manifestDir = path.dirname(manifestPath);
  const corpusRoot = path.resolve(manifestDir, manifest.corpusRoot || '.');
  assertAllowedCorpusRoot({ manifest, manifestDir, corpusRoot });
  if (mode !== 'bm25') throw new Error(`unsupported mode for M0: ${mode}`);
  const index = buildIndex(corpusRoot);
  const corpusFingerprint = manifest.corpusClass === 'private' ? 'private-redacted' : fingerprintCorpus(corpusRoot);
  const rows = [];
  for (const query of manifest.queries) {
    const start = performance.now();
    try {
      const hits = searchBm25(index, query.query, { limit: 10 });
      const latencyMs = performance.now() - start;
      const rank = rankOf(query.expected || [], hits);
      const negativeRank = negativeRankOf(query.negative || [], hits);
      const expectedHit = rank ? hits[rank - 1] : null;
      rows.push({
        id: query.id,
        class: query.class,
        mode,
        latencyMs,
        rank,
        negativeRank,
        resultCount: hits.length,
        provenanceCorrect: rank !== null,
        snippetUseful: snippetUseful(expectedHit, query.expectedSnippetTerms || []),
        error: null,
        ...(manifest.corpusClass === 'private' ? {} : {
          query: query.query,
          expected: query.expected,
          negative: query.negative || [],
          top: hits[0]?.path ?? null,
          snippet: hits[0]?.snippet ?? null,
        }),
      });
    } catch (error) {
      rows.push({
        id: query.id,
        class: query.class,
        mode,
        latencyMs: performance.now() - start,
        rank: null,
        negativeRank: null,
        resultCount: 0,
        provenanceCorrect: false,
        snippetUseful: false,
        error: 'query_error',
        ...(manifest.corpusClass === 'private' ? {} : { query: query.query, expected: query.expected, negative: query.negative || [] }),
      });
    }
  }
  return {
    manifest,
    mode,
    rows,
    suite: {
      suiteId: manifest.suiteId,
      manifestHash,
      corpusFingerprint,
      baselineId: manifest.baselineId || null,
      thresholds: manifest.thresholds || null,
    },
    indexStats: {
      documents: index.documents.length,
      totalBytes: index.totalBytes,
      buildMs: index.buildMs,
      runMs: performance.now() - runStarted,
      caps: index.caps,
    },
  };
}

export function writeReports({ manifest, mode, rows, suite, indexStats, jsonPath, mdPath, allowRepoAggregateOutput = false, allowRawPublicReport = false, cwd = process.cwd(), privateRoot = `${process.env.HOME || ''}/.zbrain/evals/private-docs` }) {
  const report = makeReport({ manifest, mode, rows, suite, indexStats, includeRows: allowRawPublicReport });
  applyThresholds(report);
  assertRepoSafePrivateReport(report);
  if (manifest.corpusClass === 'private') {
    for (const outputPath of [jsonPath, mdPath].filter(Boolean)) {
      if (isInside(outputPath, cwd) && !allowRepoAggregateOutput) {
        throw new Error('private repo-bound report output requires --allow-repo-aggregate-output after redaction checks');
      }
      if (!isInside(outputPath, privateRoot) && !isInside(outputPath, cwd)) {
        throw new Error('private report output must be under ~/.zbrain/evals/private-docs or explicitly repo-bound aggregate output');
      }
    }
  }
  if (jsonPath) {
    mkdirSync(path.dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  }
  if (mdPath) {
    mkdirSync(path.dirname(mdPath), { recursive: true });
    writeFileSync(mdPath, markdownReport(report));
  }
  return report;
}

function isInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}


function applyThresholds(report) {
  const thresholds = report.suite?.thresholds || {};
  const checks = [
    ['recallAt1', '>='],
    ['recallAt3', '>='],
    ['recallAt10', '>='],
    ['mrr', '>='],
    ['negativeHitAt10', '<='],
    ['provenanceCorrectRate', '>='],
    ['snippetUsefulRate', '>='],
    ['failureRate', '<='],
    ['p95LatencyMs', '<='],
    ['p99LatencyMs', '<='],
  ];
  const failures = [];
  for (const [metric, op] of checks) {
    if (thresholds[metric] === undefined) continue;
    const actual = report.metrics[metric];
    const expected = thresholds[metric];
    if (op === '>=' && actual < expected) failures.push(`${metric} ${actual} < ${expected}`);
    if (op === '<=' && actual > expected) failures.push(`${metric} ${actual} > ${expected}`);
  }
  if (failures.length) throw new Error(`benchmark thresholds failed: ${failures.join('; ')}`);
}

export function markdownReport(report) {
  const m = report.metrics;
  const lines = [
    '# ZBrain benchmark report',
    '',
    `Corpus class: ${report.corpusClass}`,
    `Mode: ${report.mode}`,
    `Suite: ${report.suite?.suiteId || 'unknown'}`,
    `Manifest hash: ${report.suite?.manifestHash || 'unknown'}`,
    `Corpus fingerprint: ${report.suite?.corpusFingerprint || 'unknown'}`,
    `Redacted: ${report.redacted}`,
    '',
    '## Index',
    '',
    `- Documents: ${report.indexStats?.documents ?? 0}`,
    `- Total bytes: ${report.indexStats?.totalBytes ?? 0}`,
    `- Build ms: ${(report.indexStats?.buildMs ?? 0).toFixed(1)}`,
    `- Run ms: ${(report.indexStats?.runMs ?? 0).toFixed(1)}`,
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| count | ${m.count} |`,
    `| recall@1 | ${m.recallAt1.toFixed(3)} |`,
    `| recall@3 | ${m.recallAt3.toFixed(3)} |`,
    `| recall@10 | ${m.recallAt10.toFixed(3)} |`,
    `| MRR | ${m.mrr.toFixed(3)} |`,
    `| negative hit@10 | ${m.negativeHitAt10.toFixed(3)} |`,
    `| provenance correct | ${m.provenanceCorrectRate.toFixed(3)} |`,
    `| snippet useful | ${m.snippetUsefulRate.toFixed(3)} |`,
    `| p50 latency ms | ${m.p50LatencyMs.toFixed(1)} |`,
    `| p95 latency ms | ${m.p95LatencyMs.toFixed(1)} |`,
    `| p99 latency ms | ${m.p99LatencyMs.toFixed(1)} |`,
    `| failure rate | ${m.failureRate.toFixed(3)} |`,
    '',
    '## By class',
    '',
    '| Class | Count | R@1 | R@3 | R@10 | MRR | Neg@10 | Prov | Snip | p95 ms |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [klass, s] of Object.entries(report.byClass)) {
    lines.push(`| ${klass} | ${s.count} | ${s.recallAt1.toFixed(3)} | ${s.recallAt3.toFixed(3)} | ${s.recallAt10.toFixed(3)} | ${s.mrr.toFixed(3)} | ${s.negativeHitAt10.toFixed(3)} | ${s.provenanceCorrectRate.toFixed(3)} | ${s.snippetUsefulRate.toFixed(3)} | ${s.p95LatencyMs.toFixed(1)} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
