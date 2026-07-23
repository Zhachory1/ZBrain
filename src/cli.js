import { loadManifest, runBenchmark, writeReports } from './bench.js';
import { assertNoNetworkAvailable, failIfUnsupportedLocalOnly, runInMacSandbox, shouldWrapLocalOnly } from './privacy.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expandAliases, validateAliases } from './aliases.js';
import { answerQuery, formatAnswerText } from './answer.js';
import { retrieve } from './retrieval.js';
import { formatSearchText, searchQuery } from './search.js';
import { generateBrief } from './brief.js';
import { embedProject, getDocument, importProject, indexProject, initProject, loadConfig, preflightProject, queryIndex, statusIndex, vqueryIndex } from './store.js';
import { watchProject } from './watch.js';

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
    if (arg === '--allow-repo-aggregate-output' || arg === '--allow-raw-public-report' || arg === '--force' || arg === '--no-aliases' || arg === '--explain' || arg === '--include-paths' || arg === '--stale' || arg === '--embed-stale' || arg === '--once' || arg === '--cite' || arg === '--allow-network') {
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
  const answerMode = args[args.indexOf('--mode') + 1];
  const loopbackCommand = earlyCommand === 'embed' || earlyCommand === 'vquery' || earlyCommand === 'hquery' || (earlyCommand === 'watch' && args.includes('--embed-stale')) || ((earlyCommand === 'answer' || earlyCommand === 'search') && ['broad', 'vector', 'hybrid'].includes(answerMode));
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
  if (command === 'watch') {
    const target = parsed._[1] || '.';
    const result = await watchProject({ target, interval: parsed.interval, once: Boolean(parsed.once), embedStale: Boolean(parsed['embed-stale']) });
    print(result, parsed.json);
    return;
  }
  if (command === 'brief') {
    assertAllowedOptions(parsed, ['json', 'period', 'date', 'out', 'days', 'allow-network', ...FILTER_FLAGS]);
    const result = await generateBrief({ period: parsed.period || 'daily', date: parsed.date, out: parsed.out, days: parsed.days, filters: filtersFromParsed(parsed), allowNetwork: Boolean(parsed['allow-network']) });
    print(result, parsed.json);
    return;
  }
  if (command === 'search') {
    assertAllowedOptions(parsed, ['json', 'limit', 'mode', ...FILTER_FLAGS]);
    const mode = parsed.mode || 'exact';
    const result = await searchQuery({ query: parsed._.slice(1).join(' '), mode, limit: parsed.limit, filters: filtersFromParsed(parsed) });
    if (parsed.json) print(result, true);
    else process.stdout.write(formatSearchText(result));
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
    const result = await retrieve({ query: parsed._.slice(1).join(' '), mode: parsed.mode || 'auto', limit: parsed.limit, filters: filtersFromParsed(parsed), noAliases: Boolean(parsed['no-aliases']), explain: Boolean(parsed.explain) });
    print(result, parsed.json);
    return;
  }

  if (command === 'answer') {
    assertAllowedOptions(parsed, ['json', 'limit', 'mode', 'cite', 'no-aliases', ...FILTER_FLAGS]);
    const mode = parsed.mode || 'exact';
    if (!['exact', 'broad', 'hybrid'].includes(mode)) throw new Error(`invalid answer mode: ${mode}`);
    const result = await answerQuery({ query: parsed._.slice(1).join(' '), mode, limit: parsed.limit, filters: filtersFromParsed(parsed), noAliases: Boolean(parsed['no-aliases']) });
    if (parsed.json) print(result, true);
    else process.stdout.write(formatAnswerText(result));
    return;
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
  console.log(`ZBrain CLI\n\nLocal-only is always on. External/network-enabled runs are not supported yet.\n\nCommands:\n  init --path <dir> [--force] [--json]\n  preflight <path> [--include-paths] [--json]\n  import <path> [--force] [--json]\n  watch [path] [--interval N] [--once] [--embed-stale] [--json]\n  brief [--period daily|weekly] [--date YYYY-MM-DD] [--out path] [--days N] [--allow-network] [--project slug] [--type type] [--json]\n  index [--json]\n  search <text> [--mode exact|broad|hybrid] [--limit N] [--project slug] [--type type] [--path-prefix path] [--from-date YYYY-MM-DD] [--to-date YYYY-MM-DD] [--json]
  query <text> [--limit N] [--project slug] [--type type] [--path-prefix path] [--from-date YYYY-MM-DD] [--to-date YYYY-MM-DD] [--json] [--no-aliases] [--explain]
  embed [--stale] [--json]
  vquery <text> [--limit N] [--project slug] [--type type] [--path-prefix path] [--from-date YYYY-MM-DD] [--to-date YYYY-MM-DD] [--json]
  hquery <text> [--mode exact|broad|hybrid] [--limit N] [--project slug] [--type type] [--path-prefix path] [--from-date YYYY-MM-DD] [--to-date YYYY-MM-DD] [--json] [--explain]
  answer <text> [--mode exact|broad|hybrid] [--limit N] [--project slug] [--type type] [--path-prefix path] [--from-date YYYY-MM-DD] [--to-date YYYY-MM-DD] [--cite] [--json]\n  get <documentId> [--from N] [--lines N] [--json]\n  status [--json]\n  tune --manifest <path> --output <proposal.json> [--json]
  bench --manifest <path> [--mode bm25] [--json out.json] [--md out.md] [--allow-repo-aggregate-output] [--allow-raw-public-report]\n  privacy-probe\n\nFilters are path-derived: project=projects/<slug>, type=folder/type segment, date=first YYYY-MM-DD in relative path.\n`);
}
