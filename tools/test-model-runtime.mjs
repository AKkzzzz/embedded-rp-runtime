import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const values = new Map();
const secret = 'test-secret-must-not-leak';
values.set('rp_hub_settings', JSON.stringify({
  apiUrl: 'https://example.invalid/v1',
  apiKey: secret,
  model: 'official-current',
  qualityModel: 'official-quality',
  balancedModel: 'official-balanced',
  fastModel: 'official-fast',
  uiTemplateModel: 'official-variable',
  embeddingModel: 'official-embedding',
  summaryModel: 'official-summary',
  temperature: 0.73,
  stream: true,
  top_p: 0.91,
  max_completion_tokens: 4096,
  frequency_penalty: 0.12,
  presence_penalty: 0.23,
  stop_sequences: ['<END>'],
  reasoning_effort: 'high',
  providerParameters: { seed: 42, service_tier: 'auto', api_token: 'must-be-filtered' }
}));

const requests = [];
const responses = [];
const localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); }
};

const sandbox = {
  window: null,
  parent: null,
  localStorage,
  indexedDB: undefined,
  performance,
  fetch: async (url, options = {}) => {
    requests.push({ url, options });
    if (!responses.length) throw new Error('missing fake response');
    return responses.shift();
  },
  Response,
  Blob,
  ReadableStream,
  TextDecoder,
  TextEncoder,
  AbortController,
  DOMException,
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
  Error,
  TypeError,
  console
};
sandbox.window = sandbox;
sandbox.parent = sandbox;
vm.createContext(sandbox);

function load(relative) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, { filename: relative });
}

load('ui/data/template-data.js');
load('ui/runtime/event-bus.js');
load('ui/runtime/storage-engine.js');
load('ui/runtime/host-bridge.js');
sandbox.RPPlugins = { run: async (_hook, value) => value };
load('ui/runtime/generation-monitor.js');
load('ui/runtime/model-gateway.js');

const caps = await sandbox.RPHost.detect();
assert.equal(caps.sameOriginSettings, true);
assert.equal(sandbox.RPHost.settings().hasApiKey, true);
assert.equal(JSON.stringify(sandbox.RPHost.settings()).includes(secret), false);
assert.equal(sandbox.RPHost.resolveModel('quality'), 'official-quality');
assert.equal(sandbox.RPHost.resolveModel('variable'), 'official-variable');
assert.equal(sandbox.RPHost.settings().generationParameters.topP, 0.91);
assert.equal(sandbox.RPHost.settings().generationParameters.maxCompletionTokens, 4096);
assert.equal(sandbox.RPHost.settings().generationParameters.providerParameters.seed, 42);
assert.equal(sandbox.RPHost.settings().generationParameters.providerParameters.api_token, undefined);

responses.push(new Response(JSON.stringify({ data: [{ id: 'official-current' }, { id: 'second-model' }] }), {
  status: 200,
  headers: { 'content-type': 'application/json' }
}));
assert.equal((await sandbox.RPModels.refreshModels()).length, 2);
assert.equal(requests.at(-1).url, 'https://example.invalid/v1/models');
assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer ' + secret);

const sse = [
  'data: {"choices":[{"delta":{"reasoning_content":"想"}}]}',
  '',
  'data: {"choices":[{"delta":{"content":"你"}}]}',
  '',
  'data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}',
  '',
  'data: [DONE]',
  ''
].join('\n');
responses.push(new Response(sse, {
  status: 200,
  headers: { 'content-type': 'text/event-stream' }
}));
const deltas = [];
const streamed = await sandbox.RPModels.generate('narrative', [{ role: 'user', content: '测试' }], {
  onDelta(delta) { deltas.push(delta); }
});
assert.equal(streamed.content, '你好');
assert.equal(streamed.reasoning, '想');
assert.deepEqual(deltas, ['你', '好']);
assert.equal(sandbox.RPGenerationMonitor.snapshot().phase, 'complete');
assert.equal(sandbox.RPGenerationMonitor.snapshot().reasoningChars, 1);
assert.equal(sandbox.RPGenerationMonitor.snapshot().contentChars, 2);
const payload = JSON.parse(requests.at(-1).options.body);
assert.equal(payload.model, 'official-current');
assert.equal(payload.temperature, 0.82);
assert.equal(payload.stream, true);
assert.equal(payload.top_p, 0.91);
assert.equal(payload.max_completion_tokens, 4096);
assert.equal(payload.max_tokens, undefined);
assert.equal(payload.frequency_penalty, 0.12);
assert.equal(payload.presence_penalty, 0.23);
assert.deepEqual(payload.stop, ['<END>']);
assert.equal(payload.reasoning_effort, 'high');
assert.equal(payload.seed, 42);
assert.equal(payload.service_tier, 'auto');
assert.equal(payload.api_token, undefined);

responses.push(new Response(JSON.stringify({
  choices: [{ message: { content: '非流式回复', reasoning: '内部推理' }, finish_reason: 'stop' }]
}), {
  status: 200,
  headers: { 'content-type': 'application/json' }
}));
const jsonResult = await sandbox.RPModels.generate('narrative', [{ role: 'user', content: '测试' }], { stream: false });
assert.equal(jsonResult.content, '非流式回复');
assert.equal(jsonResult.reasoning, '内部推理');

