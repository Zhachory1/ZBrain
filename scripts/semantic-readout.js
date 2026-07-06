#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const manifestPath = process.argv[2] || 'fixtures/semantic/manifest.json';
const resultPath = process.argv[3] || '.cache/semantic-results.json';
const outPath = process.argv[4] || '.cache/semantic-readout.md';

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const result = JSON.parse(readFileSync(resultPath, 'utf8'));
const gates = validateSuite(manifest, manifestPath, result);
const rows = result.rows || [];
const misses = rows.filter((row) => row.rank === null || (row.negativeRank !== null && row.rank !== null && row.negativeRank < row.rank) || row.snippetUseful === false || row.provenanceCorrect === false);
const nearMissPasses = rows.filter((row) => row.negativeRank !== null && row.rank !== null && row.rank < row.negativeRank);
const missGroups = {};
for (const miss of misses) {
  const query = manifest.queries.find((q) => q.id === miss.id);
  const key = query?.missCategoryHypothesis || 'unknown';
  missGroups[key] ||= 0;
  missGroups[key] += 1;
}
const decision = gates.ok ? 'fixture-shape-valid' : 'fixture-shape-invalid';

const lines = [
  '# ZBrain semantic miss taxonomy readout',
  '',
  `Decision: ${decision}`,
  '',
  '## Suite gates',
  '',
  ...gates.messages.map((m) => `- ${m}`),
  '',
  '## Metrics',
  '',
  `- queries: ${manifest.queries.length}`,
  `- recall@10: ${result.metrics.recallAt10.toFixed(3)}`,
  `- MRR: ${result.metrics.mrr.toFixed(3)}`,
  `- negative hit@10: ${result.metrics.negativeHitAt10.toFixed(3)}`,
  `- snippet useful: ${result.metrics.snippetUsefulRate.toFixed(3)}`,
  `- near-miss controls passed: ${nearMissPasses.length}`,
  '',
  '## Candidate-unverified miss hypotheses',
  '',
  ...Object.entries(missGroups).map(([k, v]) => `- ${k}: ${v}`),
  ...(Object.keys(missGroups).length ? [] : ['- none']),
  '',
  'M2 validates fixture shape only. Metrics may show BM25 misses, but candidate miss hypotheses are unverified and do not recommend embeddings, alias tuning, or comparators. Private semantic runs and comparator baselines require a later approved milestone.',
  '',
];
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join('\n'));
console.log(lines.join('\n'));

function validateSuite(m, manifestPath, result) {
  const messages = [];
  let ok = true;
  const manifestDir = path.dirname(manifestPath);
  const corpusRoot = path.resolve(manifestDir, m.corpusRoot || '.');
  const ids = new Set();
  if (m.queries.length < 12) { ok = false; messages.push(`FAIL: expected >=12 queries, got ${m.queries.length}`); }
  else messages.push(`PASS: query count ${m.queries.length} >= 12`);
  const resultIds = new Set((result.rows || []).map((row) => row.id));
  const gapCounts = {};
  for (const query of m.queries) {
    if (ids.has(query.id)) { ok = false; messages.push(`FAIL: duplicate query id ${query.id}`); }
    ids.add(query.id);
    if (!resultIds.has(query.id)) { ok = false; messages.push(`FAIL: missing result row for ${query.id}`); }
    gapCounts[query.gapType] ||= 0;
    gapCounts[query.gapType] += 1;
    if (!query.negative || query.negative.length === 0) { ok = false; messages.push(`FAIL: ${query.id} missing negative doc`); }
    const expected = new Set(query.expected || []);
    for (const neg of query.negative || []) {
      if (expected.has(neg)) { ok = false; messages.push(`FAIL: ${query.id} expected overlaps negative ${neg}`); }
    }
    for (const doc of [...(query.expected || []), ...(query.negative || [])]) {
      const full = path.join(corpusRoot, doc);
      if (!existsSync(full)) { ok = false; messages.push(`FAIL: ${query.id} references missing doc ${doc}`); }
    }
    for (const term of query.expectedSnippetTerms || []) {
      const found = (query.expected || []).some((doc) => {
        const full = path.join(corpusRoot, doc);
        return existsSync(full) && readFileSync(full, 'utf8').toLowerCase().includes(String(term).toLowerCase());
      });
      if (!found) { ok = false; messages.push(`FAIL: ${query.id} expectedSnippetTerm not found: ${term}`); }
    }
  }
  for (const type of ['paraphrase', 'alias', 'conceptual', 'negative-near-miss']) {
    if ((gapCounts[type] || 0) < 3) { ok = false; messages.push(`FAIL: ${type} count ${gapCounts[type] || 0} < 3`); }
    else messages.push(`PASS: ${type} count ${gapCounts[type]}`);
  }
  return { ok, messages };
}
