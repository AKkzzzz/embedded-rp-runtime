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
  'ui/data/rphub-presets.js',
  'ui/runtime/event-bus.js',
  'ui/runtime/storage-engine.js',
  'ui/runtime/preset-store.js',
  'ui/runtime/state-guard.js',
  'ui/runtime/ui-template-state.js',
  'ui/runtime/regex-engine.js',
  'ui/runtime/plugin-runtime.js',
  'ui/runtime/capability-plugins.js',
  'ui/runtime/worldbook-engine.js',
  'ui/runtime/worldbook-patch-store.js',
  'ui/runtime/memory-engine.js',
  'ui/runtime/tool-engine.js',
  'ui/runtime/community-plugins.js',
  'ui/runtime/prompt-compiler.js'
]) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, { filename: relative });
}

const stateValidation = sandbox.RPStateGuard.validate(
  sandbox.RPStorage.getCanonical(),
  sandbox.RPTemplateData.stateSchema
);
assert.equal(stateValidation.ok, true);
assert.equal(sandbox.RPStorage.debugEnabled(), false);
sandbox.RPStorage.savePreferences({ debugEnabled: true });
assert.equal(sandbox.RPStorage.debugEnabled(), true);
sandbox.RPStorage.savePreferences({ debugEnabled: false });
assert.equal(sandbox.RPStorage.debugEnabled(), false);
assert.deepEqual(sandbox.RPUIStateSync.list(), []);
assert.equal(sandbox.RPPresets.list().length, 17);
assert.equal(sandbox.RPWorldbook.update('runtime-contract', { content: '玩家本地覆盖后的运行时契约。' }).ok, true);
assert.equal(sandbox.RPWorldbook.byId('runtime-contract').content, '玩家本地覆盖后的运行时契约。');
assert.equal(sandbox.RPWorldbook.restoreBuiltin('runtime-contract'), true);
assert.match(sandbox.RPWorldbook.byId('runtime-contract').content, /canonical state/);
const timestampPreset = sandbox.RPPresets.list().find(preset => preset.name === '时间戳');
assert.ok(timestampPreset && timestampPreset.runtimeEnabled, 'RP-Hub 1.8.9 timestamp preset must be present');
const thirdPersonPreset = sandbox.RPPresets.list().find(preset => preset.name === '第三人称');
assert.equal(sandbox.RPPresets.setEnabled(thirdPersonPreset.id, true), true);
assert.equal(sandbox.RPPresets.byId(thirdPersonPreset.id).runtimeEnabled, true);
sandbox.RPPresets.reset();

const importedPresets = sandbox.RPPresets.importRpHub([
  {
    name: '用户的 RP-Hub 系统预设',
    content: '保持场景连续。',
    enabled: true,
    role: 'system'
  },
  {
    name: '用户的 RP-Hub AI 预注入',
    content: '准备继续故事。',
    enabled: false,
    role: 'assistant'
  }
]);
assert.equal(importedPresets.ok, true);
assert.equal(importedPresets.imported.length, 2);
assert.equal(sandbox.RPPresets.list().length, 19);
assert.equal(importedPresets.imported[0].phase, 'system-support');
assert.equal(importedPresets.imported[1].phase, 'prelude');
const exportedPresets = sandbox.RPPresets.exportRpHub(importedPresets.imported.map(preset => preset.id));
assert.equal(exportedPresets.length, 2);
assert.equal(JSON.stringify(Object.keys(exportedPresets[0])), JSON.stringify(['name', 'content', 'enabled', 'role']));
assert.equal(exportedPresets.find(preset => preset.role === 'assistant').enabled, false);
const editedPreset = sandbox.RPPresets.update(importedPresets.imported[0].id, {
  name: '已编辑系统预设',
  content: '保持场景连续，并服从状态契约。',
  role: 'system',
  phase: 'system-support',
  enabled: true,
  order: 640
});
assert.equal(editedPreset.ok, true);
assert.equal(sandbox.RPPresets.byId(importedPresets.imported[0].id).name, '已编辑系统预设');
sandbox.RPPresets.reset();

