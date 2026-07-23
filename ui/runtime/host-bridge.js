(function () {
  'use strict';

  var SETTINGS_DB = 'RPHubDB';
  var SETTINGS_KEY = 'rp_hub_settings';
  var MEMORY_SETTINGS_KEY = 'rp_hub_memory_settings';
  var cachedSettings = null;
  var cachedMemorySettings = null;
  var lastError = '';
  var detected = false;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function readIndexedDbKey(databaseName, key) {
    return new Promise(function (resolve) {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      var settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        resolve(value == null ? null : value);
      }
      function openExisting() {
        try {
        var request = indexedDB.open(databaseName);
        request.onerror = function () { finish(null); };
        request.onblocked = function () { finish(null); };
        request.onsuccess = function () {
          var database = request.result;
          var names = Array.from(database.objectStoreNames || []);
          if (!names.length) {
            database.close();
            finish(null);
            return;
          }
          var stores = names.includes('store') ? ['store'] : names;
          function next(index) {
            if (index >= stores.length) {
              database.close();
              finish(null);
              return;
            }
            try {
              var transaction = database.transaction(stores[index], 'readonly');
              var get = transaction.objectStore(stores[index]).get(key);
              get.onsuccess = function () {
                if (get.result != null) {
                  database.close();
                  finish(get.result);
                } else {
                  next(index + 1);
                }
              };
              get.onerror = function () { next(index + 1); };
            } catch (_error) {
              next(index + 1);
            }
          }
          next(0);
        };
        } catch (_error) {
          finish(null);
        }
      }
      if (typeof indexedDB.databases === 'function') {
        indexedDB.databases().then(function (databases) {
          var exists = (databases || []).some(function (database) { return database && database.name === databaseName; });
          if (exists) openExisting();
          else finish(null);
        }).catch(openExisting);
      } else {
        openExisting();
      }
    });
  }

  function readLocalSettings() {
    var scopes = [window];
    try {
      if (window.parent && window.parent !== window) scopes.push(window.parent);
    } catch (_error) {}
    for (var index = 0; index < scopes.length; index += 1) {
      try {
        var raw = scopes[index].localStorage.getItem(SETTINGS_KEY);
        if (raw) return JSON.parse(raw);
      } catch (_error) {}
    }
    return null;
  }

  function normalizeSettings(value, memoryValue) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var apiUrl = String(value.apiUrl || '').trim().replace(/\/+$/, '');
    var apiKey = String(value.apiKey || '').trim();
    if (!apiUrl || !apiKey) return null;
    return Object.assign({}, clone(value), {
      apiUrl: apiUrl,
      apiKey: apiKey,
      model: String(value.model || '').trim(),
      qualityModel: String(value.qualityModel || '').trim(),
      balancedModel: String(value.balancedModel || '').trim(),
      fastModel: String(value.fastModel || '').trim(),
      uiTemplateModel: String(value.uiTemplateModel || '').trim(),
      embeddingModel: String(memoryValue && memoryValue.embeddingModel || value.embeddingModel || '').trim(),
      summaryModel: String(memoryValue && memoryValue.classicModel || value.summaryModel || value.summarizeModel || '').trim(),
      temperature: Number.isFinite(Number(value.temperature)) ? Number(value.temperature) : 1,
      stream: value.stream !== false
    });
  }

  function publicSettings() {
    if (!cachedSettings) return null;
    return {
      apiUrl: cachedSettings.apiUrl,
      providerId: String(cachedSettings.apiProviderId || ''),
      model: cachedSettings.model,
      qualityModel: cachedSettings.qualityModel,
      balancedModel: cachedSettings.balancedModel,
      fastModel: cachedSettings.fastModel,
      uiTemplateModel: cachedSettings.uiTemplateModel,
      embeddingModel: cachedSettings.embeddingModel,
      summaryModel: cachedSettings.summaryModel,
      temperature: cachedSettings.temperature,
      stream: cachedSettings.stream,
      hasApiKey: Boolean(cachedSettings.apiKey)
      ,memoryMode: String(cachedMemorySettings && cachedMemorySettings.mode || '')
    };
  }

  function capabilities() {
    var configured = Boolean(cachedSettings);
    return {
      host: window.parent !== window ? 'rp-hub-same-origin' : 'standalone-preview',
      enhancedBridge: false,
      sameOriginSettings: configured,
      intentSubmit: typeof window.triggerSlash === 'function',
      modelsList: configured && typeof fetch === 'function',
      generation: configured && typeof fetch === 'function',
      embeddings: configured && typeof fetch === 'function',
      recordsRead: typeof window.rpHubGetCardRecords === 'function',
      settingsDetected: detected,
      lastError: lastError
    };
  }

  async function detect() {
    lastError = '';
    var value = null;
    try {
      var stored = await Promise.all([
        readIndexedDbKey(SETTINGS_DB, SETTINGS_KEY),
        readIndexedDbKey(SETTINGS_DB, MEMORY_SETTINGS_KEY)
      ]);
      value = stored[0];
      cachedMemorySettings = stored[1] && typeof stored[1] === 'object' ? clone(stored[1]) : null;
      if (!value) value = readLocalSettings();
      cachedSettings = normalizeSettings(value, cachedMemorySettings);
      if (!cachedSettings) lastError = 'RP-Hub API 设置不存在或不完整';
    } catch (error) {
      cachedSettings = null;
      lastError = String(error && error.message || error);
    }
    detected = true;
    await window.RPEvents.emit('host:capabilities', capabilities());
    return capabilities();
  }

  function endpoint(path) {
    if (!cachedSettings) throw new Error('RP-Hub API 设置尚未载入');
    var base = cachedSettings.apiUrl.replace(/\/+$/, '');
    var suffix = String(path || '').replace(/^\/+/, '');
    if (/\/v1$/i.test(base)) return base + '/' + suffix.replace(/^v1\//i, '');
    return base + '/v1/' + suffix.replace(/^v1\//i, '');
  }

  async function apiFetch(path, options) {
    if (!cachedSettings) throw new Error('没有读取到 RP-Hub API 设置');
    var request = Object.assign({}, options || {});
    request.headers = Object.assign({}, request.headers || {}, {
      Authorization: 'Bearer ' + cachedSettings.apiKey
    });
    return fetch(endpoint(path), request);
  }

  function resolveModel(inherit, explicit) {
    if (explicit) return String(explicit);
    if (!cachedSettings) return '';
    var aliases = {
      current: cachedSettings.model,
      quality: cachedSettings.qualityModel || cachedSettings.model,
      balanced: cachedSettings.balancedModel || cachedSettings.model,
      fast: cachedSettings.fastModel || cachedSettings.model,
      variable: cachedSettings.uiTemplateModel || cachedSettings.balancedModel || cachedSettings.model
      ,embedding: cachedSettings.embeddingModel
      ,summarize: cachedSettings.summaryModel
    };
    return aliases[inherit] || cachedSettings.model || '';
  }

  function submitIntent(text) {
    var command = String(text || '').trim();
    if (!command) return false;
    if (typeof window.triggerSlash === 'function') {
      window.triggerSlash(command);
      return true;
    }
    if (window.parent === window) {
      window.RPEvents.emit('preview:intent', { text: command });
      return true;
    }
    return false;
  }

  window.RPHost = {
    detect: detect,
    refresh: detect,
    capabilities: capabilities,
    settings: publicSettings,
    endpoint: endpoint,
    apiFetch: apiFetch,
    resolveModel: resolveModel,
    submitIntent: submitIntent
  };
})();
