import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../ui/runtime/vector-memory-engine.js', import.meta.url), 'utf8');
const values = new Map();
const localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
const window = {
  RPTemplateData: { app: { storagePrefix: 'template-branch-memory-test' } },
  RPStorage: { getPreferences: () => ({ memoryModules: { vectorEnabled: true, autoIndex: true, patrolEnabled: false, maxVectors: 0 } }) },
  RPRegex: { stripPromptTransport: value => String(value || '').replace(/<cot>[\s\S]*?<\/cot>/gi, '').trim() },
  RPModels: { embed: async inputs => inputs.map((_value, index) => [1, index + 1, 0.5]) },
  RPHost: { settings: () => ({ embeddingModel: 'test' }) },
  RPEvents: { async emit() {} }
};
window.window = window;
vm.runInNewContext(source, { window, localStorage, console, Promise, JSON, Object, Array, String, Number, Boolean, Math, Date, Error, Set, Map, Uint8Array, Int8Array, ArrayBuffer });

const messages = [];
for (let turn = 1; turn <= 3; turn += 1) messages.push(
  { id: `u-${turn}`, role: 'user', content: `第${turn}轮行动` },
  { id: `a-${turn}`, role: 'assistant', content: `<cot>隐藏</cot>第${turn}轮结果` }
);
assert.equal((await window.RPVectorMemory.indexMessages(messages)).added, 3);
const result = await window.RPVectorMemory.reconcileToMessages(messages.slice(0, 4), { assistantIds: ['a-3'], assistantTurns: [3] });
assert.equal(result.removed, 1);
assert.deepEqual(Array.from(window.RPVectorMemory.list(), item => item.sourceAssistantIds[0]), ['a-1', 'a-2']);
await window.RPVectorMemory.indexLatest(messages.slice(0, 4).concat({ id: 'u-3', role: 'user', content: '第3轮行动' }, { id: 'a-3b', role: 'assistant', content: '第3轮新结果' }));
assert.deepEqual(Array.from(window.RPVectorMemory.list(), item => item.sourceAssistantIds[0]), ['a-1', 'a-2', 'a-3b']);
console.log('Branch memory reconciliation passed.');
