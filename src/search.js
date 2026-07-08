import { retrieve } from './retrieval.js';

export async function searchQuery({ query, mode = 'exact', limit = 10, filters = {}, cwd = process.cwd() }) {
  if (!['exact', 'broad', 'hybrid'].includes(mode)) throw new Error(`invalid search mode: ${mode}`);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 20));
  const result = await retrieve({ query, mode, limit: safeLimit, filters, explain: true, cwd });
  return {
    schemaVersion: 1,
    query: {
      text: query,
      mode,
      retrievalMode: result.query.retrievalMode,
      limit: safeLimit,
      filters: activeFilters(filters),
      network: result.query.network,
    },
    results: result.results.map((row) => ({
      rank: row.rank,
      id: row.id,
      score: row.score,
      path: row.provenance?.path,
      title: row.title,
      lineStart: row.provenance?.lineStart,
      lineEnd: row.provenance?.lineEnd,
      hash: row.provenance?.hash,
      snippet: row.snippet,
    })),
    truncated: false,
  };
}

export function formatSearchText(result) {
  if (!result.results.length) return 'No results.\n';
  return `${result.results.map((row) => `${row.rank}. ${row.path}:${row.lineStart}-${row.lineEnd} score=${formatScore(row.score)}\nTitle: ${row.title}\n${String(row.snippet || '').trim()}`).join('\n\n')}\n`;
}

function formatScore(score) {
  const n = Number(score);
  return Number.isFinite(n) ? n.toFixed(3) : String(score);
}

function activeFilters(filters) {
  return Object.fromEntries(Object.entries(filters || {}).filter(([, value]) => value !== undefined));
}
