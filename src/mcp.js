import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { answerQuery } from './answer.js';
import { searchQuery } from './search.js';
import { assertMetadataReady, getDocument, statusIndex } from './store.js';

const MAX_RESPONSE_BYTES = 100 * 1024;
const MAX_OUTPUT_BUDGET = Number(process.env.ZBRAIN_MCP_OUTPUT_BUDGET || 1024 * 1024);
const EXACT_TIMEOUT_MS = Number(process.env.ZBRAIN_MCP_EXACT_TIMEOUT_MS || 10_000);
const LOOPBACK_TIMEOUT_MS = Number(process.env.ZBRAIN_MCP_LOOPBACK_TIMEOUT_MS || 35_000);

export function resolveMcpRoot({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd() } = {}) {
  const rootFlag = argv.indexOf('--root');
  const candidate = rootFlag >= 0 ? argv[rootFlag + 1] : env.ZBRAIN_ROOT || cwd;
  if (!candidate) throw new Error('--root requires a value');
  const resolved = path.resolve(cwd, candidate);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) throw new Error(`brain root not found: ${resolved}`);
  const real = realpathSync(resolved);
  if (!existsSync(path.join(real, '.zbrain/config.json'))) throw new Error(`brain root missing .zbrain/config.json: ${real}`);
  return real;
}

export async function handleMcpMessage(message, context) {
  if (!message || message.jsonrpc !== '2.0' || !message.method) return errorResponse(message?.id ?? null, -32600, 'invalid request');
  if (message.id === undefined) {
    if (message.method === 'notifications/initialized') return null;
    return null;
  }
  try {
    if (message.method === 'initialize') return resultResponse(message.id, initializeResult());
    if (message.method === 'tools/list') return resultResponse(message.id, { tools: toolDescriptors() });
    if (message.method === 'tools/call') return resultResponse(message.id, await callTool(message.params || {}, context));
    return errorResponse(message.id, -32601, `unknown method: ${message.method}`);
  } catch (error) {
    return errorResponse(message.id, -32000, error.message || String(error));
  }
}

export async function runMcpServer({ input = process.stdin, output = process.stdout, error = process.stderr, root = resolveMcpRoot() } = {}) {
  const context = { root, outputBytes: 0 };
  let buffer = Buffer.alloc(0);
  let queue = Promise.resolve();
  input.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    for (const raw of takeMessages()) {
      if (raw.length > 1024 * 1024) {
        writeMessage(output, errorResponse(null, -32700, 'message too large')); 
        continue;
      }
      queue = queue.then(async () => {
        let parsed;
        try { parsed = JSON.parse(raw.toString('utf8')); }
        catch {
          writeMessage(output, errorResponse(null, -32700, 'parse error')); 
          return;
        }
        const response = await handleMcpMessage(parsed, context).catch((err) => errorResponse(parsed.id ?? null, -32000, err.message || String(err)));
        if (response) writeMessage(output, response);
      });
    }
  });
  function takeMessages() {
    const out = [];
    while (buffer.length) {
      const asAscii = buffer.toString('ascii');
      if (asAscii.startsWith('Content-Length:')) {
        const marker = Buffer.from('\r\n\r\n');
        const headerEnd = buffer.indexOf(marker);
        if (headerEnd < 0) break;
        const header = buffer.slice(0, headerEnd).toString('ascii');
        const length = Number((header.match(/Content-Length:\s*(\d+)/i) || [])[1]);
        const start = headerEnd + marker.length;
        if (!Number.isFinite(length)) { out.push(Buffer.from('{bad')); buffer = buffer.slice(start); continue; }
        if (buffer.length < start + length) break;
        out.push(buffer.slice(start, start + length));
        buffer = buffer.slice(start + length);
        continue;
      }
      const index = buffer.indexOf(0x0a);
      if (index < 0) break;
      const line = buffer.slice(0, index).toString('utf8').trim();
      buffer = buffer.slice(index + 1);
      if (line) out.push(Buffer.from(line));
    }
    return out;
  }
  input.on('error', (err) => error.write(`zbrain-mcp input error: ${err.message}\n`));
}

