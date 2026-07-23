import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listDocuments, loadConfig } from './store.js';
import { auditRow } from './privacy.js';

const PERIODS = {
  daily: { days: 1, prefix: 'brief-', title: 'Daily brief', instruction: 'Write a concise daily brief. Cover new/updated notes, open threads, and upcoming items. Group related work and keep it skimmable.' },
  weekly: { days: 7, prefix: 'eow-', title: 'End-of-week summary', instruction: 'Write an end-of-week summary. Aggregate the week\u2019s sessions, decisions, plans, and learnings into themed sections.' },
};

export async function generateBrief({ period = 'daily', date, out, days, filters = {}, allowNetwork = false, cwd = process.cwd() } = {}) {
  const spec = PERIODS[period];
  if (!spec) throw new Error(`invalid period: ${period} (expected daily or weekly)`);
  const config = loadConfig(cwd);
  const briefings = config.briefings || {};

  const endDate = normalizeDate(date || today(), 'date');
  const windowDays = Number(days ?? briefings[period]?.days ?? spec.days);
  const fromDate = shiftDate(endDate, -Math.max(1, windowDays));
  const windowFilters = { ...filtersFromConfig(briefings), ...activeFilters(filters), fromDate, toDate: endDate };

  const { documents } = listDocuments({ cwd, filters: windowFilters });
  if (!documents.length) return { schemaVersion: 1, written: false, reason: 'empty', period, fromDate, toDate: endDate };

  const outFile = resolveOutFile({ out, briefings, config, cwd, prefix: spec.prefix, date: endDate });
  const listing = structuredListing({ spec, fromDate, endDate, documents });

  const agent = briefings.agent || DEFAULT_AGENT;
  const useAgent = allowNetwork || agent.allowNetwork === true;
  let body = listing;
  let source = 'offline-listing';
  if (useAgent) {
    const summary = runAgent({ agent, prompt: `${spec.instruction}\n\n${listing}`, cwd });
    if (summary) { body = summary; source = 'agent'; }
  }

  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, body.endsWith('\n') ? body : `${body}\n`);
  writeAudit({ cwd, source, useAgent, agent, outFile, count: documents.length });
  return { schemaVersion: 1, written: true, path: outFile, period, source, documents: documents.length, fromDate, toDate: endDate };
}

const DEFAULT_AGENT = { command: 'mewrite', args: ['exec', '--output-last-message', '{outFile}', '{prompt}'] };

function runAgent({ agent, prompt, cwd }) {
  if (!agent.command) throw new Error('briefings.agent.command is required for network summarization');
  const tmp = mkdtempSync(path.join(tmpdir(), 'zbrain-brief-'));
  const agentOut = path.join(tmp, 'summary.md');
  try {
    const args = (agent.args || []).map((arg) => arg.replaceAll('{prompt}', prompt).replaceAll('{outFile}', agentOut));
    const result = spawnSync(agent.command, args, { cwd, encoding: 'utf8', input: prompt });
    if (result.status !== 0) throw new Error(`agent failed (exit ${result.status ?? 'null'}): ${(result.stderr || '').trim().slice(0, 500)}`);
    const wantsOutFile = (agent.args || []).some((arg) => arg.includes('{outFile}'));
    const text = wantsOutFile ? readFileSync(agentOut, 'utf8') : result.stdout;
    return String(text || '').trim();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function structuredListing({ spec, fromDate, endDate, documents }) {
  const lines = [`# ${spec.title} (${fromDate} \u2192 ${endDate})`, ''];
  const groups = new Map();
  for (const doc of documents) {
    const key = doc.type || 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  }
  for (const key of [...groups.keys()].sort()) {
    lines.push(`## ${key}`, '');
    for (const doc of groups.get(key)) {
      const meta = [doc.date, doc.project].filter(Boolean).join(', ');
      lines.push(`- ${doc.title || doc.path}${meta ? ` (${meta})` : ''} \u2014 \`${doc.path}\``);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function resolveOutFile({ out, briefings, config, cwd, prefix, date }) {
  if (out) return path.resolve(cwd, out);
  const dir = briefings.outputDir ? path.resolve(cwd, briefings.outputDir) : path.join(config.rootAbs, 'inbox');
  return path.join(dir, `${prefix}${date}.md`);
}

function writeAudit({ cwd, source, useAgent, agent, outFile, count }) {
  const row = auditRow({ purpose: 'brief', provider: useAgent ? agent.command : 'local', network: source === 'agent', corpus: cwd, artifact: outFile });
  const dir = path.join(cwd, '.zbrain');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'brief-audit.log'), `${JSON.stringify({ ...row, documents: count })}\n`, { flag: 'a' });
}

function filtersFromConfig(briefings) {
  return activeFilters(briefings.filters || {});
}

function activeFilters(filters) {
  return Object.fromEntries(Object.entries(filters || {}).filter(([, value]) => value !== undefined));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(value, label) {
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must be valid YYYY-MM-DD`);
  const d = new Date(`${text}T00:00:00Z`);
  if (d.toISOString().slice(0, 10) !== text) throw new Error(`${label} must be valid YYYY-MM-DD`);
  return text;
}

function shiftDate(date, deltaDays) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}
