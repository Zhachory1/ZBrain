import { getDocument } from './store.js';
import { retrieve } from './retrieval.js';

const STOPWORDS = new Set(['the','a','an','to','for','of','and','or','in','on','where','what','which','did','we','with','when','how','why','is','are','was','were','about','that','this','into','from','decide','decided','decision','decisions']);

export async function answerQuery({ query, mode = 'exact', limit = 5, filters = {}, noAliases = false, cwd = process.cwd() }) {
  if (!['exact', 'broad', 'hybrid'].includes(mode)) throw new Error(`invalid answer mode: ${mode}`);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 20));
  const retrieval = await retrieve({ query, mode, limit: safeLimit, filters, noAliases, explain: true, cwd });
  const queryMeta = {
    text: query,
    mode,
    retrievalMode: retrieval.query.retrievalMode,
    limit: safeLimit,
    filters: activeFilters(filters),
    network: retrieval.query.network,
  };
  if (!retrieval.results.length) return response({ queryMeta, status: 'insufficient_evidence', text: 'Insufficient evidence.', citations: [], evidence: [] });

  const terms = queryTerms(query);
  const evidence = [];
  const citations = [];
  for (const result of retrieval.results) {
    if (evidence.length >= safeLimit) break;
    const citation = evidenceFromResult({ result, terms, cwd, citationId: citations.length + 1 });
    if (!citation) continue;
    citations.push(citation.citation);
    evidence.push(citation.evidence);
  }
  if (!evidence.length) return response({ queryMeta, status: 'weak_evidence', text: 'Weak evidence: retrieval returned results, but no directly quotable support lines passed evidence checks.', citations: [], evidence: [] });
  const text = evidence.map((item) => `- "${item.quote}" [${item.citationId}]`).join('\n');
  return response({ queryMeta, status: 'evidence_found', text, citations, evidence });
}

export function formatAnswerText(result) {
  const lines = [result.answer.text];
  if (result.query.network === 'loopback') lines.push('', '_Used loopback embedding retrieval._');
  if (result.answer.citations.length) {
    lines.push('', 'Citations:');
    for (const c of result.answer.citations) lines.push(`[${c.id}] ${c.path}:${c.lineStart}-${c.lineEnd} — ${c.title} (${c.hash})`);
  }
  return `${lines.join('\n')}\n`;
}

function response({ queryMeta, status, text, citations, evidence }) {
  return { schemaVersion: 1, query: queryMeta, answer: { status, text, citations }, evidence };
}

function evidenceFromResult({ result, terms, cwd, citationId }) {
  const provenance = result.provenance || {};
  if (!result.id || !provenance.hash) return null;
  const from = Number(provenance.lineStart) || 1;
  const lineCount = Math.max(1, (Number(provenance.lineEnd) || from) - from + 1);
  const doc = getDocument({ cwd, id: result.id, from, lines: lineCount }).document;
  if (doc.provenance.hash !== provenance.hash) return null;
  const lines = doc.content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const quote = normalizeEvidenceLine(raw);
    if (!quote) continue;
    if (terms.length && !terms.every((term) => quote.toLowerCase().includes(term))) continue;
    const lineStart = doc.lineStart + i;
    return {
      citation: { id: citationId, path: doc.provenance.path, lineStart, lineEnd: lineStart, title: doc.title, hash: doc.provenance.hash },
      evidence: { citationId, quote, path: doc.provenance.path, lineStart, lineEnd: lineStart },
    };
  }
  return null;
}

function normalizeEvidenceLine(line) {
  const raw = String(line);
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('#')) return '';
  return raw;
}

function queryTerms(query) {
  return [...new Set(String(query).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) || [])]
    .filter((term) => !STOPWORDS.has(term) && term.length > 2)
    .slice(0, 8);
}

function activeFilters(filters) {
  return Object.fromEntries(Object.entries(filters || {}).filter(([, value]) => value !== undefined));
}