const personalizedState = sandbox.RPStorage.getCanonical();
personalizedState.player.name = '测试玩家';
personalizedState.rpg.inventory = [{ id: 'test-item', name: '测试物品', quantity: 1 }];
personalizedState.rpg.stats = { hp: '5/5' };
sandbox.RPStorage.saveCanonical(personalizedState);
const compiledPrompt = await sandbox.RPPrompt.compile('{{user}}检查世界书递归扫描');
assert(compiledPrompt.messages.some(message => message.content.includes('[Style Priority]')));
const narrativePolicyMessage = compiledPrompt.messages.find(message => message.source === 'runtime:narrative-policy');
assert(narrativePolicyMessage);
assert.match(narrativePolicyMessage.content, /不因其玩家身份默认正确、全知、值得崇拜或拥有指挥权/);
assert.match(narrativePolicyMessage.content, /行动结果、另一人物的决定或反应、环境或威胁的新变化/);
assert.match(narrativePolicyMessage.content, /不要连续两轮用/);
assert(compiledPrompt.messages.some(message => message.content.includes('测试玩家检查世界书递归扫描')));
assert(!compiledPrompt.messages.some(message => message.content.includes('{{user}}')));
assert.equal(JSON.stringify(compiledPrompt.messages.slice(0, 6).map(message => message.source)), JSON.stringify([
  'preset:rphub-official-01',
  'worldbook:system-top:runtime-contract',
  'presets:system-support',
  'runtime:narrative-policy',
  'preset:rphub-official-02',
  'preset:rphub-official-03'
]));
assert(compiledPrompt.messages.some(message => message.source === 'character:context' && message.content.includes('递归检索必须')));
const variableMessage = compiledPrompt.messages.find(message => message.source === 'state:variables');
assert(variableMessage);
const narrativeState = JSON.parse(variableMessage.content.replace(/^【当前变量状态】\n/, ''));
assert.deepEqual(narrativeState.rpg.inventory, personalizedState.rpg.inventory);
assert.deepEqual(narrativeState.rpg.stats, personalizedState.rpg.stats);
assert.equal(narrativeState.player.name, '测试玩家');
for (const privateKey of ['runtime', 'conversation', 'knowledge', 'uiTemplates']) {
  assert.equal(Object.prototype.hasOwnProperty.call(narrativeState, privateKey), false);
}
assert.equal(compiledPrompt.messages.some(message => message.source === 'state:canonical'), false);

const retrieval = sandbox.RPWorldbook.retrieve('请检查世界书递归扫描');
assert.deepEqual(retrieval.hits.map(hit => hit.id), ['runtime-image-generation-contract', 'runtime-contract', 'example-regex-trigger']);

const rpHubFixtures = [
  { id: 'history-hit', comment: '历史命中', content: '历史扫描已生效。', keys: ['旧港口'], scanDepth: 2, position: 'user_top', order: 10 },
  { id: 'probability-zero', comment: '概率零', content: '不应命中。', keys: ['概率测试'], probability: 0, position: 'at_depth' },
  { id: 'dependency-parent', comment: '依赖父项', content: '父项。', keys: ['依赖测试'], dependencies: ['dependency-child'], position: 'before_char' },
  { id: 'dependency-child', comment: '依赖子项', content: '子项。', keys: ['不会直接命中的词'], position: 'after_char' },
  { id: 'position-system', comment: '系统顶部', content: 'system top', keys: ['位置测试'], position: 'system_top', order: 1 },
  { id: 'position-global', comment: '全局注释', content: 'global note', keys: ['位置测试'], position: 'global_note', order: 2 },
  { id: 'position-before', comment: '角色之前', content: 'before char', keys: ['位置测试'], position: 'before_char', order: 3 },
  { id: 'position-after', comment: '角色之后', content: 'after char', keys: ['位置测试'], position: 'after_char', order: 4 },
  { id: 'position-depth', comment: '历史深度', content: 'at depth', keys: ['位置测试'], position: 'at_depth', depth: 1, order: 5 },
  { id: 'position-user', comment: '用户顶部', content: 'user top', keys: ['位置测试'], position: 'user_top', order: 6 },
  { id: 'position-assistant', comment: '助手顶部', content: 'assistant top', keys: ['位置测试'], position: 'assistant_top', order: 7 }
].map(entry => ({ ...entry, enabled: true, scope: 'character' }));
sandbox.RPTemplateData.worldbook.push(...rpHubFixtures);

