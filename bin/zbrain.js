#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).catch((error) => {
  const message = error?.message || String(error);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      ok: false,
      error: { code: classify(message), message, retryable: false },
    }, null, 2));
  } else {
    console.error(`Error: ${message}`);
  }
  process.exitCode = 1;
});

function classify(message) {
  if (/not found/i.test(message)) return 'not_found';
  if (/config/i.test(message)) return 'config_missing';
  if (/sqlite/i.test(message)) return 'sqlite_unavailable';
  if (/required|invalid|query|root|chunk id/i.test(message)) return 'invalid_request';
  return 'internal_error';
}
