#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const GAP_TYPES = ['paraphrase', 'alias', 'conceptual', 'negative-near-miss'];
const SAFE_ID = /^[a-zA-Z0-9_.:-]{1,80}$/;
const FORBIDDEN_KEYS = ['query', 'expected', 'negative', 'snippet', 'top', 'path', 'rows', 'perQuery'];

const args = parseArgs(process.argv.slice(2));
const manifestPath = args.manifest || path.join(homedir(), '.zbrain/evals/private-docs/semantic-manifest.json');
const runId = args['run-id'] || new Date().toISOString().slice(0, 10) + '-private-semantic-bm25';
if (!SAFE_ID.test(runId)) throw new Error('run-id must match SAFE_ID');
const reportPath = args.report;
if (!reportPath) throw new Error('--report is required');

const manifestRaw = readFileSync(manifestPath, 'utf8');
const manifestHash = createHash('sha256').update(manifestRaw).digest('hex').slice(0, 16);
const manifest = JSON.parse(manifestRaw);
const validation = validateManifest(manifest);
const runsRoot = path.join(homedir(), '.zbrain/evals/private-docs/runs');
const rawDir = path.resolve(runsRoot, runId);
if (!rawDir.startsWith(path.resolve(runsRoot) + path.sep)) throw new Error('raw dir escapes private runs root');
mkdirSync(rawDir, { recursive: true, mode: 0o700 });
writeFileSync(path.join(rawDir, 'manifest-validation.json'), JSON.stringify(validation, null, 2), { mode: 0o600 });

let rows = [];
let status = null;
const runStarted = Date.now();
const deadlineMs = runStarted + 5 * 60_000;
if (validation.ok) {
  status = runZbrain(['status', '--json'], manifest.corpusRoot);
  writeFileSync(path.join(rawDir, 'status.json'), JSON.stringify(status, null, 2), { mode: 0o600 });
  if (!status.ok) validation.ok = false;
  else {
    for (const query of manifest.queries) {
      if (Date.now() > deadlineMs) { validation.ok = false; validation.messages.push('whole-run-timeout'); break; }
      rows.push(runQuery(query, manifest.corpusRoot, rawDir));
    }
  }
  writeFileSync(path.join(rawDir, 'raw-local.json'), JSON.stringify({ runId, rows }, null, 2), { mode: 0o600 });
}

const report = buildReport({ manifest, validation, rows, runId, manifestHash, status });
validateRepoReport(report);
writeFileSync(reportPath, renderMarkdown(report));
console.log(renderMarkdown(report));

function runQuery(query, cwd, rawDir) {
  const started = performance.now();
  const result = runZbrain(['query', query.query, '--limit', '10', '--json'], cwd, 10_000);
  const latencyMs = performance.now() - started;
  const results = result.ok ? result.json.results || [] : [];
  const rank = rankOf(query.expected, results);
  const negativeRank = rankOf(query.negative || [], results);
  const row = {
    id: query.id,
    gapType: query.gapType,
    class: query.class,
    ok: result.ok,
    latencyMs,
    rank,
    negativeRank,
    resultCount: results.length,
    errorClass: result.ok ? null : 'query_failed',
    raw: result,
  };
  writeFileSync(path.join(rawDir, `${query.id}.json`), JSON.stringify(row, null, 2), { mode: 0o600 });
  const { raw, ...safe } = row;
  return safe;
}

function runZbrain(commandArgs, cwd, timeout = 10_000) {
  const runner = new URL('./local-only-runner.js', import.meta.url).pathname;
  const bin = new URL('../bin/zbrain.js', import.meta.url).pathname;
  const proc = spawnSync(process.execPath, [runner, process.execPath, bin, ...commandArgs], {
    cwd,
    text: true,
    encoding: 'utf8',
    stdout: 'pipe',
    stderr: 'pipe',
    timeout,
  });
  if (proc.status !== 0) return { ok: false, status: proc.status, stderr: proc.stderr.slice(-500) };
  try { return { ok: true, json: JSON.parse(proc.stdout) }; }
  catch { return { ok: false, status: proc.status, stderr: 'invalid-json' }; }
}

function rankOf(expected, results) {
  const set = new Set((expected || []).map((x) => String(x).toLowerCase()));
  for (let i = 0; i < results.length; i += 1) {
    const id = String(results[i].id || '').toLowerCase();
    if (set.has(id)) return i + 1;
  }
  return null;
}

