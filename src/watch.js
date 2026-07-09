import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { walkMarkdown } from './bm25.js';
import { embedProject, indexProject, loadConfig } from './store.js';

export async function watchProject({ target = '.', interval = 5, once = false, embedStale = false, cwd = process.cwd() } = {}) {
  const root = resolveUserPath(target, cwd);
  if (!existsSync(path.join(root, '.zbrain/config.json'))) throw new Error('No .zbrain/config.json. Run: zbrain import <path>');
  if (embedStale && !once) throw new Error('watch --embed-stale requires --once; run long-lived watch for indexing and schedule one-shot embed separately');
  const intervalMs = Math.max(1, Number(interval) || 5) * 1000;
  const runOnce = async () => refreshOnce({ root, embedStale });
  if (once) return runOnce();
  let running = false;
  let stopped = false;
  let lastFingerprint = null;
  const loop = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const fingerprint = corpusFingerprint(root);
      if (fingerprint === lastFingerprint) {
        log(root, { ok: true, skipped: true, reason: 'unchanged' });
        return;
      }
      await refreshOnce({ root, embedStale: false });
      lastFingerprint = fingerprint;
    }
    catch (error) { log(root, { ok: false, error: error.message || String(error) }); }
    finally { running = false; }
  };
  await loop();
  const timer = setInterval(loop, intervalMs);
  const stop = () => {
    stopped = true;
    clearInterval(timer);
    log(root, { ok: true, stopped: true });
  };
  process.once('SIGINT', () => { stop(); process.exit(0); });
  process.once('SIGTERM', () => { stop(); process.exit(0); });
  return { schemaVersion: 1, watching: { root, intervalSeconds: intervalMs / 1000, embedStale } };
}

async function refreshOnce({ root, embedStale }) {
  const indexed = indexProject({ cwd: root });
  const result = { schemaVersion: 1, watch: { root, indexed } };
  if (embedStale) result.watch.embedded = await embedProject({ cwd: root, staleOnly: true });
  log(root, { ok: true, indexed, embedded: result.watch.embedded });
  return result;
}

function log(root, row) {
  mkdirSync(path.join(root, '.zbrain'), { recursive: true });
  const file = path.join(root, '.zbrain/watch.log');
  rotateLog(file);
  appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...row })}\n`);
}

function rotateLog(file, maxBytes = 1024 * 1024) {
  if (!existsSync(file)) return;
  if (statSync(file).size <= maxBytes) return;
  renameSync(file, `${file}.1`);
}

function corpusFingerprint(root) {
  const config = loadConfig(root);
  return walkMarkdown(config.rootAbs).map((file) => {
    const stat = statSync(file);
    const rel = path.relative(config.rootAbs, file).replace(/\\/g, '/');
    return `${rel}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
  }).sort().join('\n');
}

function resolveUserPath(value, cwd) {
  const input = String(value || '.');
  if (input === '~') return process.env.HOME || cwd;
  if (input.startsWith('~/')) return path.join(process.env.HOME || cwd, input.slice(2));
  return path.resolve(cwd, input);
}
