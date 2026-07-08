#!/usr/bin/env node
import { resolveMcpRoot, runMcpServer } from '../src/mcp.js';

try {
  const root = resolveMcpRoot();
  await runMcpServer({ root });
} catch (error) {
  console.error(`zbrain-mcp: ${error.message || String(error)}`);
  process.exitCode = 1;
}