function writeMessage(output, message) {
  const body = JSON.stringify(message);
  output.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function initializeResult() {
  return { protocolVersion: '2024-11-05', serverInfo: { name: 'zbrain', version: '0.8.0' }, capabilities: { tools: {} } };
}

async function callTool(params, context) {
  const name = params.name;
  const args = params.arguments || {};
  const tool = TOOLS[name];
  if (!tool) return toolError('unknown_tool', `unknown tool: ${name}`);
  const bad = unknownArgs(args, tool.allowed);
  if (bad) return toolError('invalid_request', `unknown argument: ${bad}`);
  const timeoutMs = tool.timeout(args);
  return withTimeout(tool.run(args, context), timeoutMs).then((payload) => toolResult(payload, context), (err) => toolError(err.code || 'tool_error', err.message || String(err), err.nextStep));
}

const TOOLS = {
  'zbrain.search': {
    allowed: ['query', 'mode', 'limit', 'filters'],
    timeout: (args) => ['broad', 'hybrid'].includes(args.mode) ? LOOPBACK_TIMEOUT_MS : EXACT_TIMEOUT_MS,
    run: async (args, context) => {
      assertDbExists(context.root);
      const filters = validateFilters(args.filters || {});
      if (Object.keys(filters).length) assertMetadataReady({ cwd: context.root });
      return searchQuery({ cwd: context.root, query: required(args.query, 'query'), mode: args.mode || 'exact', limit: clamp(args.limit, 10, 20), filters });
    },
  },
  'zbrain.get': {
    allowed: ['id', 'from', 'lines'],
    timeout: () => EXACT_TIMEOUT_MS,
    run: async (args, context) => {
      assertDbExists(context.root);
      const doc = getDocument({ cwd: context.root, id: required(args.id, 'id'), from: clamp(args.from, 1, 5000), lines: clamp(args.lines, 40, 200) }).document;
      return { schemaVersion: 1, document: { id: doc.id, path: doc.provenance.path, title: doc.title, lineStart: doc.lineStart, lineEnd: doc.lineEnd, hash: doc.provenance.hash, content: doc.content }, truncated: false };
    },
  },
  'zbrain.answer': {
    allowed: ['query', 'mode', 'limit', 'filters'],
    timeout: (args) => ['broad', 'hybrid'].includes(args.mode) ? LOOPBACK_TIMEOUT_MS : EXACT_TIMEOUT_MS,
    run: async (args, context) => {
      assertDbExists(context.root);
      const filters = validateFilters(args.filters || {});
      if (Object.keys(filters).length) assertMetadataReady({ cwd: context.root });
      return addDocumentIds(await answerQuery({ cwd: context.root, query: required(args.query, 'query'), mode: args.mode || 'exact', limit: clamp(args.limit, 5, 20), filters }));
    },
  },
  'zbrain.status': {
    allowed: [],
    timeout: () => EXACT_TIMEOUT_MS,
    run: async (_args, context) => ({ schemaVersion: 1, effectiveRoot: context.root, status: statusIndex({ cwd: context.root }).status }),
  },
};

function toolResult(payload, context) {
  if (context.outputBytes >= MAX_OUTPUT_BUDGET) return toolError('output_budget_exceeded', 'MCP output budget exceeded');
  let text = JSON.stringify(payload, null, 2);
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    let preview = text.slice(0, MAX_RESPONSE_BYTES - 1024);
    text = JSON.stringify({ schemaVersion: 1, truncated: true, preview }, null, 2);
    while (Buffer.byteLength(text) > MAX_RESPONSE_BYTES && preview.length > 0) {
      preview = preview.slice(0, Math.floor(preview.length * 0.8));
      text = JSON.stringify({ schemaVersion: 1, truncated: true, preview }, null, 2);
    }
  }
  const bytes = Buffer.byteLength(text);
  if (context.outputBytes + bytes > MAX_OUTPUT_BUDGET) return toolError('output_budget_exceeded', 'MCP output budget exceeded');
  context.outputBytes += bytes;
  return { content: [{ type: 'text', text }], isError: false };
}

function toolError(code, message, nextStep = undefined) {
  return { content: [{ type: 'text', text: JSON.stringify({ schemaVersion: 1, error: { code, message, nextStep }, truncated: false }, null, 2) }], isError: true };
}

function resultResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function assertDbExists(root) {
  if (!existsSync(path.join(root, '.zbrain/index.sqlite'))) {
    throw Object.assign(new Error('index missing; run zbrain index'), { code: 'index_requires_upgrade', nextStep: 'zbrain index' });
  }
}

function validateFilters(filters) {
  const allowed = new Set(['pathPrefix', 'project', 'type', 'fromDate', 'toDate']);
  for (const key of Object.keys(filters || {})) {
    if (!allowed.has(key)) throw Object.assign(new Error(`unknown filter: ${key}`), { code: 'invalid_request' });
  }
  return filters || {};
}

function unknownArgs(args, allowed) {
  const allowedSet = new Set(allowed);
  return Object.keys(args).find((key) => !allowedSet.has(key));
}

function required(value, name) {
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

function clamp(value, fallback, max) {
  return Math.max(1, Math.min(Number(value) || fallback, max));
}

function withTimeout(promise, timeoutMs) {
  let timeout;
  const timer = new Promise((_, reject) => { timeout = setTimeout(() => reject(Object.assign(new Error('tool timed out'), { code: 'timeout' })), timeoutMs); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(timeout));
}

function addDocumentIds(payload) {
  for (const citation of payload.answer.citations || []) citation.documentId = citation.path;
  for (const evidence of payload.evidence || []) evidence.documentId = evidence.path;
  return { ...payload, truncated: false };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function toolDescriptors() {
  return [
    { name: 'zbrain.search', description: 'Search the pinned ZBrain index. Defaults to exact/BM25.', inputSchema: searchSchema(10) },
    { name: 'zbrain.get', description: 'Read a bounded excerpt from an indexed document id.', inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' }, from: { type: 'integer', minimum: 1, maximum: 5000, default: 1 }, lines: { type: 'integer', minimum: 1, maximum: 200, default: 40 } } } },
    { name: 'zbrain.answer', description: 'Return extractive cited evidence from the pinned ZBrain index.', inputSchema: searchSchema(5) },
    { name: 'zbrain.status', description: 'Report pinned ZBrain index status and effective root.', inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
  ];
}

function searchSchema(defaultLimit) {
  return { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' }, mode: { type: 'string', enum: ['exact', 'broad', 'hybrid'], default: 'exact' }, limit: { type: 'integer', minimum: 1, maximum: 20, default: defaultLimit }, filters: filterSchema() } };
}

function filterSchema() {
  return { type: 'object', additionalProperties: false, properties: { pathPrefix: { type: 'string' }, project: { type: 'string' }, type: { type: 'string' }, fromDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, toDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } };
}
