import { runBenchmark, writeReports } from './bench.js';
import { assertNoNetworkAvailable, failIfUnsupportedLocalOnly, runInMacSandbox, shouldWrapLocalOnly } from './privacy.js';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expandAliases } from './aliases.js';
import { embedProject, getDocument, indexProject, initProject, loadConfig, queryIndex, statusIndex, vqueryIndex } from './store.js';

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
    if (arg === '--allow-repo-aggregate-output' || arg === '--allow-raw-public-report' || arg === '--force' || arg === '--no-aliases' || arg === '--explain') {
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
  const loopbackCommand = earlyCommand === 'embed' || earlyCommand === 'vquery';
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
  if (command === 'query') {
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
    const result = queryIndex({ query: queryForSearch, limit: parsed.limit });
    if (parsed.explain && parsed.json) {
      result.query = { aliasesApplied: aliasInfo.aliasesApplied };
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
  if (command === 'embed') {
    print(await embedProject(), parsed.json);
    return;
  }
  if (command === 'vquery') {
    const query = parsed._.slice(1).join(' ');
    print(await vqueryIndex({ query, limit: parsed.limit }), parsed.json);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

function print(value, json = false) {
  if (json) console.log(JSON.stringify(value, null, 2));
  else console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`ZBrain CLI\n\nLocal-only is always on. External/network-enabled runs are not supported yet.\n\nCommands:\n  init --path <dir> [--force] [--json]\n  index [--json]\n  query <text> [--limit N] [--json] [--no-aliases] [--explain]
  embed [--json]
  vquery <text> [--limit N] [--json]\n  get <documentId> [--from N] [--lines N] [--json]\n  status [--json]\n  bench --manifest <path> [--mode bm25] [--json out.json] [--md out.md] [--allow-repo-aggregate-output] [--allow-raw-public-report]\n  privacy-probe\n`);
}
