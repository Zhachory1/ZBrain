import { loadManifest, runBenchmark, writeReports } from './bench.js';
import { assertNoNetworkAvailable, failIfUnsupportedLocalOnly, runInMacSandbox, shouldWrapLocalOnly } from './privacy.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expandAliases, validateAliases } from './aliases.js';
import { classifyIntent, mergeHybridResults } from './hybrid.js';
import { embedProject, getDocument, importProject, indexProject, initProject, loadConfig, preflightProject, queryIndex, statusIndex, vqueryIndex } from './store.js';

function parseArgs(args) {
  const parsed = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { parsed._.push('help'); continue; }
    if (!arg.startsWith('--')) {
      parsed._.push(arg);
      continue;
    }
    if (arg === '--local-only') continue; // legacy alias; local-only is default
    if (arg === '--allow-network') throw new Error('--allow-network is not supported in M0/M1');
    if (arg === '--allow-repo-aggregate-output' || arg === '--allow-raw-public-report' || arg === '--force' || arg === '--no-aliases' || arg === '--explain' || arg === '--include-paths' || arg === '--stale') {
      parsed[arg.slice(2)] = true;
      continue;
    }
    if (arg === '--json') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) parsed.json = true;
      else { parsed.json = value; i += 1; }
      continue;
    }
    const value = args[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    parsed[arg.slice(2)] = value;
    i += 1;
  }
  return parsed;
}

