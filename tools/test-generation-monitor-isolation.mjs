import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../ui/runtime/model-gateway.js', import.meta.url), 'utf8');
const calls = [];
const response = model => new Response(JSON.stringify({ choices: [{ message: { content: model, reasoning_content: model + '-thinking' } }] }), { status: 200 });
const window = {
  RPTemplateData: { modelRoutes: {
    narrative: { inherit: 'current', model: 'narrative' },
    summary: { inherit: 'current', model: 'summary' },
    state: { inherit: 'current', model: 'state' }
  } },
  RPStorage: { getPreferences: () => ({ modelRoutes: {} }), savePreferences() {} },
  RPEvents: { emit() {} },
  RPPlugins: { run: async (_hook, value) => value },
  RPHost: {
    capabilities: () => ({ generation: true }), settings: () => ({ stream: false, temperature: 0.5 }),
    generationParameters: () => ({}), resolveModel: (_inherit, model) => model,
    apiFetch: async (_path, options) => response(JSON.parse(options.body).model)
  },
  RPGenerationMonitor: {
    start(meta) { calls.push(['start', meta.route]); }, content() {}, reasoning() {},
    finish(result) { calls.push(['finish', result.route]); }, fail() { calls.push(['fail']); }
  }
};
window.window = window;
const context = { window, Response, performance: { now: () => 0 }, console, Map, Set, Promise, JSON, Object, Array, String, Number, Boolean, Math, Date, Error };
vm.createContext(context);
vm.runInContext(source, context);

await window.RPModels.generate('narrative', [{ role: 'user', content: '继续' }], { stream: false });
const narrativeSnapshot = JSON.stringify(calls);
await window.RPModels.generate('summary', [{ role: 'user', content: '总结' }], { stream: false });
await window.RPModels.generate('state', [{ role: 'user', content: '状态' }], { stream: false });
assert.deepEqual(calls, [['start', 'narrative'], ['finish', 'narrative']]);
assert.equal(JSON.stringify(calls), narrativeSnapshot);
console.log('Generation monitor route isolation passed.');