const historyRetrieval = sandbox.RPWorldbook.retrieve('继续前进', {
  history: [
    { role: 'user', content: '我们刚才经过旧港口。' },
    { role: 'user', content: '那里正在下雨。' }
  ]
});
assert(historyRetrieval.hits.some(hit => hit.id === 'history-hit'));
const expiredHistory = sandbox.RPWorldbook.retrieve('继续前进', {
  history: [
    { role: 'user', content: '我们刚才经过旧港口。' },
    { role: 'assistant', content: '第一段回应。' },
    { role: 'user', content: '第二段提问。' },
    { role: 'assistant', content: '第三段回应。' }
  ]
});
assert(!expiredHistory.hits.some(hit => hit.id === 'history-hit'));
assert(!sandbox.RPWorldbook.retrieve('概率测试', { random: () => 0 }).hits.some(hit => hit.id === 'probability-zero'));
const compatibilityFixtures = [
  { id: 'constant-zero', comment: '零概率常驻', content: '仍应命中。', constant: true, probability: 0 },
  { id: 'invalid-regex', comment: '非法正则', content: '不得中断。', keys: ['/[invalid/'], useRegex: true }
].concat(Array.from({ length: 24 }, (_, index) => ({
  id: 'bulk-hit-' + index,
  comment: '批量命中 ' + index,
  content: '批量内容 ' + index,
  keys: ['批量命中'],
  order: 500
}))).map(entry => ({ ...entry, enabled: true, scope: 'character', position: 'at_depth' }));
sandbox.RPTemplateData.worldbook.push(...compatibilityFixtures);
const zeroDepth = sandbox.RPWorldbook.retrieve('批量命中', { scanDepth: 0 });
assert(zeroDepth.hits.some(hit => hit.id === 'constant-zero'));
assert.equal(zeroDepth.hits.filter(hit => hit.id.startsWith('bulk-hit-')).length, 0);
const allBulkHits = sandbox.RPWorldbook.retrieve('批量命中');
const bulkHits = allBulkHits.hits.filter(hit => hit.id.startsWith('bulk-hit-'));
assert.equal(bulkHits.length, 24, 'all matched entries survive beyond the former selective limit');
assert.deepEqual(Array.from(bulkHits, hit => hit.id), Array.from({ length: 24 }, (_, index) => 'bulk-hit-' + index),
  'equal-score and equal-order hits retain source order');
const largeEntries = Array.from({ length: 3 }, (_, index) => ({
  id: 'large-hit-' + index,
  comment: '大字符命中 ' + index,
  content: String(index).repeat(22000),
  keys: ['大字符命中'],
  enabled: true,
  scope: 'character',
  position: 'at_depth',
  order: 501
}));
sandbox.RPTemplateData.worldbook.push(...largeEntries);
assert.equal(sandbox.RPWorldbook.retrieve('大字符命中').hits.filter(hit => hit.id.startsWith('large-hit-')).length, 3,
  'all matched entries survive beyond the former character budget');
assert.doesNotThrow(() => sandbox.RPWorldbook.retrieve('非法正则'));
assert(!sandbox.RPWorldbook.retrieve('继续', {
  history: [{ role: 'user', content: '旧港口' }, { role: 'assistant', content: '已经离开。' }],
  maxDepth: 1
}).hits.some(hit => hit.id === 'history-hit'));
const extensionOverride = sandbox.RPWorldbook.normalizeEntry({
  comment: '根字段',
  content: '根内容',
  keys: ['根关键词'],
  extensions: { comment: '扩展字段', keys: ['扩展关键词'], position: 'user_top' }
}, 0);
assert.equal(extensionOverride.comment, '扩展字段');
assert.deepEqual(extensionOverride.keys, ['扩展关键词']);
assert.equal(extensionOverride.position, 'user_top');

