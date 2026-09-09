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
values.set('rp_hub_memory_settings', JSON.stringify({
  enabled: true,
  mode: 'vector',
  embeddingModel: 'official-embedding',
  classicModel: 'official-summary',
  vectorTopK: 14,
  similarityThreshold: 55,
  vectorKeepFloors: 60,
  summaryKeepFloors: 24,
  classicConcurrency: 4
}));

const requests = [];
const responses = [];
const localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
  key(index) { return Array.from(values.keys())[index] ?? null; },
  get length() { return values.size; }
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
const generatedImages = [];
sandbox.RPPlugins = {
  run: async (_hook, value) => value,
  isEnabled: id => id === 'runtime.image-generation'
};
sandbox.RPImageGen = {
  get: () => null,
  async generate(prompt, options) {
    generatedImages.push({ prompt, options });
    return { url: 'https://example.invalid/image.png' };
  },
  recordError() {}
};
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
assert.equal(sandbox.RPHost.memorySettings().mode, 'vector');
assert.equal(sandbox.RPHost.memorySettings().vectorTopK, 14);
const inheritedMemory = sandbox.RPStorage.syncMemoryFromHost(sandbox.RPHost.memorySettings());
assert.equal(inheritedMemory.memoryMode, 'vector');
assert.equal(inheritedMemory.vectorKeepFloors, 60);

responses.push(new Response(JSON.stringify({ data: [{ id: 'official-current' }, { id: 'official-embedding' }] }), {
  status: 200,
  headers: { 'content-type': 'application/json' }
}));
assert.equal((await sandbox.RPModels.refreshModels()).length, 2);
assert.deepEqual(sandbox.RPModels.embeddingModels().map(model => model.id), ['official-embedding']);
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
responses.push(new Response(JSON.stringify({
  data: [{ index: 0, embedding: [0, 1, 0, 0] }]
}), {
  status: 200,
  headers: { 'content-type': 'application/json' }
}));
const embeddingProbe = await sandbox.RPModels.testEmbeddingModel('official-embedding');
assert.equal(embeddingProbe.ok, true);
assert.equal(embeddingProbe.model, 'official-embedding');
assert.equal(embeddingProbe.dimensions, 4);
load('ui/runtime/vector-memory-engine.js');
load('ui/runtime/memory-engine.js');
await sandbox.RPMemory.init();
const packedVector = sandbox.RPVectorMemory.quantize([1, -0.5, 0]);
assert.equal(packedVector.embeddingEncoding, 'int8:maxabs:v1');
assert.equal(packedVector.embeddingDims, 3);
assert.deepEqual(Array.from(sandbox.RPVectorMemory.decode(packedVector.embeddingQ)), [127, -63, 0]);
assert.equal(sandbox.RPVectorMemory.cosine([1, 0], new Int8Array([127, 0])), 1);
sandbox.RPStorage.savePreferences({ memoryModules: {
  vectorEnabled: true,
  autoIndex: true,
  maxHistoryFloors: 1,
  topK: 10,
  similarityThreshold: 0.5
} });
const vectorConversation = [
  { role: 'user', content: '旧港口的钟声' },
  { role: 'assistant', content: '我们记住了旧港口。' },
  { role: 'user', content: '仍在眼前的新现场' },
  { role: 'assistant', content: '这部分应保留为近期原文。' }
];
sandbox.RPConversation = { list: () => vectorConversation };
responses.push(new Response(JSON.stringify({ data: [0, 1].map(index => ({
  index, embedding: index < 2 ? [1 - index * 0.1, index * 0.1, 0] : [0, 1, index]
})) }), { status: 200, headers: { 'content-type': 'application/json' } }));
assert.equal((await sandbox.RPVectorMemory.indexMessages(vectorConversation)).added, 2);
assert.equal(sandbox.RPVectorMemory.stats().indexFromFloor, 0);
assert.equal(sandbox.RPVectorMemory.stats().indexedFloors, 2);
assert.equal(sandbox.RPVectorMemory.stats().recallExcludedFloors, 1);
assert.equal(sandbox.RPVectorMemory.indexableMessages([
  { role: 'user', content: '旧' }, { role: 'assistant', content: '旧回复' },
  { role: 'user', content: '新' }, { role: 'assistant', content: '新回复' }
]).length, 4);
responses.push(new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0, 0] }] }), {
  status: 200, headers: { 'content-type': 'application/json' }
}));
assert.equal((await sandbox.RPVectorMemory.search('旧港口')).length, 1);
responses.push(new Response(JSON.stringify({ error: { message: 'temporary embedding failure' } }), {
  status: 503, headers: { 'content-type': 'application/json' }
}));
const queuedVector = await sandbox.RPVectorMemory.indexMessages([
  { role: 'user', content: '旧港口的钟声' },
  { role: 'assistant', content: '我们记住了旧港口。' },
  { role: 'user', content: '唯一的失败队列测试消息' },
  { role: 'assistant', content: '' },
  { role: 'user', content: '仍在眼前的新现场' },
  { role: 'assistant', content: '这部分应保留为近期原文。' }
]);
assert.equal(queuedVector.queued, 1);
assert.equal(sandbox.RPVectorMemory.stats().pending, 1);
responses.push(new Response(JSON.stringify({
  data: [{ index: 0, embedding: [0.2, 0.8, 0] }]
}), { status: 200, headers: { 'content-type': 'application/json' } }));
await sandbox.RPVectorMemory.retryQueue();
assert.equal(sandbox.RPVectorMemory.stats().pending, 0);
assert.equal(sandbox.RPVectorMemory.stats().encoding, 'int8:maxabs:v1');
await sandbox.RPVectorMemory.clearAll();
assert.equal(sandbox.RPVectorMemory.stats().total, 0);
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
  'data: {"choices":[{"delta":{"content":"<cot>内部推理不得外漏</cot><active_tool_results>内部结果不得外漏</active_tool_results>第一段[IMAGE_PROMPT|scene-1|rainy station, cinematic light]"}}]}',
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
assert.equal(sandbox.RPConversation.list()[1].content.includes('内部推理不得外漏'), false);
assert.equal(sandbox.RPConversation.list()[1].content.includes('IMAGE_PROMPT'), false);
assert.equal(generatedImages.length, 1);
assert.equal(generatedImages[0].prompt, 'rainy station, cinematic light');
assert.equal(generatedImages[0].options.id, 'scene-1');
assert.equal(generatedImages[0].options.count, 1);

