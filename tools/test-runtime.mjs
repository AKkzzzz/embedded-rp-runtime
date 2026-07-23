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
  getItem(key) {
    return values.has(key) ? values.get(key) : null;
  },
  setItem(key, value) {
    values.set(key, String(value));
  },
  removeItem(key) {
    values.delete(key);
  }
};

class CustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

const sandbox = {
  window: null,
  localStorage,
  performance,
  CustomEvent,
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
  console,
  dispatchEvent() {}
};
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const relative of [
  'ui/data/template-data.js',
  'ui/runtime/event-bus.js',
  'ui/runtime/storage-engine.js',
  'ui/runtime/state-guard.js',
  'ui/runtime/worldbook-patch-store.js',
  'ui/runtime/worldbook-engine.js'
]) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, { filename: relative });
}

const stateValidation = sandbox.RPStateGuard.validate(
  sandbox.RPStorage.getCanonical(),
  sandbox.RPTemplateData.stateSchema
);
assert.equal(stateValidation.ok, true);

const retrieval = sandbox.RPWorldbook.retrieve('请检查世界书递归扫描');
assert.deepEqual(retrieval.hits.map(hit => hit.id), ['runtime-contract', 'example-regex-trigger']);

const staleProposal = sandbox.RPWorldbookPatches.validateProposal({
  baseRevision: 0,
  reason: 'test',
  evidenceMessageIds: ['turn-1'],
  operations: []
});
assert.equal(staleProposal.ok, false);
assert(staleProposal.errors.includes('baseRevision conflict'));

const proposal = sandbox.RPWorldbookPatches.propose({
  id: 'proposal-1',
  baseRevision: 1,
  reason: '本轮确认了一条长期事实',
  evidenceMessageIds: ['turn-1'],
  operations: [
    {
      op: 'add',
      entry: {
        id: 'memory-derived-test',
        name: '测试长期事实',
        content: '这是一条由已确认剧情事实生成的运行时世界书。',
        enabled: true,
        locked: false,
        source: 'memory-derived',
        trigger: {
          type: 'literal',
          keys: ['测试长期事实']
        },
        dependencies: [],
        placement: 'before_character',
        order: 100
      }
    }
  ]
});
assert.equal(proposal.ok, true);

const committed = sandbox.RPWorldbookPatches.commit('proposal-1');
assert.equal(committed.ok, true);
assert.equal(committed.revision, 2);
assert.equal(sandbox.RPWorldbook.byId('memory-derived-test').name, '测试长期事实');

const lockedEdit = sandbox.RPWorldbookPatches.validateProposal({
  baseRevision: 2,
  reason: '尝试改写锁定规则',
  evidenceMessageIds: ['turn-2'],
  operations: [
    {
      op: 'disable',
      id: 'runtime-contract'
    }
  ]
});
assert.equal(lockedEdit.ok, false);
assert(lockedEdit.errors.some(error => error.includes('author-locked')));

console.log(JSON.stringify({
  ok: true,
  initialStateValid: true,
  retrievalHits: retrieval.hits.map(hit => hit.id),
  committedRevision: committed.revision,
  lockedEditRejected: true
}, null, 2));