export async function main(args) {
  if (args.includes('--allow-network')) throw new Error('--allow-network is not supported');
  const earlyCommand = args.find((arg) => !arg.startsWith('--'));
  const loopbackCommand = earlyCommand === 'embed' || earlyCommand === 'vquery' || earlyCommand === 'hquery';
  if (!loopbackCommand) {
    if (shouldWrapLocalOnly(args)) runInMacSandbox(args);
    failIfUnsupportedLocalOnly();
    await assertNoNetworkAvailable();
  }

  const parsed = parseArgs(args);
  const command = parsed._[0];
  if (!command || command === 'help') {
    printHelp();
    return;
  }
  if (command === 'privacy-probe') {
    console.log('local-only network probe passed');
    return;
  }
  if (command === 'bench') {
    if (!parsed.manifest) throw new Error('--manifest is required');
    const result = await runBenchmark({ manifestPath: parsed.manifest, mode: parsed.mode || 'bm25' });
    const report = writeReports({
      ...result,
      jsonPath: parsed.json === true ? undefined : parsed.json,
      mdPath: parsed.md,
      allowRepoAggregateOutput: Boolean(parsed['allow-repo-aggregate-output']),
      allowRawPublicReport: Boolean(parsed['allow-raw-public-report']),
    });
    if (!parsed.json && !parsed.md) console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (command === 'init') {
    const result = initProject({ root: parsed.path, force: Boolean(parsed.force) });
    print(result, parsed.json);
    return;
  }
  if (command === 'index') {
    const result = indexProject();
    print({ schemaVersion: 1, indexed: result }, parsed.json);
    return;
  }
  if (command === 'preflight') {
    const target = parsed._[1];
    print(preflightProject({ root: target, includePaths: Boolean(parsed['include-paths']) }), parsed.json);
    return;
  }
  if (command === 'import') {
    const target = parsed._[1];
    print(importProject({ target, force: Boolean(parsed.force) }), parsed.json);
    return;
  }
  if (command === 'query') {
    assertAllowedOptions(parsed, ['json', 'limit', 'no-aliases', 'explain', ...FILTER_FLAGS]);
    const filters = filtersFromParsed(parsed);
    const query = parsed._.slice(1).join(' ');
    let queryForSearch = query;
    let aliasInfo = { aliasesApplied: [] };
    if (!parsed['no-aliases']) {
      const configPath = path.join(process.cwd(), '.zbrain/config.json');
      if (existsSync(configPath)) {
        const config = loadConfig();
        aliasInfo = expandAliases(query, config.aliases);
        queryForSearch = aliasInfo.expandedQuery;
      }
    }
    const result = queryIndex({ query: queryForSearch, limit: parsed.limit, filters });
    if (parsed.explain && parsed.json) {
      result.query = { ...(result.query || {}), aliasesApplied: aliasInfo.aliasesApplied, filters: Object.keys(filters).length ? filters : undefined };
    }
    print(result, parsed.json);
    return;
  }
  if (command === 'get') {
    const id = parsed._[1];
    const result = getDocument({ id, from: parsed.from, lines: parsed.lines });
    print(result, parsed.json);
    return;
  }
  if (command === 'status') {
    print(statusIndex(), parsed.json);
    return;
  }

  if (command === 'tune') {
    if (!parsed.manifest) throw new Error('--manifest is required');
    if (!parsed.output) throw new Error('--output is required');
    const result = await runBenchmark({ manifestPath: parsed.manifest, mode: 'bm25' });
    const proposal = buildAliasProposal(result.manifest, result.rows, parsed.manifest);
    const output = path.resolve(parsed.output);
    if (result.manifest.corpusClass === 'private') {
      const allowedRoot = path.resolve(process.env.HOME || '', '.zbrain/tuning');
      const rel = path.relative(allowedRoot, output);
      if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('private tune output must be under ~/.zbrain/tuning');
    }
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(proposal, null, 2));
    print({ schemaVersion: 1, output, proposals: Object.keys(proposal.aliases).length }, parsed.json);
    return;
  }

  if (command === 'embed') {
    print(await embedProject({ staleOnly: Boolean(parsed.stale) }), parsed.json);
    return;
  }
  if (command === 'vquery') {
    assertAllowedOptions(parsed, ['json', 'limit', ...FILTER_FLAGS]);
    const filters = filtersFromParsed(parsed);
    const query = parsed._.slice(1).join(' ');
    print(await vqueryIndex({ query, limit: parsed.limit, filters }), parsed.json);
    return;
  }

  if (command === 'hquery') {
    assertAllowedOptions(parsed, ['json', 'limit', 'mode', 'explain', 'no-aliases', ...FILTER_FLAGS]);
    const filters = filtersFromParsed(parsed);
    const query = parsed._.slice(1).join(' ');
    const mode = parsed.mode || classifyIntent(query);
    let queryForSearch = query;
    let aliasInfo = { aliasesApplied: [] };
    if (!parsed['no-aliases']) {
      const configPath = path.join(process.cwd(), '.zbrain/config.json');
      if (existsSync(configPath)) {
        const config = loadConfig();
        aliasInfo = expandAliases(query, config.aliases);
        queryForSearch = aliasInfo.expandedQuery;
      }
    }
    if (mode === 'exact' || mode === 'bm25') {
      const result = queryIndex({ query: queryForSearch, limit: parsed.limit, filters });
      result.query = { ...(result.query || {}), retrievalMode: 'bm25', intent: mode, aliasesApplied: parsed.explain ? aliasInfo.aliasesApplied : undefined, filters: parsed.explain && Object.keys(filters).length ? filters : undefined };
      if (!parsed.explain) delete result.query.aliasesApplied;
      print(result, parsed.json);
      return;
    }
    if (mode === 'broad' || mode === 'vector') {
      const result = await vqueryIndex({ query, limit: parsed.limit, filters });
      result.query.intent = mode;
      if (!parsed.explain) delete result.query.filters;
      print(result, parsed.json);
      return;
    }
    if (mode === 'hybrid') {
      const bm25 = queryIndex({ query: queryForSearch, limit: parsed.limit || 10, filters }).results;
      const vector = (await vqueryIndex({ query, limit: parsed.limit || 10, filters })).results;
      const results = mergeHybridResults({ bm25, vector, limit: Math.max(1, Math.min(Number(parsed.limit) || 10, 100)) });
      const output = { schemaVersion: 1, query: { retrievalMode: 'hybrid', intent: mode, sources: ['bm25', 'vector'], aliasesApplied: parsed.explain ? aliasInfo.aliasesApplied : undefined, filters: parsed.explain && Object.keys(filters).length ? filters : undefined }, results };
      if (!parsed.explain) delete output.query.aliasesApplied;
      print(output, parsed.json);
      return;
    }
    throw new Error(`unknown hquery mode: ${mode}`);
  }


  throw new Error(`unknown command: ${command}`);
}


