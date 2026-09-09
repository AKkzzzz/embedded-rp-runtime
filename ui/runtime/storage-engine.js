(function () {
  'use strict';

  var data = window.RPTemplateData;
  var prefix = data.app.storagePrefix;
  var stateKey = prefix + ':canonical';
  var preferencesKey = prefix + ':preferences';
  var resetEpoch = 0;

  // Retired timeline snapshots duplicated the full conversation every turn.
  try { localStorage.removeItem(prefix + ':timeline'); } catch (_error) {}

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
      // Debug is a presentation preference. It can be changed from the game
      // surface without changing story state or model requests.
      debugEnabled: false,
      worldbookDisabled: [],
      worldbookEdits: {},
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
        summaryEnabled: true,
        inheritRpHub: true,
        autoIndex: true,
        patrolEnabled: false,
        patrolIntervalMs: 60000,
        retryEnabled: true,
        maxRetryAttempts: 6,
        summaryKeepFloors: 20,
        vectorKeepFloors: 50,
        maxHistoryFloors: 40,
        topK: 10,
        similarityThreshold: 0.4,
        vectorRecallMaxChars: 8000,
        summaryConcurrency: 5,
        summaryPolicyVersion: 1,
        maxVectors: 0,
        historyPolicyVersion: 5,
        patrolPolicyVersion: 3
      }
    };
  }

  var canonical = mergeDefaults(data.initialState, readJson(stateKey, data.initialState));
  var preferences = mergeDefaults(preferenceDefaults(), readJson(preferencesKey, preferenceDefaults()));
  if (!preferences.memoryModules || preferences.memoryModules.patrolPolicyVersion !== 3) {
    preferences.memoryModules = Object.assign({}, preferences.memoryModules || {}, {
      patrolIntervalMs: 60000,
      patrolPolicyVersion: 3
    });
    try { localStorage.setItem(preferencesKey, JSON.stringify(preferences)); } catch (_error) {}
  }
  if (!preferences.memoryModules || preferences.memoryModules.historyPolicyVersion !== 5) {
    var previousPolicy = Number(preferences.memoryModules && preferences.memoryModules.historyPolicyVersion || 0);
    var previousSummaryKeep = Number(preferences.memoryModules && preferences.memoryModules.summaryKeepFloors);
    var previousVectorKeep = Number(preferences.memoryModules && preferences.memoryModules.vectorKeepFloors);
    preferences.memoryModules = Object.assign({}, preferences.memoryModules || {}, {
      maxHistoryFloors: 40,
      summaryKeepFloors: previousPolicy < 5 && previousSummaryKeep === 40 ? 20 : (previousSummaryKeep || 20),
      vectorKeepFloors: previousPolicy < 5 && previousVectorKeep === 40 ? 50 : (previousVectorKeep || 50),
      historyPolicyVersion: 5
    });
    try { localStorage.setItem(preferencesKey, JSON.stringify(preferences)); } catch (_error) {}
  }
  preferences.memoryModules = preferences.memoryModules || {};
  if (!preferences.memoryModules.memoryMode) preferences.memoryModules.memoryMode = preferences.memoryModules.vectorEnabled ? 'vector' : 'classic';
  preferences.memoryModules.memoryMode = preferences.memoryModules.memoryMode === 'vector' ? 'vector' : 'classic';
  preferences.memoryModules.vectorEnabled = preferences.memoryModules.memoryMode === 'vector';
  preferences.memoryModules.summaryEnabled = preferences.memoryModules.memoryMode === 'classic';
  preferences.memoryModules.summaryKeepFloors = Math.max(0, Number(preferences.memoryModules.summaryKeepFloors || 20));
  preferences.memoryModules.vectorKeepFloors = Math.max(0, Number(preferences.memoryModules.vectorKeepFloors || 50));
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

  function debugEnabled() {
    return preferences.debugEnabled === true;
  }

  function syncMemoryFromHost(hostMemory) {
    var current = preferences.memoryModules || {};
    if (current.inheritRpHub === false || !hostMemory || typeof hostMemory !== 'object') return clone(current);
    var mode = hostMemory.mode === 'vector' ? 'vector' : 'classic';
    var threshold = Number(hostMemory.similarityThreshold);
    if (threshold > 1) threshold /= 100;
    var next = Object.assign({}, current, {
      memoryMode: mode,
      vectorEnabled: mode === 'vector',
      summaryEnabled: mode === 'classic',
      inheritRpHub: true,
      topK: Math.max(1, Math.min(50, Number(hostMemory.vectorTopK) || 10)),
      similarityThreshold: Math.max(0.35, Math.min(1, Number.isFinite(threshold) ? threshold : 0.4)),
      summaryKeepFloors: Math.max(0, Math.min(200, Number(hostMemory.summaryKeepFloors) || 20)),
      vectorKeepFloors: Math.max(0, Math.min(200, Number(hostMemory.vectorKeepFloors) || 50)),
      summaryConcurrency: Math.max(1, Math.min(10, Number(hostMemory.classicConcurrency) || 5))
    });
    return savePreferences({ memoryModules: next }).memoryModules;
  }

  function localDataKeys() {
    return {
      notebook: prefix + ':community:notebook',
      personas: prefix + ':community:personas',
      parameterRandomizer: prefix + ':community:parameter-randomizer',
      imageCache: prefix + ':image-cache',
      actionCheckpoint: prefix + ':last-action-checkpoint'
    };
  }

  function exportLocalData() {
    var output = {};
    var keys = localDataKeys();
    Object.keys(keys).forEach(function (name) {
      try {
        var raw = localStorage.getItem(keys[name]);
        if (raw != null) output[name] = JSON.parse(raw);
      } catch (_error) {}
    });
    return output;
  }

  function importLocalData(payload) {
    var source = payload && typeof payload === 'object' ? payload : {};
    var keys = localDataKeys();
    Object.keys(keys).forEach(function (name) {
      try {
        if (Object.prototype.hasOwnProperty.call(source, name)) localStorage.setItem(keys[name], JSON.stringify(source[name]));
        else localStorage.removeItem(keys[name]);
      } catch (_error) {}
    });
  }

  function actionCheckpoint() {
    try {
      return readJson(localDataKeys().actionCheckpoint, null);
    } catch (_error) {
      return null;
    }
  }

  function saveActionCheckpoint(checkpoint) {
    var key = localDataKeys().actionCheckpoint;
    if (!checkpoint) {
      localStorage.removeItem(key);
      return null;
    }
    localStorage.setItem(key, JSON.stringify(checkpoint));
    return clone(checkpoint);
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

  async function exportFullBundle() {
    var conversation = window.RPConversation && window.RPConversation.exportData
      ? await window.RPConversation.exportData()
      : { revision: canonical.conversation.revision, messages: clone(canonical.conversation.messages || []), savedAt: new Date().toISOString() };
    var structuredMemory = window.RPMemory && window.RPMemory.exportData
      ? await window.RPMemory.exportData()
      : { version: 1, entries: [] };
    var vectors = window.RPVectorMemory && window.RPVectorMemory.exportData
      ? await window.RPVectorMemory.exportData()
      : { version: 1, encoding: 'int8:maxabs:v1', items: [], fingerprints: [], retryQueue: [] };
    var exportedCanonical = clone(canonical);
    exportedCanonical.conversation = Object.assign({}, exportedCanonical.conversation, {
      revision: conversation.revision,
      messages: clone(conversation.messages),
      totalMessages: conversation.messages.length,
      archivedMessages: 0,
      status: 'idle'
    });
    var memoryRows = structuredMemory.entries || [];
    return {
      format: 'embedded-rp-runtime-save',
      version: 2,
      app: {
        id: data.app.id,
        name: data.app.name,
        version: data.app.version,
        storagePrefix: data.app.storagePrefix
      },
      exportedAt: new Date().toISOString(),
      authoredRevision: 1,
      canonical: exportedCanonical,
      preferences: clone(preferences),
      context: {
        conversation: conversation,
        structuredMemory: structuredMemory,
        summaries: {
          storage: 'structuredMemory.entries',
          count: memoryRows.filter(function (item) {
            return item && (item.classicMemory === true || item.kind === 'classicMemory');
          }).length
        },
        vectors: vectors
      },
      localData: exportLocalData(),
      integrity: {
        messageCount: conversation.messages.length,
        structuredMemoryCount: memoryRows.length,
        vectorCount: (vectors.items || []).length
      }
    };
  }

  function inspectBundle(bundle) {
    var errors = [];
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) errors.push('存档根结构无效');
    if (!errors.length && bundle.format !== 'embedded-rp-runtime-save') errors.push('不是本运行时的存档格式');
    var version = Number(bundle && bundle.version || 0);
    if ([1, 2].indexOf(version) === -1) errors.push('不支持的存档版本：' + version);
    if (!bundle || !bundle.canonical || typeof bundle.canonical !== 'object' || Array.isArray(bundle.canonical)) {
      errors.push('缺少人物与剧情状态');
    }
    var appId = bundle && bundle.app && bundle.app.id;
    var storagePrefix = bundle && bundle.app && bundle.app.storagePrefix;
    if (appId && appId !== data.app.id) errors.push('存档属于其他卡：' + appId);
    if (!appId && storagePrefix && storagePrefix !== data.app.storagePrefix) errors.push('存档属于其他卡：' + storagePrefix);
    var context = version >= 2 && bundle.context && typeof bundle.context === 'object' ? bundle.context : {};
    var conversation = context.conversation || bundle && bundle.canonical && bundle.canonical.conversation || {};
    var messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    var structured = context.structuredMemory && Array.isArray(context.structuredMemory.entries)
      ? context.structuredMemory.entries : [];
    var vectors = context.vectors && Array.isArray(context.vectors.items) ? context.vectors.items : [];
    if (messages.length > 20000) errors.push('对话楼层超过可导入上限');
    if (structured.length > 10000) errors.push('结构化记忆超过可导入上限');
    if (vectors.length > 5000) errors.push('向量条目超过可导入上限');
    if (!errors.length && window.RPStateGuard && window.RPTemplateData.stateSchema) {
      var validation = window.RPStateGuard.validate(bundle.canonical, window.RPTemplateData.stateSchema);
      if (!validation.ok) errors.push('人物与剧情变量未通过校验：' + validation.errors.slice(0, 3).join('；'));
    }
    return {
      ok: errors.length === 0,
      errors: errors,
      version: version,
      appName: String(bundle && bundle.app && bundle.app.name || ''),
      exportedAt: String(bundle && bundle.exportedAt || ''),
      messageCount: messages.length,
      structuredMemoryCount: structured.length,
      vectorCount: vectors.length,
      hasSettings: Boolean(bundle && bundle.preferences),
      hasLocalData: Boolean(bundle && bundle.localData && Object.keys(bundle.localData).length)
    };
  }

  async function applyImportedBundle(bundle) {
    var version = Number(bundle.version || 1);
    var context = version >= 2 && bundle.context && typeof bundle.context === 'object' ? bundle.context : {};
    preferences = mergeDefaults(preferenceDefaults(), bundle.preferences || {});
    localStorage.setItem(preferencesKey, JSON.stringify(preferences));
    canonical = mergeDefaults(data.initialState, bundle.canonical);
    canonical.conversation.status = 'idle';
    localStorage.setItem(stateKey, JSON.stringify(canonical));
    var conversation = context.conversation || canonical.conversation || { revision: 1, messages: [] };
    if (window.RPConversation && window.RPConversation.importData) await window.RPConversation.importData(conversation);
    var structured = context.structuredMemory || { version: 1, entries: [] };
    if (window.RPMemory && window.RPMemory.importData) await window.RPMemory.importData(structured);
    var vectors = context.vectors || { version: 1, items: [], fingerprints: [], retryQueue: [] };
    if (window.RPVectorMemory && window.RPVectorMemory.importData) await window.RPVectorMemory.importData(vectors);
    importLocalData(version >= 2 ? bundle.localData : {});
    window.RPEvents.emit('storage:canonical:changed', clone(canonical));
    window.RPEvents.emit('storage:preferences:changed', clone(preferences));
  }

  async function importBundle(bundle) {
    var inspection = inspectBundle(bundle);
    if (!inspection.ok) throw new Error(inspection.errors.join('；'));
    var backup = await exportFullBundle();
    try {
      await applyImportedBundle(bundle);
      return inspection;
    } catch (error) {
      try { await applyImportedBundle(backup); } catch (_rollbackError) {}
      throw error;
    }
  }

  function ownedStorageKeys(includePreferences) {
    var ownedPrefix = prefix + ':';
    var keys = [];
    if (typeof localStorage.key === 'function' && Number.isFinite(Number(localStorage.length))) {
      for (var index = 0; index < localStorage.length; index += 1) {
        var key = localStorage.key(index);
        if (key && key.indexOf(ownedPrefix) === 0 && (includePreferences || key !== preferencesKey)) keys.push(key);
      }
    }
    if (!keys.length) {
      keys = [stateKey, prefix + ':timeline', prefix + ':vector-retry-queue', prefix + ':structured-memory'];
      if (includePreferences) keys.push(preferencesKey);
      Object.keys(localDataKeys()).forEach(function (name) { keys.push(localDataKeys()[name]); });
    }
    return Array.from(new Set(keys));
  }

  window.RPStorage = {
    getCanonical: function () { return clone(canonical); },
    saveCanonical: saveCanonical,
    getPreferences: function () { return clone(preferences); },
    savePreferences: savePreferences,
    debugEnabled: debugEnabled,
    syncMemoryFromHost: syncMemoryFromHost,
    exportBundle: exportBundle,
    exportFullBundle: exportFullBundle,
    inspectBundle: inspectBundle,
    importBundle: importBundle,
    getActionCheckpoint: actionCheckpoint,
    saveActionCheckpoint: saveActionCheckpoint,
    epoch: function () { return resetEpoch; },
    clearRecords: function () {
      resetEpoch += 1;
      var preservedPreferences = clone(preferences);
      var ownedKeys = ownedStorageKeys(false);
      ownedKeys.forEach(function (key) { localStorage.removeItem(key); });
      if (window.RPConversation && window.RPConversation.clear) window.RPConversation.clear().catch(function () {});
      canonical = clone(data.initialState);
      preferences = preservedPreferences;
      localStorage.setItem(stateKey, JSON.stringify(canonical));
      localStorage.setItem(preferencesKey, JSON.stringify(preferences));
      if (window.RPMemory && window.RPMemory.reset) window.RPMemory.reset();
      if (window.RPVectorMemory && window.RPVectorMemory.clearAll) {
        window.RPVectorMemory.clearAll().catch(function (error) {
          window.RPEvents.emit('memory:vector:error', { message: String(error.message || error), source: 'storage-clear-records' });
        });
      }
      window.RPEvents.emit('storage:canonical:changed', clone(canonical));
      window.RPEvents.emit('storage:preferences:changed', clone(preferences));
      return { cleared: ownedKeys.length, prefix: prefix, preferencesPreserved: true };
    },
    reset: function () {
      resetEpoch += 1;
      var ownedKeys = ownedStorageKeys(true);
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