responses.push(new Response(JSON.stringify({
  data: [{ index: 0, embedding: [1, 0, 0] }]
}), {
  status: 200,
  headers: { 'content-type': 'application/json' }
}));
assert.deepEqual(await sandbox.RPModels.embed(['历史内容']), [[1, 0, 0]]);
load('ui/runtime/vector-memory-engine.js');
const packedVector = sandbox.RPVectorMemory.quantize([1, -0.5, 0]);
assert.equal(packedVector.embeddingEncoding, 'int8:maxabs:v1');
assert.equal(packedVector.embeddingDims, 3);
assert.deepEqual(Array.from(sandbox.RPVectorMemory.decode(packedVector.embeddingQ)), [127, -63, 0]);
assert.equal(sandbox.RPVectorMemory.cosine([1, 0], new Int8Array([127, 0])), 1);
sandbox.RPStorage.savePreferences({ memoryModules: { vectorEnabled: true, autoIndex: true, topK: 10, similarityThreshold: 0.5 } });
responses.push(new Response(JSON.stringify({ data: [
  { index: 0, embedding: [1, 0, 0] },
  { index: 1, embedding: [0.9, 0.1, 0] }
] }), { status: 200, headers: { 'content-type': 'application/json' } }));
assert.equal((await sandbox.RPVectorMemory.indexMessages([
  { role: 'user', content: '旧港口的钟声' },
  { role: 'assistant', content: '我们记住了旧港口。' }
])).added, 2);
responses.push(new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0, 0] }] }), {
  status: 200, headers: { 'content-type': 'application/json' }
}));
assert.equal((await sandbox.RPVectorMemory.search('旧港口')).length, 2);
responses.push(new Response(JSON.stringify({ error: { message: 'temporary embedding failure' } }), {
  status: 503, headers: { 'content-type': 'application/json' }
}));
const queuedVector = await sandbox.RPVectorMemory.indexMessages([
  { role: 'user', content: '唯一的失败队列测试消息' }
]);
assert.equal(queuedVector.queued, 1);
assert.equal(sandbox.RPVectorMemory.stats().pending, 1);
responses.push(new Response(JSON.stringify({
  data: [{ index: 0, embedding: [0.2, 0.8, 0] }]
}), { status: 200, headers: { 'content-type': 'application/json' } }));
await sandbox.RPVectorMemory.retryQueue();
assert.equal(sandbox.RPVectorMemory.stats().pending, 0);
assert.equal(sandbox.RPVectorMemory.stats().encoding, 'int8:maxabs:v1');
sandbox.RPStorage.savePreferences({ memoryModules: { vectorEnabled: false } });

sandbox.RPCardContext = { name: '测试角色', personality: '稳定', scenario: '测试场景' };
load('ui/runtime/regex-engine.js');
load('ui/runtime/tool-engine.js');
assert.equal(sandbox.RPTools.parse('<tool_grep:旧港口>')[0].query, '旧港口');
sandbox.RPPrompt = {
  async compile(input, options) {
    return {
      messages: [{ role: 'system', content: '角色上下文' }]
        .concat(options.history || [])
        .concat([{ role: 'user', content: input }])
    };
  }
};
load('ui/runtime/conversation-engine.js');

responses.push(new Response([
  'data: {"choices":[{"delta":{"content":"第一段"}}]}',
  '',
  'data: {"choices":[{"delta":{"content":"完成"}}]}',
  '',
  'data: [DONE]',
  ''
].join('\n'), {
  status: 200,
  headers: { 'content-type': 'text/event-stream' }
}));
await sandbox.RPConversation.send('开始测试');
assert.equal(sandbox.RPConversation.list().length, 2);
assert.equal(sandbox.RPConversation.list()[0].role, 'user');
assert.equal(sandbox.RPConversation.list()[1].content, '第一段完成');
assert.equal(sandbox.RPStorage.getCanonical().conversation.status, 'idle');
assert.equal(sandbox.RPConversation.debugTrace().response, '第一段完成');
assert.equal(sandbox.RPConversation.debugTrace().input, '开始测试');

responses.push(new Response('data: {"choices":[{"message":{"content":"替代回复"}}]}\n\ndata: [DONE]\n', {
  status: 200,
  headers: { 'content-type': 'text/plain' }
}));
await sandbox.RPConversation.regenerate();
assert.equal(sandbox.RPConversation.list().length, 2);
assert.equal(sandbox.RPConversation.list()[1].content, '替代回复');

const exported = JSON.stringify(sandbox.RPStorage.exportBundle());
const diagnostics = JSON.stringify(sandbox.RPModels.diagnostics());
assert.equal(exported.includes(secret), false);
assert.equal(diagnostics.includes(secret), false);

console.log(JSON.stringify({
  ok: true,
  settingsCompatibility: true,
  models: sandbox.RPModels.models().length,
  streaming: streamed.content,
  jsonFallback: jsonResult.content,
  conversationOperations: true,
  secretLeak: false
}, null, 2));
