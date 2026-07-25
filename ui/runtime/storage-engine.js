(function () {
  'use strict';

  var data = window.RPTemplateData;
  var prefix = data.app.storagePrefix;
  var stateKey = prefix + ':canonical';
  var preferencesKey = prefix + ':preferences';
  var resetEpoch = 0;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function readJson(key, fallback) {
    try {
      var value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? clone(fallback) : value;
    } catch (_error) {
      return clone(fallback);
    }
  }

  function mergeDefaults(defaults, saved) {
    if (Array.isArray(defaults)) return Array.isArray(saved) ? clone(saved) : clone(defaults);
    if (!defaults || typeof defaults !== 'object') return saved === undefined ? defaults : saved;
    var output = {};
    Object.keys(defaults).forEach(function (key) {
      output[key] = mergeDefaults(defaults[key], saved && Object.prototype.hasOwnProperty.call(saved, key) ? saved[key] : undefined);
    });
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      Object.keys(saved).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(output, key)) output[key] = clone(saved[key]);
      });
    }
    return output;
  }

  function preferenceDefaults() {
    return {
      activeDebugPage: 'overview',
      worldbookDisabled: [],
      pluginEnabled: {},
      presetEnabled: {},
      presetOrder: [],
      presetCustom: [],
      presetEdits: {},
      modelRoutes: {},
      toolEnabled: {},
      reducedMotion: false,
      memoryModules: {
        memoryMode: 'classic',
        vectorEnabled: false,
        summaryEnabled: false,
        inheritRpHub: true,
        autoIndex: true,
        patrolEnabled: true,
        patrolIntervalMs: 60000,
        retryEnabled: true,
        maxRetryAttempts: 6,
        summaryKeepFloors: 40,
        vectorKeepFloors: 40,
        maxHistoryFloors: 40,
        topK: 10,
        similarityThreshold: 0.5,
        summaryConcurrency: 5,
        summaryPolicyVersion: 1,
        maxVectors: 2000
      }
    };
  }

  var canonical = mergeDefaults(data.initialState, readJson(stateKey, data.initialState));
  var preferences = mergeDefaults(preferenceDefaults(), readJson(preferencesKey, preferenceDefaults()));
  if (!preferences.memoryModules || !Object.prototype.hasOwnProperty.call(preferences.memoryModules, 'historyPolicyVersion')) {
    preferences.memoryModules = Object.assign({}, preferences.memoryModules || {}, {
      maxHistoryFloors: 40,
      summaryKeepFloors: Number(preferences.memoryModules && preferences.memoryModules.summaryKeepFloors) || Number(preferences.memoryModules && preferences.memoryModules.maxHistoryFloors) || 40,
      vectorKeepFloors: Number(preferences.memoryModules && preferences.memoryModules.vectorKeepFloors) || Number(preferences.memoryModules && preferences.memoryModules.maxHistoryFloors) || 40,
      historyPolicyVersion: 2
    });
    try { localStorage.setItem(preferencesKey, JSON.stringify(preferences)); } catch (_error) {}
  }
  preferences.memoryModules = preferences.memoryModules || {};
  if (!preferences.memoryModules.memoryMode) preferences.memoryModules.memoryMode = preferences.memoryModules.vectorEnabled ? 'vector' : 'classic';
  preferences.memoryModules.memoryMode = preferences.memoryModules.memoryMode === 'vector' ? 'vector' : 'classic';
  preferences.memoryModules.vectorEnabled = preferences.memoryModules.memoryMode === 'vector';
  preferences.memoryModules.summaryEnabled = preferences.memoryModules.memoryMode === 'classic';
  preferences.memoryModules.summaryKeepFloors = Math.max(0, Number(preferences.memoryModules.summaryKeepFloors || preferences.memoryModules.maxHistoryFloors || 40));
  preferences.memoryModules.vectorKeepFloors = Math.max(0, Number(preferences.memoryModules.vectorKeepFloors || preferences.memoryModules.maxHistoryFloors || 40));
  if (!preferences.memoryModules || preferences.memoryModules.summaryPolicyVersion !== 1) {
    preferences.memoryModules = Object.assign({}, preferences.memoryModules || {}, {
      summaryConcurrency: 5,
      summaryPolicyVersion: 1
    });
    delete preferences.memoryModules.summaryEveryFloors;
    try { localStorage.setItem(preferencesKey, JSON.stringify(preferences)); } catch (_error) {}
  }

  function saveCanonical(next) {
    canonical = clone(next);
    localStorage.setItem(stateKey, JSON.stringify(canonical));
    window.RPEvents.emit('storage:canonical:changed', clone(canonical));
    return clone(canonical);
  }

  function savePreferences(next) {
    preferences = Object.assign({}, preferences, clone(next || {}));
    if (next && next.memoryModules) {
      preferences.memoryModules = Object.assign({}, preferences.memoryModules || {}, clone(next.memoryModules));
      var requestedMode = Object.prototype.hasOwnProperty.call(next.memoryModules, 'memoryMode')
        ? next.memoryModules.memoryMode
        : (next.memoryModules.vectorEnabled ? 'vector' : (next.memoryModules.summaryEnabled ? 'classic' : preferences.memoryModules.memoryMode));
      preferences.memoryModules.memoryMode = requestedMode === 'vector' ? 'vector' : 'classic';
      preferences.memoryModules.vectorEnabled = preferences.memoryModules.memoryMode === 'vector';
      preferences.memoryModules.summaryEnabled = preferences.memoryModules.memoryMode === 'classic';
      if (Object.prototype.hasOwnProperty.call(next.memoryModules, 'maxHistoryFloors')) {
        if (!Object.prototype.hasOwnProperty.call(next.memoryModules, 'summaryKeepFloors')) preferences.memoryModules.summaryKeepFloors = Number(next.memoryModules.maxHistoryFloors) || 0;
        if (!Object.prototype.hasOwnProperty.call(next.memoryModules, 'vectorKeepFloors')) preferences.memoryModules.vectorKeepFloors = Number(next.memoryModules.maxHistoryFloors) || 0;
      }
    }
    localStorage.setItem(preferencesKey, JSON.stringify(preferences));
    window.RPEvents.emit('storage:preferences:changed', clone(preferences));
    return clone(preferences);
  }

  function exportBundle() {
    var exportedCanonical = clone(canonical);
    if (window.RPConversation && window.RPConversation.committed) {
      exportedCanonical.conversation.messages = window.RPConversation.committed();
      exportedCanonical.conversation.totalMessages = exportedCanonical.conversation.messages.length;
      exportedCanonical.conversation.archivedMessages = 0;
    }
    return {
      format: 'embedded-rp-runtime-save',
      version: 1,
      app: clone(data.app),
      canonical: exportedCanonical,
      preferences: clone(preferences),
      authoredRevision: 1,
      exportedAt: new Date().toISOString()
    };
  }

  window.RPStorage = {
    getCanonical: function () { return clone(canonical); },
    saveCanonical: saveCanonical,
    getPreferences: function () { return clone(preferences); },
    savePreferences: savePreferences,
    exportBundle: exportBundle,
    epoch: function () { return resetEpoch; },
    reset: function () {
      resetEpoch += 1;
      var ownedPrefix = prefix + ':';
      var ownedKeys = [];
      if (typeof localStorage.key === 'function' && Number.isFinite(Number(localStorage.length))) {
        for (var index = 0; index < localStorage.length; index += 1) {
          var key = localStorage.key(index);
          if (key && key.indexOf(ownedPrefix) === 0) ownedKeys.push(key);
        }
      }
      if (!ownedKeys.length) {
        // Keep the removed timeline key here so old template installs are fully reset.
        ownedKeys = [stateKey, preferencesKey, prefix + ':timeline', prefix + ':vector-retry-queue', prefix + ':structured-memory'];
      }
      ownedKeys.forEach(function (key) { localStorage.removeItem(key); });
      if (window.RPConversation && window.RPConversation.clear) window.RPConversation.clear().catch(function () {});
      canonical = clone(data.initialState);
      preferences = preferenceDefaults();
      localStorage.setItem(stateKey, JSON.stringify(canonical));
      localStorage.setItem(preferencesKey, JSON.stringify(preferences));
      if (window.RPMemory && window.RPMemory.reset) window.RPMemory.reset();
      if (window.RPVectorMemory && window.RPVectorMemory.clearAll) {
        window.RPVectorMemory.clearAll().catch(function (error) {
          window.RPEvents.emit('memory:vector:error', { message: String(error.message || error), source: 'storage-reset' });
        });
      }
      window.RPEvents.emit('storage:canonical:changed', clone(canonical));
      window.RPEvents.emit('storage:preferences:changed', clone(preferences));
      return { cleared: ownedKeys.length, prefix: prefix, vectorClearScheduled: Boolean(window.RPVectorMemory && window.RPVectorMemory.clearAll) };
    }
  };
})();
