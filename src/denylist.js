export const DEFAULT_DENY_PATTERNS = [
  '.git/',
  '.env',
  'node_modules/',
  '.cache/',
  'dist/',
  'build/',
  '.zbrain/',
];

export function normalizePath(value) {
  return String(value).replace(/\\/g, '/');
}

export function isDeniedPath(path, patterns = DEFAULT_DENY_PATTERNS) {
  const p = normalizePath(path);
  const parts = p.split('/').filter(Boolean);
  for (const pattern of patterns) {
    const normalized = normalizePath(pattern);
    if (normalized.endsWith('/')) {
      const segment = normalized.slice(0, -1);
      if (parts.includes(segment)) return true;
      if (p.includes(`/${segment}/`)) return true;
      continue;
    }
    if (parts.includes(normalized) || p.endsWith(`/${normalized}`) || p === normalized) return true;
  }
  return false;
}
