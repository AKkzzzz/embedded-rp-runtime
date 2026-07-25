import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const target = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'release', '内嵌RP运行时模板-v0.1-debug.json');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'single-stage.manifest.json'), 'utf8'));
const payload = JSON.parse(fs.readFileSync(target, 'utf8'));
const data = payload.data;
const scripts = data.extensions?.regex_scripts || [];

if (data.first_mes !== manifest.marker) throw new Error('first_mes is not the launcher marker');
if (scripts.length !== 1) throw new Error(`expected one regex owner, got ${scripts.length}`);
if ((data.uiTemplates || []).length) throw new Error('host UI templates must stay empty');
if ((data.extensions?.rp_hub_ui_templates || []).length) throw new Error('mirrored host UI templates must stay empty');
if ((data.character_book?.entries || []).length) throw new Error('host worldbook must stay empty');
new RegExp(scripts[0].regex, scripts[0].flags || '');

const launcher = scripts[0].replacement;
for (const needle of [
  'embedded-rp-runtime-host',
  'DecompressionStream',
  `aspect-ratio:${manifest.stage.desktop.aspectRatio}`,
  `aspect-ratio:${manifest.stage.mobile.aspectRatio}`
]) {
  if (!launcher.includes(needle)) throw new Error(`launcher missing ${needle}`);
}

const encoded = [...launcher.matchAll(/H4sIA[A-Za-z0-9+/=]+/g)]
  .map(match => match[0])
  .sort((a, b) => b.length - a.length)[0];
if (!encoded) throw new Error('compressed inner app missing');
const inner = zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');

const sourceContracts = [
  ['ui/runtime/prompt-compiler.js', ["source: 'state:variables'"], ["source: 'state:canonical'"]],
  ['ui/runtime/conversation-engine.js', ['generationEpoch', 'whenStateSettled', 'committed:', 'else if (window.RPUIStateSync)'], []],
  ['ui/runtime/tool-engine.js', ['function callKey', "status: 'duplicate'"], []],
  ['ui/runtime/vector-memory-engine.js', [
    "window.RPTemplateData.app.storagePrefix + ':vectors:v1'",
    'function indexableMessages',
    'function retainedTurnSet',
    'clearAll: clearAll'
  ], ["var dbName = 'nanami_embedded_rp_vectors_v1'"]],
  ['ui/runtime/ui-template-state.js', ['var lastTrace', 'trace: function', 'var latest = window.RPStorage.getCanonical()'], []],
  ['ui/runtime/capability-plugins.js', [
    'function makeDraggable',
    'data-cap-expand',
    'function stateTrace'
  ], ['window.RPTimeline', "attach('runtime.timeline'"]],
  ['ui/runtime/storage-engine.js', ['function preferenceDefaults', 'ownedPrefix'], []],
  ['ui/runtime/model-gateway.js', ['function embeddingModels', 'testEmbeddingModel'], []]
];
for (const [relative, required, forbidden] of sourceContracts) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  for (const needle of required) {
    if (!source.includes(needle)) throw new Error(`${relative} missing runtime contract: ${needle}`);
  }
  for (const needle of forbidden) {
    if (source.includes(needle)) throw new Error(`${relative} retains forbidden runtime contract: ${needle}`);
  }
}

for (const needle of [
  '卡内后台小酒馆',
  'window.RPHost',
  'window.RPWorldbook',
  'window.RPStateGuard',
  'window.RPMemory',
  'window.RPVectorMemory',
  'window.RPSummary',
  'window.RPPlugins',
  'window.RPPrompt',
  'window.RPConversation',
  'window.RPUIStateSync',
  'window.RPGenerationMonitor',
  'window.RPDiagnostics',
  'window.RPPresetManager'
]) {
  if (!inner.includes(needle)) throw new Error(`inner runtime missing ${needle}`);
}

for (const needle of [
  "source: 'state:variables'",
  'generationEpoch',
  'whenStateSettled',
  'function callKey',
  "status: 'duplicate'",
  "storagePrefix + ':vectors:v1'",
  'function indexableMessages',
  'function retainedTurnSet',
  'function makeDraggable',
  'testEmbeddingModel'
]) {
  if (!inner.includes(needle)) throw new Error(`packed runtime missing contract: ${needle}`);
}
for (const needle of ['runtime.timeline', 'window.RPTimeline', 'timeline:branch', 'timeline:read']) {
  if (inner.includes(needle)) throw new Error(`packed runtime retained removed timeline contract: ${needle}`);
}
if (inner.includes("source: 'state:canonical'")) {
  throw new Error('packed runtime still injects full canonical state');
}

for (const required of [
  'RPHubDB',
  'rp_hub_settings',
  'chat/completions',
  'embeddings',
  'text/event-stream',
  'sameOriginSettings'
]) {
  if (!inner.includes(required)) throw new Error(`RP-Hub compatibility path missing: ${required}`);
}

