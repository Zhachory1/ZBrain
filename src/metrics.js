export function rankOf(expected, hits) {
  const expectedSet = new Set(expected.map(String));
  for (let i = 0; i < hits.length; i += 1) {
    if (expectedSet.has(String(hits[i].id)) || expectedSet.has(String(hits[i].path))) {
      return i + 1;
    }
  }
  return null;
}

export function reciprocalRank(rank) {
  return rank ? 1 / rank : 0;
}

export function negativeRankOf(negative, hits) {
  const negativeSet = new Set((negative || []).map(String));
  for (let i = 0; i < hits.length; i += 1) {
    if (negativeSet.has(String(hits[i].id)) || negativeSet.has(String(hits[i].path))) return i + 1;
  }
  return null;
}

export function snippetUseful(hit, terms = []) {
  if (!hit || terms.length === 0) return hit ? true : false;
  const text = `${hit.title || ''}\n${hit.snippet || ''}`.toLowerCase();
  return terms.every((term) => text.includes(String(term).toLowerCase()));
}

export function dcgAtK(relevances, k) {
  let score = 0;
  for (let i = 0; i < Math.min(k, relevances.length); i += 1) {
    const rel = relevances[i] || 0;
    score += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
  }
  return score;
}

export function ndcgAtK(relevances, k) {
  const ideal = [...relevances].sort((a, b) => b - a);
  const idcg = dcgAtK(ideal, k);
  if (idcg === 0) return 0;
  return dcgAtK(relevances, k) / idcg;
}

export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function avg(rows, predicate) {
  const n = rows.length || 1;
  return rows.filter(predicate).length / n;
}

export function summarizeRows(rows) {
  const n = rows.length || 1;
  const latencies = rows.map((r) => r.latencyMs);
  const summary = {
    count: rows.length,
    recallAt1: avg(rows, (r) => r.rank !== null && r.rank <= 1),
    recallAt3: avg(rows, (r) => r.rank !== null && r.rank <= 3),
    recallAt10: avg(rows, (r) => r.rank !== null && r.rank <= 10),
    mrr: rows.reduce((sum, r) => sum + reciprocalRank(r.rank), 0) / n,
    negativeHitAt10: avg(rows, (r) => r.negativeRank !== null && r.negativeRank <= 10),
    provenanceCorrectRate: avg(rows, (r) => r.rank !== null),
    snippetUsefulRate: avg(rows, (r) => r.snippetUseful === true),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    failureRate: avg(rows, (r) => Boolean(r.error)),
  };
  return summary;
}

export function groupByClass(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.class)) groups.set(row.class, []);
    groups.get(row.class).push(row);
  }
  return Object.fromEntries([...groups.entries()].map(([klass, items]) => [klass, summarizeRows(items)]));
}
