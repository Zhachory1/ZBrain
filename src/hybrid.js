export function classifyIntent(query) {
  const q = String(query).toLowerCase();
  if (/\b(papers?|research|stud(y|ies)|topic|concept|about|related to|similar to|discuss(es|ing)?|compare|overview)\b/.test(q)) return 'broad';
  if (/\b(session|plan|prd|dd|release|version|tag|ticket|jira|commit|exact|file)\b/.test(q)) return 'exact';
  if (/\b[A-Z]{2,}-?\d+\b/.test(String(query))) return 'exact';
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(q)) return 'exact';
  if (q.length > 80 && /\b(which|what|where|how)\b/.test(q)) return 'broad';
  return 'exact';
}

export function reciprocalRankFusion(lists, weights = {}, k = 60) {
  const scores = new Map();
  const ranks = new Map();
  for (const [source, results] of Object.entries(lists)) {
    const weight = weights[source] ?? 1;
    for (let i = 0; i < results.length; i += 1) {
      const result = results[i];
      const id = result.id;
      scores.set(id, (scores.get(id) || 0) + weight * (1 / (k + i + 1)));
      if (!ranks.has(id)) ranks.set(id, {});
      ranks.get(id)[source] = i + 1;
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || (ranks.get(a[0]).bm25 ?? 9999) - (ranks.get(b[0]).bm25 ?? 9999) || a[0].localeCompare(b[0]))
    .map(([id, score], index) => ({ id, score, rank: index + 1, sourceRanks: ranks.get(id) }));
}

export function mergeHybridResults({ bm25 = [], vector = [], weights = { bm25: 1, vector: 2 }, limit = 10 }) {
  const byId = new Map();
  for (const result of vector) byId.set(result.id, { ...result, source: 'vector' });
  for (const result of bm25) byId.set(result.id, { ...result, source: 'bm25' });
  const fused = reciprocalRankFusion({ bm25, vector }, weights).slice(0, limit);
  return fused.map((fusedResult) => {
    const base = byId.get(fusedResult.id);
    return {
      ...base,
      rank: fusedResult.rank,
      score: fusedResult.score,
      sourceRanks: fusedResult.sourceRanks,
    };
  });
}
