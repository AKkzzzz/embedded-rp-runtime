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

for (const needle of [
  '卡内后台小酒馆',
  'window.RPHost',
  'window.RPWorldbook',
  'window.RPStateGuard',
  'window.RPMemory',
  'window.RPPlugins',
  'window.RPPrompt',
  'window.RPDiagnostics'
]) {
  if (!inner.includes(needle)) throw new Error(`inner runtime missing ${needle}`);
}

for (const forbidden of [
  'rp_hub_settings',
  'silly_tavern_settings',
  'apiKey',
  'Authorization:',
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
  'ui/runtime/storage-engine.js',
  'ui/runtime/preset-store.js',
  'ui/runtime/state-guard.js',
  'ui/runtime/host-bridge.js',
  'ui/runtime/model-gateway.js',
  'ui/runtime/worldbook-patch-store.js',
  'ui/runtime/worldbook-engine.js',
  'ui/runtime/memory-engine.js',
  'ui/runtime/plugin-runtime.js',
  'ui/runtime/prompt-compiler.js',
  'ui/runtime/diagnostics.js',
  'ui/scripts/debug-console.js',
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

const presetIds = new Set();
for (const preset of templateData.presets) {
  if (!preset.id || presetIds.has(preset.id)) throw new Error(`invalid or duplicate preset id: ${preset.id}`);
  presetIds.add(preset.id);
  if (!['system', 'user', 'assistant'].includes(preset.role)) throw new Error(`invalid preset role: ${preset.id}`);
  if (!['system-root', 'system-support', 'prelude'].includes(preset.phase)) throw new Error(`invalid preset phase: ${preset.id}`);
  if (!Number.isFinite(preset.order)) throw new Error(`invalid preset order: ${preset.id}`);
  if (!String(preset.content || '').trim()) throw new Error(`empty preset content: ${preset.id}`);
}
for (const forbiddenPreset of ['色情内容增强', 'COT']) {
  if (templateData.presets.some(preset => preset.name === forbiddenPreset)) {
    throw new Error(`forbidden default preset was bundled: ${forbiddenPreset}`);
  }
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