function validateManifest(manifest) {
  const messages = [];
  let ok = true;
  const root = manifest.corpusRoot;
  if (!root || !existsSync(root)) { ok = false; messages.push('missing corpusRoot'); }
  if (!Array.isArray(manifest.queries) || manifest.queries.length < 12) { ok = false; messages.push('need at least 12 queries'); }
  const counts = Object.fromEntries(GAP_TYPES.map((g) => [g, 0]));
  const ids = new Set();
  for (const query of manifest.queries || []) {
    if (!SAFE_ID.test(query.id || '')) { ok = false; messages.push('unsafe-id'); }
    if (ids.has(query.id)) { ok = false; messages.push('duplicate-id'); }
    ids.add(query.id);
    if (!GAP_TYPES.includes(query.gapType)) { ok = false; messages.push('bad-gap-type'); }
    else counts[query.gapType] += 1;
    if (!query.negative || query.negative.length === 0) { ok = false; messages.push('missing-negative'); }
    const expected = new Set(query.expected || []);
    for (const neg of query.negative || []) {
      if (expected.has(neg)) { ok = false; messages.push('expected-overlaps-negative'); }
    }
    for (const doc of [...(query.expected || []), ...(query.negative || [])]) {
      if (root && !existsSync(path.join(root, doc))) { ok = false; messages.push('missing-doc'); }
    }
  }
  for (const [gap, count] of Object.entries(counts)) {
    if (count < 3) { ok = false; messages.push(`gap-count-${gap}-${count}`); }
  }
  const publicMessages = [];
  publicMessages.push(ok ? 'manifest shape valid' : 'manifest shape invalid; see private raw validation artifact');
  for (const [gap, count] of Object.entries(counts)) publicMessages.push(`${gap}: ${count}`);
  return { ok, messages, publicMessages, counts };
}

function buildReport({ manifest, validation, rows, runId, manifestHash, status }) {
  const byGapType = {};
  for (const gap of GAP_TYPES) byGapType[gap] = summarize(rows.filter((r) => r.gapType === gap));
  const metrics = summarize(rows);
  return {
    schemaVersion: 1,
    runId,
    date: new Date().toISOString().slice(0, 10),
    manifestHash,
    status: status?.ok ? { documents: status.json?.status?.documents ?? null, chunks: status.json?.status?.chunks ?? null, dbSizeBytes: status.json?.status?.dbSizeBytes ?? null } : { unavailable: true },
    decision: !validation.ok ? 'inconclusive-private-suite-invalid' : decide(metrics),
    count: rows.length,
    metrics,
    byGapType,
    validation: { ok: validation.ok, messages: validation.publicMessages, counts: validation.counts },
  };
}

function summarize(rows) {
  const n = rows.length || 1;
  const ranks = rows.map((r) => r.rank);
  const lat = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    count: rows.length,
    recallAt1: rows.filter((r) => r.rank && r.rank <= 1).length / n,
    recallAt3: rows.filter((r) => r.rank && r.rank <= 3).length / n,
    recallAt10: rows.filter((r) => r.rank && r.rank <= 10).length / n,
    mrr: rows.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / n,
    negativeHitAt10: rows.filter((r) => r.negativeRank && r.negativeRank <= 10).length / n,
    missCount: rows.filter((r) => !r.rank || r.rank > 10).length,
    errorCount: rows.filter((r) => !r.ok).length,
    p50LatencyMs: percentile(lat, 50),
    p95LatencyMs: percentile(lat, 95),
  };
}

function decide(metrics) {
  if (metrics.errorCount > 0) return 'inconclusive-private-suite-invalid';
  if (metrics.recallAt10 >= 0.8 && metrics.mrr >= 0.6 && metrics.negativeHitAt10 <= 0.2) return 'bm25-private-semantic-passes';
  return 'bm25-private-semantic-has-misses';
}

function percentile(values, p) {
  if (!values.length) return 0;
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil((p / 100) * values.length) - 1))];
}

function validateRepoReport(report) {
  const serialized = JSON.stringify(report);
  for (const key of FORBIDDEN_KEYS) {
    if (serialized.includes(`"${key}"`)) throw new Error(`repo report contains forbidden key: ${key}`);
  }
  if (serialized.includes('/Users/zhach/private-docs')) throw new Error('repo report contains private-docs absolute path');
}

function renderMarkdown(report) {
  const lines = ['# ZBrain private semantic BM25 baseline', '', `Date: ${report.date}`, `Run: ${report.runId}`, `Manifest hash: ${report.manifestHash}`, `Decision: ${report.decision}`, '', '## Index', '', `- documents: ${report.status.documents ?? 'unavailable'}`, `- chunks: ${report.status.chunks ?? 'unavailable'}`, `- db size bytes: ${report.status.dbSizeBytes ?? 'unavailable'}`, '', '## Overall', '', table(report.metrics), '', '## By gap type', ''];
  for (const [gap, metrics] of Object.entries(report.byGapType)) {
    lines.push(`### ${gap}`, '', table(metrics), '');
  }
  lines.push('## Validation', '', `- valid: ${report.validation.ok}`, ...Array.from(new Set(report.validation.messages)).map((m) => `- ${m}`), '');
  return `${lines.join('\n')}\n`;
}

function table(m) {
  return ['| Metric | Value |', '|---|---:|', `| count | ${m.count} |`, `| recall@1 | ${m.recallAt1.toFixed(3)} |`, `| recall@3 | ${m.recallAt3.toFixed(3)} |`, `| recall@10 | ${m.recallAt10.toFixed(3)} |`, `| MRR | ${m.mrr.toFixed(3)} |`, `| negative hit@10 | ${m.negativeHitAt10.toFixed(3)} |`, `| miss count | ${m.missCount} |`, `| error count | ${m.errorCount} |`, `| p50 latency ms | ${m.p50LatencyMs.toFixed(1)} |`, `| p95 latency ms | ${m.p95LatencyMs.toFixed(1)} |`].join('\n');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    out[argv[i].slice(2)] = argv[i + 1];
    i += 1;
  }
  return out;
}
