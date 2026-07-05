import { groupByClass, summarizeRows } from './metrics.js';

const SAFE_ID = /^[a-zA-Z0-9_.:-]{1,80}$/;
const TOP_LEVEL_PRIVATE_KEYS = new Set(['schemaVersion', 'corpusClass', 'redacted', 'mode', 'suite', 'indexStats', 'metrics', 'byClass']);
const SUITE_KEYS = new Set(['suiteId', 'manifestHash', 'corpusFingerprint', 'baselineId', 'thresholds']);
const INDEX_KEYS = new Set(['documents', 'totalBytes', 'buildMs', 'runMs', 'caps']);
const METRIC_KEYS = new Set(['count', 'recallAt1', 'recallAt3', 'recallAt10', 'mrr', 'negativeHitAt10', 'provenanceCorrectRate', 'snippetUsefulRate', 'p50LatencyMs', 'p95LatencyMs', 'p99LatencyMs', 'failureRate']);

export function makeReport({ manifest, mode, rows, suite, indexStats, includeRows = false }) {
  const corpusClass = manifest.corpusClass;
  const isPrivate = corpusClass === 'private';
  const report = {
    schemaVersion: 1,
    corpusClass,
    redacted: isPrivate,
    mode,
    suite,
    indexStats,
    metrics: summarizeRows(rows),
    byClass: groupByClass(rows),
  };

  if (!isPrivate && includeRows) {
    report.rows = rows.map((r) => ({ ...r }));
  }
  return report;
}

export function assertRepoSafePrivateReport(report) {
  if (report.corpusClass !== 'private') return;
  for (const key of Object.keys(report)) {
    if (!TOP_LEVEL_PRIVATE_KEYS.has(key)) throw new Error(`repo-bound private report contains unapproved field: ${key}`);
  }
  assertSafeString(report.mode, 'mode');
  assertSuite(report.suite || {});
  assertOnlyKeys(report.indexStats || {}, INDEX_KEYS, 'indexStats');
  assertOnlyKeys(report.metrics || {}, METRIC_KEYS, 'metrics');
  for (const [klass, metrics] of Object.entries(report.byClass || {})) {
    assertSafeString(klass, `byClass key ${klass}`);
    assertOnlyKeys(metrics, METRIC_KEYS, `byClass.${klass}`);
  }
}

function assertSuite(suite) {
  assertOnlyKeys(suite, SUITE_KEYS, 'suite');
  for (const key of ['suiteId', 'manifestHash', 'corpusFingerprint', 'baselineId']) {
    if (suite[key] !== null && suite[key] !== undefined) assertSafeString(String(suite[key]), `suite.${key}`);
  }
}

function assertOnlyKeys(object, allowed, label) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unapproved field: ${key}`);
  }
}

function assertSafeString(value, label) {
  if (!SAFE_ID.test(value)) throw new Error(`unsafe private report string in ${label}`);
}