const mutatedBeforeReroll = sandbox.RPStorage.getCanonical();
mutatedBeforeReroll.runtime.started = true;
sandbox.RPStorage.saveCanonical(mutatedBeforeReroll);

responses.push(new Response('data: {"choices":[{"message":{"content":"替代回复"}}]}\n\ndata: [DONE]\n', {
  status: 200,
  headers: { 'content-type': 'text/plain' }
}));
await sandbox.RPConversation.regenerate();
assert.equal(sandbox.RPConversation.list().length, 2);
assert.equal(sandbox.RPConversation.list()[1].content, '替代回复');
assert.equal(sandbox.RPStorage.getCanonical().runtime.started, false, 'reroll restores the state from before the player action');

responses.push(new Response(JSON.stringify({
  choices: [{ message: { content: '改写行动后的回复', reasoning: '' }, finish_reason: 'stop' }]
}), { status: 200, headers: { 'content-type': 'application/json' } }));
await sandbox.RPConversation.reviseLastAction('改写后的开始行动');
assert.equal(sandbox.RPConversation.list()[0].content, '改写后的开始行动');
assert.equal(sandbox.RPConversation.list()[1].content, '改写行动后的回复');

let retryStateSyncs = 0;
sandbox.RPStateSync = {
  clearSuggestions() {},
  async reconcile() { retryStateSyncs += 1; }
};
responses.push(new Response(JSON.stringify({ error: { message: 'temporary narrative route unavailable' } }), {
  status: 503,
  headers: { 'content-type': 'application/json' }
}));
await assert.rejects(sandbox.RPConversation.send('失败后只重试这一次输入'), /temporary narrative route unavailable/);
assert.equal(sandbox.RPGenerationMonitor.snapshot().phase, 'error');
assert.equal(sandbox.RPConversation.canRetryLastGeneration(), true);
assert.equal(sandbox.RPConversation.list().filter(message => message.role === 'user' && message.content === '失败后只重试这一次输入').length, 1);
const firstFailedPrompt = JSON.parse(requests.at(-1).options.body).messages;
responses.push(new Response(JSON.stringify({ error: { message: 'temporary narrative route unavailable again' } }), {
  status: 503,
  headers: { 'content-type': 'application/json' }
}));
await assert.rejects(sandbox.RPConversation.retryLastGeneration(), /temporary narrative route unavailable again/);
assert.equal(sandbox.RPConversation.canRetryLastGeneration(), true, 'a repeated transient failure must remain retryable');
assert.deepEqual(JSON.parse(requests.at(-1).options.body).messages, firstFailedPrompt);
responses.push(new Response(JSON.stringify({
  choices: [{ message: { content: '重试后成功继续', reasoning: '' }, finish_reason: 'stop' }]
}), {
  status: 200,
  headers: { 'content-type': 'application/json' }
}));
await sandbox.RPConversation.retryLastGeneration();
await sandbox.RPConversation.whenStateSettled();
assert.equal(sandbox.RPConversation.canRetryLastGeneration(), false);
assert.equal(sandbox.RPGenerationMonitor.snapshot().phase, 'complete');
assert.deepEqual(JSON.parse(requests.at(-1).options.body).messages, firstFailedPrompt);
assert.equal(sandbox.RPConversation.list().filter(message => message.role === 'user' && message.content === '失败后只重试这一次输入').length, 1);
assert.equal(sandbox.RPConversation.list().at(-1).content, '重试后成功继续');
assert.equal(retryStateSyncs, 1, 'failed attempts must not apply state; the successful retry applies it once');
delete sandbox.RPStateSync;

