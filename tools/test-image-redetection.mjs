import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../ui/runtime/host-bridge.js', import.meta.url), 'utf8');
const records = new Map();
const calls = [];
let now = 100;
let fetchMode = 'resolve';

function settings(imageGenKey) {
  return {
    apiUrl: 'https://example.invalid/v1',
    apiKey: 'private-chat-key',
    model: 'test-model',
    imageGenKey,
    imageSize: '竖图',
    imageGenCount: 1
  };
}

records.set('rp_hub_settings', JSON.stringify(settings('private-image-key')));
const localStorage = {
  getItem(key) { return records.get(key) ?? null; },
  setItem(key, value) { records.set(key, String(value)); },
  removeItem(key) { records.delete(key); }
};
const sandbox = {
  console,
  Date,
  JSON,
  Map,
  Promise,
  URLSearchParams,
  AbortController,
  setTimeout,
  clearTimeout,
  indexedDB: undefined,
  localStorage,
  performance: { now() { now += 37; return now; } },
  fetch: async (url, options) => {
    calls.push({ url, options });
    if (fetchMode === 'reject') throw new Error('probe offline');
    return {};
  }
};
sandbox.window = sandbox;
sandbox.window.parent = sandbox.window;
sandbox.window.RPEvents = { async emit() { return { errors: [] }; } };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'ui/runtime/host-bridge.js' });

let result = await sandbox.window.RPHost.redetectImageGeneration();
assert.equal(calls.length, 1);
assert.equal(calls[0].url, 'https://nai.sta1n.cn');
assert.equal(calls[0].options.method, 'HEAD');
assert.equal(calls[0].options.mode, 'no-cors');
assert.equal(result.phase, 'ready');
assert.equal(result.connected, true);
assert.equal(result.configured, true);
assert.equal(result.usable, true);
assert.ok(result.latency > 0);

records.set('rp_hub_settings', JSON.stringify(settings('')));
result = await sandbox.window.RPHost.redetectImageGeneration();
assert.equal(result.phase, 'unconfigured');
assert.equal(result.connected, true);
assert.equal(result.configured, false);
assert.equal(result.usable, false);
assert.equal(sandbox.window.RPHost.imageSettings().configured, false, 'redetection must reread RP-Hub settings');

records.set('rp_hub_settings', JSON.stringify(settings('private-image-key')));
fetchMode = 'reject';
result = await sandbox.window.RPHost.redetectImageGeneration();
assert.equal(result.phase, 'error');
assert.equal(result.connected, false);
assert.equal(result.configured, true);
assert.equal(result.usable, false);
assert.match(result.message, /probe offline/);

const publicSnapshot = JSON.stringify({
  settings: sandbox.window.RPHost.settings(),
  imageSettings: sandbox.window.RPHost.imageSettings(),
  imageStatus: sandbox.window.RPHost.imageServiceStatus()
});
assert.equal(publicSnapshot.includes('private-chat-key'), false);
assert.equal(publicSnapshot.includes('private-image-key'), false);

console.log('image redetection tests passed');
