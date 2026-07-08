import { existsSync } from 'node:fs';
import path from 'node:path';
import { expandAliases } from './aliases.js';
import { classifyIntent, mergeHybridResults } from './hybrid.js';
import { loadConfig, queryIndex, vqueryIndex } from './store.js';

export async function retrieve({ query, mode = 'auto', limit = 10, filters = {}, noAliases = false, explain = false, cwd = process.cwd() }) {
  const resolvedMode = mode === 'auto' ? classifyIntent(query) : mode;
  let queryForSearch = query;
  let aliasInfo = { aliasesApplied: [] };
  if (!noAliases) {
    const configPath = path.join(cwd, '.zbrain/config.json');
    if (existsSync(configPath)) {
      const config = loadConfig(cwd);
      aliasInfo = expandAliases(query, config.aliases);
      queryForSearch = aliasInfo.expandedQuery;
    }
  }
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
  if (resolvedMode === 'exact' || resolvedMode === 'bm25') {
    const result = queryIndex({ query: queryForSearch, limit: safeLimit, filters, cwd });
    return withQuery(result, { mode: resolvedMode, retrievalMode: 'bm25', network: 'none', filters, aliasInfo, explain });
  }
  if (resolvedMode === 'broad' || resolvedMode === 'vector') {
    const result = await vqueryIndex({ query, limit: safeLimit, filters, cwd });
    return withQuery(result, { mode: resolvedMode, retrievalMode: 'vector', network: 'loopback', filters, aliasInfo, explain });
  }
  if (resolvedMode === 'hybrid') {
    const bm25 = queryIndex({ query: queryForSearch, limit: safeLimit, filters, cwd }).results;
    const vector = (await vqueryIndex({ query, limit: safeLimit, filters, cwd })).results;
    const results = mergeHybridResults({ bm25, vector, limit: safeLimit });
    return withQuery({ schemaVersion: 1, results }, { mode: resolvedMode, retrievalMode: 'hybrid', network: 'loopback', filters, aliasInfo, explain, sources: ['bm25', 'vector'] });
  }
  throw new Error(`unknown hquery mode: ${resolvedMode}`);
}

function withQuery(result, { mode, retrievalMode, network, filters, aliasInfo, explain, sources = undefined }) {
  const activeFilters = Object.fromEntries(Object.entries(filters || {}).filter(([, value]) => value !== undefined));
  const query = {
    ...(result.query || {}),
    retrievalMode,
    intent: mode,
    mode,
    network,
    sources,
    aliasesApplied: explain ? aliasInfo.aliasesApplied : undefined,
    filters: explain && Object.keys(activeFilters).length ? activeFilters : undefined,
  };
  if (!explain) {
    delete query.aliasesApplied;
    delete query.filters;
  }
  if (!sources) delete query.sources;
  return { ...result, query };
}