function buildAliasProposal(manifest, rows, manifestPath) {
  const manifestDir = path.dirname(path.resolve(manifestPath));
  const corpusRoot = path.resolve(manifestDir, manifest.corpusRoot || '.');
  const aliases = {};
  const evidence = {};
  for (const row of rows) {
    if (row.rank !== null) continue;
    const query = manifest.queries.find((q) => q.id === row.id);
    if (!query) continue;
    const key = aliasKey(query.query);
    const values = aliasValues(corpusRoot, query.expected || []);
    if (!key || values.length === 0) continue;
    aliases[key] = values;
    evidence[key] = { queryId: query.id, rank: row.rank };
  }
  validateAliases(aliases);
  return { schemaVersion: 1, aliases, evidence, warning: 'manual_review_required' };
}

const FILTER_FLAGS = ['path-prefix', 'project', 'type', 'from-date', 'to-date'];

const STOPWORDS = new Set(['the','a','an','to','for','of','and','or','in','on','where','what','which','did','we','with','when','how','why','is','are','was']);
function aliasKey(query) {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) || [];
  return terms.filter((t) => !STOPWORDS.has(t) && t.length > 2).slice(0, 4).join(' ').slice(0, 80);
}
function aliasValues(root, expected) {
  const values = [];
  for (const doc of expected) {
    const file = path.join(root, doc);
    if (!existsSync(file)) continue;
    const body = readFileSync(file, 'utf8');
    const title = (body.split('\n').find((l) => l.startsWith('# ')) || '').replace(/^#\s+/, '');
    const text = `${title} ${doc}`;
    const terms = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) || [];
    for (const t of terms) {
      if (!STOPWORDS.has(t) && t.length > 2 && !values.includes(t)) values.push(t);
      if (values.length >= 10) return values;
    }
  }
  return values;
}

function assertAllowedOptions(parsed, allowed) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(parsed)) {
    if (key === '_' || allowedSet.has(key)) continue;
    throw new Error(`unknown option: --${key}`);
  }
}

function filtersFromParsed(parsed) {
  return {
    pathPrefix: parsed['path-prefix'],
    project: parsed.project,
    type: parsed.type,
    fromDate: parsed['from-date'],
    toDate: parsed['to-date'],
  };
}

function print(value, json = false) {
  if (json) console.log(JSON.stringify(value, null, 2));
  else console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`ZBrain CLI\n\nLocal-only is always on. External/network-enabled runs are not supported yet.\n\nCommands:\n  init --path <dir> [--force] [--json]\n  preflight <path> [--include-paths] [--json]\n  import <path> [--force] [--json]\n  index [--json]\n  query <text> [--limit N] [--project slug] [--type type] [--path-prefix path] [--from-date YYYY-MM-DD] [--to-date YYYY-MM-DD] [--json] [--no-aliases] [--explain]
  embed [--stale] [--json]
  vquery <text> [--limit N] [--project slug] [--type type] [--path-prefix path] [--from-date YYYY-MM-DD] [--to-date YYYY-MM-DD] [--json]
  hquery <text> [--mode exact|broad|hybrid] [--limit N] [--project slug] [--type type] [--path-prefix path] [--from-date YYYY-MM-DD] [--to-date YYYY-MM-DD] [--json] [--explain]\n  get <documentId> [--from N] [--lines N] [--json]\n  status [--json]\n  tune --manifest <path> --output <proposal.json> [--json]
  bench --manifest <path> [--mode bm25] [--json out.json] [--md out.md] [--allow-repo-aggregate-output] [--allow-raw-public-report]\n  privacy-probe\n\nFilters are path-derived: project=projects/<slug>, type=folder/type segment, date=first YYYY-MM-DD in relative path.\n`);
}
