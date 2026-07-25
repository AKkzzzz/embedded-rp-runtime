import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const values = new Map();
const localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
  key(index) { return Array.from(values.keys())[index] ?? null; },
  get length() { return values.size; }
};
const sandbox = {
  window: null,
  localStorage,
  indexedDB: undefined,
  performance,
  Map,
  Set,
  Promise,
  JSON,
  Date,
  Array,
  Object,
  String,
  Number,
  Boolean,
  RegExp,
  Math,
  Error,
  TypeError,
  console
};
sandbox.window = sandbox;
vm.createContext(sandbox);

function load(relative) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, { filename: relative });
}

load('ui/data/template-data.js');
load('ui/runtime/event-bus.js');
load('ui/runtime/storage-engine.js');
sandbox.RPHost = { capabilities: () => ({ embeddings: true }) };
load('ui/runtime/memory-engine.js');
await sandbox.RPMemory.init();

let calls = 0;
sandbox.RPModels = {
  routes: () => ({ summary: { model: 'summary-test', temperature: 0.2 } }),
  generate: async (_route, messages) => {
    calls += 1;
    const target = messages.find(message => String(message.content || '').includes('最新对话：唯一总结目标'));
    return { content: '逐轮总结 ' + calls + ' · ' + String(target && target.content || '').slice(-12) };
  }
};
load('ui/runtime/summary-engine.js');
sandbox.RPStorage.savePreferences({ memoryModules: {
  summaryEnabled: true,
  summaryConcurrency: 2,
  maxHistoryFloors: 1
} });

const messages = Array.from({ length: 3 }, (_, index) => ([
  { id: 'u' + (index + 1), role: 'user', content: '用户行动 ' + (index + 1) },
  { id: 'a' + (index + 1), role: 'assistant', content: '剧情结果 ' + (index + 1), reasoning: '不应注入' }
])).flat();

assert.equal(sandbox.RPSummary.pendingJobs(messages), 3);
const first = await sandbox.RPSummary.summarize(messages);
assert.equal(first.added, 3);
assert.equal(first.failed, 0);
assert.equal(calls, 3);
assert.equal(sandbox.RPMemory.stats().classic, 3);
assert.equal(sandbox.RPSummary.pendingJobs(messages), 0);

await sandbox.RPSummary.summarize(messages);
assert.equal(calls, 3);

const context = sandbox.RPSummary.contextHistory(messages, 1);
assert.equal(context.length, 6);
assert.equal(context[1].source.startsWith('memory:classic:'), true);
assert.equal(context[3].source.startsWith('memory:classic:'), true);
assert.equal(context[5].content, '剧情结果 3');
assert.equal(context[5].reasoning, '不应注入');

messages[1].content = '剧情结果 1 已编辑';
assert.equal(sandbox.RPSummary.pendingJobs(messages), 1);
assert.equal(sandbox.RPMemory.stats().classic, 2);
await sandbox.RPSummary.summarize(messages);
assert.equal(calls, 4);
assert.equal(sandbox.RPMemory.stats().classic, 3);

const shortened = messages.slice(0, 4);
sandbox.RPSummary.prune(shortened);
assert.equal(sandbox.RPMemory.stats().classic, 2);
await sandbox.RPMemory.flush();
assert(values.has(sandbox.RPTemplateData.app.storagePrefix + ':structured-memory'));

console.log(JSON.stringify({
  ok: true,
  summaries: sandbox.RPMemory.stats().classic,
  modelCalls: calls,
  duplicateSuppression: true,
  editInvalidation: true,
  deletionPruning: true,
  recentRawFloors: 1,
  storage: sandbox.RPMemory.stats().storage
}, null, 2));
