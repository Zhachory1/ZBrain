import { runBenchmark, writeReports } from './bench.js';
import { assertNoNetworkAvailable, failIfUnsupportedLocalOnly, runInMacSandbox, shouldWrapLocalOnly } from './privacy.js';

function parseArgs(args) {
  const parsed = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      parsed._.push(arg);
      continue;
    }
    if (arg === '--local-only') continue; // legacy alias; local-only is default
    if (arg === '--allow-network') throw new Error('--allow-network is not supported in M0');
    if (arg === '--allow-repo-aggregate-output' || arg === '--allow-raw-public-report') {
      parsed[arg.slice(2)] = true;
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
  if (args.includes('--allow-network')) throw new Error('--allow-network is not supported in M0');
  if (shouldWrapLocalOnly(args)) runInMacSandbox(args);
  failIfUnsupportedLocalOnly();
  await assertNoNetworkAvailable();

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
      jsonPath: parsed.json,
      mdPath: parsed.md,
      allowRepoAggregateOutput: Boolean(parsed['allow-repo-aggregate-output']),
      allowRawPublicReport: Boolean(parsed['allow-raw-public-report']),
    });
    if (!parsed.json && !parsed.md) {
      console.log(JSON.stringify(report, null, 2));
    }
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

function printHelp() {
  console.log(`ZBrain M0 CLI\n\nLocal-only is always on in M0. External/network-enabled runs are not supported yet.\n\nCommands:\n  bench --manifest <path> [--mode bm25] [--json out.json] [--md out.md] [--allow-repo-aggregate-output] [--allow-raw-public-report]\n  privacy-probe\n`);
}
