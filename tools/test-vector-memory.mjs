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
  removeItem(key) { values.delete(key); }
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
  Math,
  Array,
  Object,
  String,
  Number,
  Boolean,
  RegExp,
  Error,
  TypeError,
  Int8Array,
  Uint8Array,
  ArrayBuffer,
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
load('ui/runtime/regex-engine.js');

let embedCalls = 0;
sandbox.RPHost = { settings: () => ({ embeddingModel: 'test-embedding' }) };
sandbox.RPModels = {
  async embed(inputs) {
    embedCalls += 1;
    await Promise.resolve();
    return inputs.map((_, index) => [1, index + 1, 0]);
  }
};

sandbox.RPStorage.savePreferences({
  memoryModules: {
    vectorEnabled: true,
    autoIndex: true,
    patrolEnabled: false,
    retryEnabled: true,
    maxVectors: 0
  }
});
load('ui/runtime/vector-memory-engine.js');

assert.equal(sandbox.RPVectorMemory.memoryText([
  '[记忆整理]', '隐藏状态', '[现场账本]', '隐藏账本', '[协议与界面自检]',
  '隐藏协议', '[最终执行锁定]', '准备输出', '[COT_END]', '只有这一句是可见正文。'
].join('\n')), '只有这一句是可见正文。');

const conversation = [
  {
    role: 'user',
    content: '我检查站台上的血迹。\n[CHECK_GATE]{"hidden":true}[/CHECK_GATE]'
  },
  {
    role: 'assistant',
    content: [
      '<cot>隐藏推理绝不能进入向量</cot>',
      '手电光下，拖痕一直延伸到检疫闸门。',
      '[ATTACK_RESOLUTION]{"actualDamage":99}[/ATTACK_RESOLUTION]',
      '[DICE_RESULT|success-pool|pool 4d10|8,9,1,2|2|0|4]',
      '[IMAGE_PROMPT|station-secret|forbidden internal image transport]',
      '<active_tool_results>隐藏工具结果</active_tool_results>',
      '</tool_dice>'
    ].join('\n')
  }
];

const concurrent = await Promise.all([
  sandbox.RPVectorMemory.indexMessages(conversation),
  sandbox.RPVectorMemory.indexMessages(conversation)
]);
assert.equal(concurrent.reduce((sum, result) => sum + result.added, 0), 1);
assert.equal(embedCalls, 1, 'concurrent indexing must share one serialized mutation path');
assert.equal(sandbox.RPVectorMemory.list().length, 1);

const indexedText = sandbox.RPVectorMemory.list().map(item => item.sourceText).join('\n');
assert.match(indexedText, /检查站台上的血迹/);
assert.match(indexedText, /拖痕一直延伸到检疫闸门/);
for (const forbidden of [
  '隐藏推理', 'actualDamage', 'DICE_RESULT', 'IMAGE_PROMPT',
  '隐藏工具结果', 'tool_dice', 'CHECK_GATE'
]) {
  assert.equal(indexedText.includes(forbidden), false, forbidden + ' leaked into vector source text');
}

const packed = sandbox.RPVectorMemory.quantize([1, 0, 0]);
const cleanItem = {
  id: 'clean-1',
  sourceText: '角色卡：只有可见叙事进入长期记忆。',
  summary: '旧摘要',
  embeddingQ: packed.embeddingQ,
  embeddingScale: packed.embeddingScale,
  embeddingDims: packed.embeddingDims,
  embeddingEncoding: packed.embeddingEncoding
};
const duplicateItem = { ...cleanItem, id: 'clean-duplicate' };
const cotItem = {
  ...cleanItem,
  id: 'cot-polluted',
  sourceText: '角色卡：<cot>污染推理</cot>可见叙事。'
};
const protocolItem = {
  ...cleanItem,
  id: 'protocol-polluted',
  sourceText: '角色卡：[ATTACK_RESOLUTION]{"actualDamage":30}[/ATTACK_RESOLUTION]'
};

const imported = await sandbox.RPVectorMemory.importData({
  version: 2,
  items: [cleanItem, duplicateItem, cotItem, protocolItem],
  fingerprints: [],
  retryQueue: []
});
assert.equal(imported.imported, 1, 'import must deduplicate and discard transport-polluted embeddings');
const exported = await sandbox.RPVectorMemory.exportData();
assert.equal(exported.version, 2);
assert.equal(exported.items.length, 1);
assert.equal(exported.fingerprints.length, 1);
assert.equal(exported.items[0].fingerprint, exported.fingerprints[0]);
assert.match(exported.items[0].fingerprint, /^v2:/);

await sandbox.RPVectorMemory.clearAll();
assert.equal(sandbox.RPVectorMemory.list().length, 0);

if (process.argv[2]) {
  const bundle = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));
  const sourceVectors = bundle?.context?.vectors || {};
  const sourceCount = Array.isArray(sourceVectors.items) ? sourceVectors.items.length : 0;
  const cleaned = await sandbox.RPVectorMemory.importData(sourceVectors);
  console.log(JSON.stringify({ sourceVectors: sourceCount, retainedCleanVectors: cleaned.imported }));
}

console.log('Vector memory boundary tests passed.');