const normalPromptCompile = sandbox.RPPrompt.compile;
sandbox.RPPrompt.compile = async () => { throw new Error('prompt compilation failed before model request'); };
await assert.rejects(sandbox.RPConversation.send('编译阶段失败也必须可重试'), /prompt compilation failed/);
assert.equal(sandbox.RPGenerationMonitor.snapshot().phase, 'error');
assert.equal(sandbox.RPConversation.canRetryLastGeneration(), true);
sandbox.RPPrompt.compile = normalPromptCompile;
responses.push(new Response(JSON.stringify({
  choices: [{ message: { content: '编译恢复后继续', reasoning: '' }, finish_reason: 'stop' }]
}), {
  status: 200,
  headers: { 'content-type': 'application/json' }
}));
await sandbox.RPConversation.retryLastGeneration();
assert.equal(sandbox.RPConversation.list().filter(message => message.role === 'user' && message.content === '编译阶段失败也必须可重试').length, 1);
assert.equal(sandbox.RPConversation.list().at(-1).content, '编译恢复后继续');

sandbox.RPMemory.addStructured({ id: 'portable-note', kind: 'note', text: '完整存档必须保留这条记忆。' });
values.set(sandbox.RPTemplateData.app.storagePrefix + ':community:notebook', JSON.stringify([{ id: 'note-1', text: '本地笔记' }]));
const fullSave = await sandbox.RPStorage.exportFullBundle();
assert.equal(fullSave.version, 2);
assert(fullSave.context.conversation.messages.length >= 2);
assert(fullSave.context.structuredMemory.entries.some(item => item.id === 'portable-note'));
assert.equal(fullSave.localData.notebook[0].text, '本地笔记');
await sandbox.RPConversation.clear();
sandbox.RPMemory.reset();
values.delete(sandbox.RPTemplateData.app.storagePrefix + ':community:notebook');
await sandbox.RPStorage.importBundle(fullSave);
assert.equal(sandbox.RPConversation.list().length, fullSave.context.conversation.messages.length);
assert(sandbox.RPMemory.listStructured().some(item => item.id === 'portable-note'));
assert.equal(JSON.parse(values.get(sandbox.RPTemplateData.app.storagePrefix + ':community:notebook'))[0].text, '本地笔记');
await sandbox.RPConversation.clear();

let releaseStaleResponse;
responses.push(new Promise(resolve => { releaseStaleResponse = resolve; }));
const staleGeneration = sandbox.RPConversation.send('这条请求会在清档后返回');
for (let attempt = 0; attempt < 20 && !sandbox.RPConversation.isGenerating(); attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 0));
}
assert.equal(sandbox.RPConversation.isGenerating(), true);
await sandbox.RPConversation.clear();
assert.equal(sandbox.RPConversation.isGenerating(), false);
releaseStaleResponse(new Response([
  'data: {"choices":[{"delta":{"content":"不应复活的旧回复"}}]}',
  '',
  'data: [DONE]',
  ''
].join('\n'), {
  status: 200,
  headers: { 'content-type': 'text/event-stream' }
}));
await staleGeneration;
assert.deepEqual(sandbox.RPConversation.list(), []);
assert.deepEqual(sandbox.RPConversation.committed(), []);
assert.deepEqual(sandbox.RPStorage.getCanonical().conversation.messages, []);
await sandbox.RPConversation.whenStateSettled();
values.set(sandbox.RPTemplateData.app.storagePrefix + ':debug-position', '{}');
const resetResult = sandbox.RPStorage.reset();
assert(resetResult.cleared >= 3);
assert.equal(sandbox.RPStorage.getPreferences().memoryModules.maxHistoryFloors, 40);
assert.equal(sandbox.RPStorage.getPreferences().memoryModules.vectorEnabled, false);
assert.equal(values.has(sandbox.RPTemplateData.app.storagePrefix + ':debug-position'), false);

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
  clearRaceGuard: true,
  fullVectorIndexWithRecentRecallExclusion: true,
  fullSaveRoundTrip: true,
  actionRerollRollback: true,
  internalProtocolScrub: true,
  singleImageProtocol: true,
  isolatedReset: true,
  secretLeak: false
}, null, 2));
