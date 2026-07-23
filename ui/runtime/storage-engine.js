(function () {
  'use strict';

  var data = window.RPTemplateData;
  var prefix = data.app.storagePrefix;
  var stateKey = prefix + ':canonical';
  var preferencesKey = prefix + ':preferences';

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

  var canonical = mergeDefaults(data.initialState, readJson(stateKey, data.initialState));
  var preferences = readJson(preferencesKey, {
    activeDebugPage: 'overview',
    worldbookDisabled: [],
    pluginEnabled: {},
    modelRoutes: {},
    reducedMotion: false
  });

  function saveCanonical(next) {
    canonical = clone(next);
    localStorage.setItem(stateKey, JSON.stringify(canonical));
    window.RPEvents.emit('storage:canonical:changed', clone(canonical));
    return clone(canonical);
  }

  function savePreferences(next) {
    preferences = Object.assign({}, preferences, clone(next || {}));
    localStorage.setItem(preferencesKey, JSON.stringify(preferences));
    window.RPEvents.emit('storage:preferences:changed', clone(preferences));
    return clone(preferences);
  }

  function exportBundle() {
    return {
      format: 'embedded-rp-runtime-save',
      version: 1,
      app: clone(data.app),
      canonical: clone(canonical),
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
    reset: function () {
      localStorage.removeItem(stateKey);
      localStorage.removeItem(preferencesKey);
      canonical = clone(data.initialState);
      preferences = {};
    }
  };
})();
