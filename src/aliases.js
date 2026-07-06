import { tokenize } from './bm25.js';

const MAX_ALIASES = 200;
const MAX_EXPANSIONS = 10;
const MAX_LEN = 80;
const MAX_TERMS = 128;

export function validateAliases(aliases) {
  if (aliases === undefined) return {};
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) throw new Error('aliases must be an object');
  const entries = Object.entries(aliases);
  if (entries.length > MAX_ALIASES) throw new Error(`aliases exceed max count ${MAX_ALIASES}`);
  for (const [key, values] of entries) {
    validateAliasString(key, 'alias key');
    if (!Array.isArray(values)) throw new Error(`alias values for ${key} must be an array`);
    if (values.length > MAX_EXPANSIONS) throw new Error(`alias values for ${key} exceed max count ${MAX_EXPANSIONS}`);
    for (const value of values) validateAliasString(value, `alias value for ${key}`);
  }
  return aliases;
}

function validateAliasString(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  if (value.length === 0 || value.length > MAX_LEN) throw new Error(`${label} length must be 1..${MAX_LEN}`);
}

export function expandAliases(query, aliases) {
  const validAliases = validateAliases(aliases);
  const originalTerms = tokenize(query);
  const terms = [...originalTerms];
  const seen = new Set(terms);
  const aliasesApplied = [];
  const normalizedQuery = normalize(query);

  for (const [rawKey, rawValues] of Object.entries(validAliases)) {
    const key = normalize(rawKey);
    if (!phraseMatches(normalizedQuery, key)) continue;
    const added = [];
    for (const value of rawValues) {
      for (const term of tokenize(value)) {
        if (seen.has(term)) continue;
        if (terms.length >= MAX_TERMS) break;
        seen.add(term);
        terms.push(term);
        added.push(term);
      }
    }
    if (added.length > 0) aliasesApplied.push({ term: rawKey, expanded: added });
  }

  return {
    terms,
    expandedQuery: terms.join(' '),
    aliasesApplied,
  };
}

function normalize(value) {
  return String(value).toLowerCase().trim().replace(/\s+/g, ' ');
}

function phraseMatches(normalizedQuery, normalizedKey) {
  if (!normalizedKey) return false;
  const escaped = normalizedKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped}($|[^\\p{L}\\p{N}_-])`, 'u').test(normalizedQuery);
}