sandbox.RPWorldbook.setEnabled('dependency-child', false);
const disabledDependency = sandbox.RPWorldbook.retrieve('依赖测试');
assert.deepEqual(disabledDependency.hits.filter(hit => hit.id.startsWith('dependency-')).map(hit => hit.id), ['dependency-parent']);
assert(disabledDependency.diagnostics.some(item => item.id === 'dependency-child' && item.reason === 'dependency-disabled'));
sandbox.RPWorldbook.setEnabled('dependency-child', true);
assert.deepEqual(
  sandbox.RPWorldbook.retrieve('依赖测试').hits.filter(hit => hit.id.startsWith('dependency-')).map(hit => hit.id),
  ['dependency-parent', 'dependency-child']
);
await sandbox.RPPlugins.setEnabled('runtime.worldbook.recursion', false);
assert.deepEqual(
  sandbox.RPWorldbook.retrieve('依赖测试').hits.filter(hit => hit.id.startsWith('dependency-')).map(hit => hit.id),
  ['dependency-parent']
);
await sandbox.RPPlugins.setEnabled('runtime.worldbook.recursion', true);

const placementPrompt = await sandbox.RPPrompt.compile('位置测试', {
  history: [{ role: 'assistant', content: '上一轮。' }],
  character: { name: '测试角色', personality: '谨慎' }
});
assert(placementPrompt.messages.some(message => message.source === 'worldbook:system-top:position-system'));
assert(placementPrompt.messages.some(message => message.source === 'worldbook:global-note:position-global'));
assert(placementPrompt.messages.some(message => message.source === 'character:context' && message.content.includes('before char') && message.content.includes('after char')));
assert(placementPrompt.messages.some(message => message.source === 'worldbook:at-depth:position-depth' && message.role === 'user'));
assert(placementPrompt.messages.find(message => message.source === 'input').content.startsWith('【用户顶部】'));
assert.equal(placementPrompt.messages.at(-1).source, 'worldbook:assistant-top');

await sandbox.RPPlugins.setEnabled('runtime.patch.guard', false);
assert.equal(sandbox.RPWorldbookPatches.validateProposal({}).errors[0], 'model patch guard plugin is disabled');
await sandbox.RPPlugins.setEnabled('runtime.patch.guard', true);

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
assert(!sandbox.RPWorldbook.retrieve('已确认剧情事实').hits.some(hit => hit.id === 'memory-derived-test'));
const manualLookup = sandbox.RPWorldbook.retrieve('已确认剧情事实', { manual: true });
assert(manualLookup.hits.some(hit => hit.id === 'memory-derived-test'), 'manual lookup can find an untriggered entry by content');

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

const importedWorldbook = sandbox.RPWorldbook.importRpHub({
  entries: [
    {
      comment: 'RP-Hub 往返测试',
      content: '官方字段必须保持。',
      enabled: true,
      scope: 'global',
      keys: ['往返测试'],
      useRegex: false,
      constant: false,
      position: 'at_depth',
      order: 42,
      depth: 3,
      scanDepth: 4,
      probability: 75,
      useProbability: true
    }
  ]
});
assert.equal(importedWorldbook.ok, true);
const exportedWorldbook = sandbox.RPWorldbook.exportRpHub([importedWorldbook.imported[0].id]);
assert.equal(exportedWorldbook.length, 1);
assert.deepEqual(Object.keys(exportedWorldbook[0]), [
  'comment', 'content', 'enabled', 'scope', 'keys', 'useRegex', 'constant',
  'position', 'order', 'depth', 'scanDepth', 'probability', 'useProbability'
]);
assert.equal(exportedWorldbook[0].scope, 'global');
assert.equal(exportedWorldbook[0].probability, 75);

