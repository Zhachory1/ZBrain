import net from 'node:net';
import dns from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const VALID_RUNNERS = new Set(['sandbox-exec', 'unshare-net']);

export function shouldWrapLocalOnly(args, env = process.env, platform = process.platform) {
  return env.ZBRAIN_LOCAL_ONLY_ENFORCED !== '1' && platform === 'darwin';
}

export function runInMacSandbox(args) {
  const result = spawnSync(process.execPath, ['scripts/local-only-runner.js', process.execPath, ...process.argv.slice(1, 2), ...args], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
  process.exit(result.status ?? 1);
}

export function failIfUnsupportedLocalOnly(env = process.env, platform = process.platform) {
  if (env.ZBRAIN_LOCAL_ONLY_ENFORCED === '1') {
    if (!VALID_RUNNERS.has(env.ZBRAIN_LOCAL_ONLY_RUNNER)) {
      throw new Error('local-only enforcement marker missing trusted runner');
    }
    assertAttestation(env);
    return;
  }
  if (platform === 'darwin') return;
  throw new Error('local-only mode requires an OS/container network-deny wrapper on this platform');
}

function assertAttestation(env) {
  if (!env.ZBRAIN_LOCAL_ONLY_ATTESTATION_PATH || !env.ZBRAIN_LOCAL_ONLY_TOKEN) {
    throw new Error('local-only attestation missing');
  }
  const parsed = JSON.parse(readFileSync(env.ZBRAIN_LOCAL_ONLY_ATTESTATION_PATH, 'utf8'));
  if (parsed.token !== env.ZBRAIN_LOCAL_ONLY_TOKEN || parsed.runner !== env.ZBRAIN_LOCAL_ONLY_RUNNER) {
    throw new Error('local-only attestation mismatch');
  }
}

export async function assertNoNetworkAvailable({ timeoutMs = 1000 } = {}) {
  const proof = Promise.all([socketDeniedProbe(), dnsDeniedProbe()]);
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`network smoke test timed out after ${timeoutMs}ms`)), timeoutMs).unref?.();
  });
  await Promise.race([proof, timeout]);
}

function socketDeniedProbe() {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '1.1.1.1', port: 80, timeout: 500 });
    socket.on('connect', () => {
      socket.destroy();
      reject(new Error('network probe unexpectedly connected'));
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('network probe timed out instead of being denied by wrapper'));
    });
    socket.on('error', () => resolve('socket-error'));
  });
}

function dnsDeniedProbe() {
  const lookup = dns.lookup('example.com').then(
    () => { throw new Error('dns probe unexpectedly resolved'); },
    () => 'dns-error',
  );
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('dns probe timed out instead of being denied by wrapper')), 500).unref?.();
  });
  return Promise.race([lookup, timeout]);
}

export function auditRow({ purpose, provider, network, corpus, approver = null, artifact = null, redacted = true }) {
  return {
    ts: new Date().toISOString(),
    purpose,
    provider,
    network: Boolean(network),
    corpus,
    approver,
    artifact,
    redacted,
  };
}
