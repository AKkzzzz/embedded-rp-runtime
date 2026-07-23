(function () {
  'use strict';

  var authored = window.RPTemplateData.plugins;
  var records = new Map();
  var allowedCapabilities = new Set([
    'events:listen',
    'commands:register',
    'prompt:inspect',
    'prompt:modify',
    'worldbook:read',
    'worldbook:patch:propose',
    'retrieval:extend',
    'state:read',
    'state:patch:propose',
    'state:validate',
    'worldbook:patch:validate',
    'memory:read',
    'memory:write',
    'diagnostics:write',
    'storage:local'
  ]);

  function preference(id, fallback) {
    var enabled = window.RPStorage.getPreferences().pluginEnabled || {};
    return Object.prototype.hasOwnProperty.call(enabled, id) ? enabled[id] !== false : fallback;
  }

  function validateManifest(manifest) {
    var errors = [];
    if (!/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(manifest.id || '')) errors.push('invalid id');
    (manifest.capabilities || []).forEach(function (capability) {
      if (!allowedCapabilities.has(capability)) errors.push('unknown capability: ' + capability);
    });
    (manifest.requires || []).forEach(function (id) {
      if (!authored.some(function (plugin) { return plugin.id === id; })) errors.push('missing requirement: ' + id);
    });
    return errors;
  }

  function register(manifest, implementation) {
    if (records.has(manifest.id)) throw new Error('duplicate plugin: ' + manifest.id);
    var errors = validateManifest(manifest);
    records.set(manifest.id, {
      manifest: Object.assign({}, manifest),
      implementation: implementation || {},
      enabled: errors.length ? false : preference(manifest.id, manifest.enabled !== false),
      status: errors.length ? 'invalid' : 'ready',
      errors: errors.map(function (message) { return { message: message, at: new Date().toISOString() }; }),
      calls: 0,
      totalMs: 0
    });
  }

  function dependencyOrder() {
    return Array.from(records.values()).sort(function (a, b) {
      return Number(a.manifest.priority || 100) - Number(b.manifest.priority || 100) ||
        a.manifest.id.localeCompare(b.manifest.id);
    });
  }

  async function run(hook, context) {
    var current = context;
    var ordered = dependencyOrder();
    for (var i = 0; i < ordered.length; i += 1) {
      var record = ordered[i];
      var handler = record.implementation && record.implementation[hook];
      if (!record.enabled || typeof handler !== 'function') continue;
      var started = performance.now();
      try {
        var result = await handler(current, { id: record.manifest.id });
        if (result !== undefined) current = result;
        record.status = 'ready';
      } catch (error) {
        record.status = 'error';
        record.errors.push({ hook: hook, message: String(error.message || error), at: new Date().toISOString() });
        record.errors = record.errors.slice(-10);
      }
      record.calls += 1;
      record.totalMs += performance.now() - started;
    }
    return current;
  }

  async function setEnabled(id, enabled) {
    var record = records.get(id);
    if (!record || record.status === 'invalid') return false;
    if (!enabled) {
      window.RPEvents.disposeOwner(id);
      if (typeof record.implementation.dispose === 'function') await record.implementation.dispose();
    }
    record.enabled = enabled;
    var preferences = window.RPStorage.getPreferences();
    var next = Object.assign({}, preferences.pluginEnabled || {});
    next[id] = enabled;
    window.RPStorage.savePreferences({ pluginEnabled: next });
    window.RPEvents.emit('plugins:changed', { id: id, enabled: enabled });
    return true;
  }

  function list() {
    return dependencyOrder().map(function (record) {
      return {
        id: record.manifest.id,
        name: record.manifest.name,
        version: record.manifest.version,
        priority: record.manifest.priority,
        requires: (record.manifest.requires || []).slice(),
        optional: (record.manifest.optional || []).slice(),
        capabilities: (record.manifest.capabilities || []).slice(),
        enabled: record.enabled,
        status: record.status,
        calls: record.calls,
        averageMs: record.calls ? Math.round(record.totalMs / record.calls * 100) / 100 : 0,
        errors: record.errors.slice()
      };
    });
  }

  authored.forEach(function (manifest) {
    register(manifest, {});
  });

  window.RPPlugins = {
    register: register,
    run: run,
    list: list,
    setEnabled: setEnabled
  };
})();