sandbox.RPTools.setEnabled('tool_dice', true);
const diceTool = await sandbox.RPTools.run('<tool_dice:2d6+3>');
assert.equal(diceTool.calls.length, 1);
assert.equal(diceTool.calls[0].status, 'ok');
assert.match(diceTool.calls[0].content, /结果 = \d+/);
const seenDiceCalls = new Map();
const firstDiceCall = await sandbox.RPTools.run('<tool_dice:2d6+3>', {}, seenDiceCalls);
const duplicateDiceCall = await sandbox.RPTools.run('<tool_dice:2d6+3>', {}, seenDiceCalls);
assert.equal(firstDiceCall.calls[0].status, 'ok');
assert.equal(duplicateDiceCall.calls[0].status, 'duplicate');
assert.match(duplicateDiceCall.calls[0].content, /沿用第一次结果/);
assert.match(duplicateDiceCall.prompt, /不得再次调用或重新掷骰/);
const poolTool = await sandbox.RPTools.run('<tool_dice:pool 6d10>');
assert.equal(poolTool.calls.length, 1);
assert.equal(poolTool.calls[0].status, 'ok');
assert.equal(poolTool.calls[0].data.kind, 'success-pool');
assert.equal(poolTool.calls[0].data.dice, 6);
assert.match(poolTool.calls[0].content, /成功数 =/);
assert.equal(typeof sandbox.RPUIStateSync.trace, 'function');
assert.equal(typeof sandbox.RPMemory.reset, 'function');
sandbox.RPTools.setEnabled('tool_worldbook', true);
const completeWorldbookTool = await sandbox.RPTools.run('<tool_worldbook:批量内容>');
assert.match(completeWorldbookTool.calls[0].content, /返回 6 \/ 总计 24 条命中/, 'active worldbook lookup must disclose its six-result limit');
const worldbookTool = await sandbox.RPTools.run('<tool_worldbook:已确认剧情事实>');
assert.equal(worldbookTool.calls.length, 1);
assert.equal(worldbookTool.calls[0].status, 'ok');
assert.match(worldbookTool.calls[0].content, /返回 1 \/ 总计 1 条命中/);
assert.match(worldbookTool.calls[0].content, /测试长期事实/);
assert.equal(typeof sandbox.RPPromptInspector.snapshot, 'function');
assert.equal(typeof sandbox.RPGuided.suggest, 'function');
assert.equal(typeof sandbox.RPCharMemory.add, 'function');
assert.equal(typeof sandbox.RPNotebook.add, 'function');
assert.equal(typeof sandbox.RPPlugins.activateAll, 'function');
assert.equal(typeof sandbox.RPPersonas.activate, 'function');
assert.equal(typeof sandbox.RPDiagrams.render, 'function');
assert.equal(typeof sandbox.RPLoreCopilot.draft, 'function');
assert.equal(typeof sandbox.RPLoreRecommender.inspect, 'function');

const pluginStates = sandbox.RPPlugins.list();
assert(pluginStates.every(plugin => plugin.status === 'ready'));
assert(pluginStates.find(plugin => plugin.id === 'runtime.worldbook.recursion').calls > 0);
assert(pluginStates.find(plugin => plugin.id === 'runtime.patch.guard').calls > 0);

console.log(JSON.stringify({
  ok: true,
  initialStateValid: true,
  presets: 17,
  presetImportExport: true,
  officialDefaults: sandbox.RPPresets.list().slice(0, 15).every(preset => preset.builtin),
  promptOrder: compiledPrompt.messages.slice(0, 6).map(message => message.source),
  retrievalHits: retrieval.hits.map(hit => hit.id),
  rpHubWorldbookCompatibility: true,
  realPluginImplementations: true,
  committedRevision: committed.revision,
  lockedEditRejected: true
  ,communitySuite: true
}, null, 2));