for (const forbidden of [
  'silly_tavern_settings',
  'window.parent.document',
  'top.eval',
  '<script src="http',
  '<script src="https'
]) {
  if (inner.includes(forbidden)) throw new Error(`forbidden credential or host access returned: ${forbidden}`);
}

const runtimeFiles = [
  'ui/data/template-data.js',
  'ui/data/rphub-presets.js',
  'ui/runtime/event-bus.js',
  'ui/runtime/ui-dialog.js',
  'ui/runtime/storage-engine.js',
  'ui/runtime/preset-store.js',
  'ui/runtime/state-guard.js',
  'ui/runtime/host-bridge.js',
  'ui/runtime/generation-monitor.js',
  'ui/runtime/model-gateway.js',
  'ui/runtime/plugin-runtime.js',
  'ui/runtime/vector-memory-engine.js',
  'ui/runtime/worldbook-engine.js',
  'ui/runtime/worldbook-patch-store.js',
  'ui/runtime/memory-engine.js',
  'ui/runtime/summary-engine.js',
  'ui/runtime/prompt-compiler.js',
  'ui/runtime/ui-template-state.js',
  'ui/runtime/conversation-engine.js',
  'ui/runtime/diagnostics.js',
  'ui/scripts/preset-manager.js',
  'ui/scripts/debug-console.js',
  'ui/scripts/conversation-console.js',
  'ui/scripts/bootstrap.js'
];
for (const relative of runtimeFiles) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  new vm.Script(source, { filename: relative });
}

const dataSource = fs.readFileSync(path.join(root, 'ui/data/template-data.js'), 'utf8');
const presetSource = fs.readFileSync(path.join(root, 'ui/data/rphub-presets.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(dataSource, sandbox);
vm.runInContext(presetSource, sandbox);
const templateData = sandbox.window.RPTemplateData;
const ids = new Set();
for (const entry of templateData.worldbook) {
  if (!entry.id || ids.has(entry.id)) throw new Error(`invalid or duplicate worldbook id: ${entry.id}`);
  ids.add(entry.id);
}
for (const entry of templateData.worldbook) {
  for (const dependency of entry.dependencies || []) {
    if (!ids.has(dependency)) throw new Error(`missing dependency ${entry.id} -> ${dependency}`);
  }
}

const pluginIds = new Set();
for (const plugin of templateData.plugins) {
  if (!plugin.id || pluginIds.has(plugin.id)) throw new Error(`invalid or duplicate plugin id: ${plugin.id}`);
  pluginIds.add(plugin.id);
  if (!Number.isFinite(plugin.priority)) throw new Error(`invalid plugin priority: ${plugin.id}`);
}

const worldbookSettings = templateData.worldbookSettings || {};
for (const key of ['scanDepth', 'maxScanDepth', 'charBudget', 'maxDependencyDepth']) {
  if (!Number.isFinite(worldbookSettings[key]) || worldbookSettings[key] < 0) {
    throw new Error(`invalid worldbook setting: ${key}`);
  }
}

const presetIds = new Set();
for (const preset of templateData.presets) {
  if (!preset.id || presetIds.has(preset.id)) throw new Error(`invalid or duplicate preset id: ${preset.id}`);
  presetIds.add(preset.id);
  if (!['system', 'user', 'assistant'].includes(preset.role)) throw new Error(`invalid preset role: ${preset.id}`);
  if (!['system-root', 'system-support', 'prelude'].includes(preset.phase)) throw new Error(`invalid preset phase: ${preset.id}`);
  if (!Number.isFinite(preset.order)) throw new Error(`invalid preset order: ${preset.id}`);
  if (!String(preset.content || '').trim()) throw new Error(`empty preset content: ${preset.id}`);
}
const officialPresets = JSON.parse(fs.readFileSync(path.join(root, 'sources', 'rphub-official-presets.json'), 'utf8'));
const interoperableFields = preset => ({
  name: preset.name,
  role: preset.role,
  content: preset.content,
  enabled: preset.enabled
});
const bundledPresets = templateData.presets.map(interoperableFields);
const officialDefaults = officialPresets.map(interoperableFields);
if (JSON.stringify(bundledPresets) !== JSON.stringify(officialDefaults)) {
  throw new Error('bundled defaults differ from the official RP-Hub preset snapshot');
}

console.log(JSON.stringify({
  ok: true,
  target: path.relative(root, target),
  worldbookEntries: templateData.worldbook.length,
  plugins: templateData.plugins.length,
  presets: templateData.presets.length,
  modelRoutes: Object.keys(templateData.modelRoutes),
  compressedBytes: Buffer.from(encoded, 'base64').length
}, null, 2));
