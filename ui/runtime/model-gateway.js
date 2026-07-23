(function () {
  'use strict';

  var authoredRoutes = window.RPTemplateData.modelRoutes;
  var models = [];
  var diagnostics = [];

  function routes() {
    var overrides = window.RPStorage.getPreferences().modelRoutes || {};
    var output = {};
    Object.keys(authoredRoutes).forEach(function (id) {
      output[id] = Object.assign({}, authoredRoutes[id], overrides[id] || {});
    });
    return output;
  }

  async function refreshModels() {
    var caps = window.RPHost.capabilities();
    if (!caps.modelsList) {
      models = [];
      diagnostics.push({ at: new Date().toISOString(), kind: 'models', status: 'degraded', detail: '宿主未提供模型列表桥' });
      return [];
    }
    try {
      var response = await window.RPHost.request('RPHUB_MODELS_REQUEST');
      models = Array.isArray(response.models) ? response.models : [];
      diagnostics.push({ at: new Date().toISOString(), kind: 'models', status: 'ok', detail: models.length + ' models' });
      return models.slice();
    } catch (error) {
      diagnostics.push({ at: new Date().toISOString(), kind: 'models', status: 'error', detail: String(error.message || error) });
      return [];
    }
  }

  async function generate(routeId, messages, options) {
    var caps = window.RPHost.capabilities();
    var route = routes()[routeId];
    if (!route) throw new Error('unknown model route: ' + routeId);
    if (!caps.generation) throw new Error('host generation bridge unavailable');
    var started = performance.now();
    try {
      var response = await window.RPHost.request('RPHUB_GENERATE_REQUEST', {
        route: routeId,
        model: route.model || '',
        inherit: route.inherit || 'current',
        messages: messages,
        options: Object.assign({}, options || {}, {
          temperature: options && options.temperature != null ? options.temperature : route.temperature
        })
      }, { timeoutMs: 120000 });
      diagnostics.push({
        at: new Date().toISOString(),
        kind: 'generation',
        route: routeId,
        status: 'ok',
        durationMs: Math.round(performance.now() - started)
      });
      return response;
    } catch (error) {
      diagnostics.push({
        at: new Date().toISOString(),
        kind: 'generation',
        route: routeId,
        status: 'error',
        detail: String(error.message || error)
      });
      throw error;
    }
  }

  async function embed(texts) {
    var caps = window.RPHost.capabilities();
    var route = routes().embedding;
    if (!caps.embeddings) throw new Error('host embedding bridge unavailable');
    return window.RPHost.request('RPHUB_EMBED_REQUEST', {
      route: 'embedding',
      model: route.model || '',
      inherit: route.inherit || 'embedding',
      input: Array.isArray(texts) ? texts : [String(texts || '')]
    }, { timeoutMs: 120000 });
  }

  function setRoute(id, patch) {
    if (!authoredRoutes[id]) return false;
    var preferences = window.RPStorage.getPreferences();
    var next = Object.assign({}, preferences.modelRoutes || {});
    next[id] = Object.assign({}, next[id] || {}, patch || {});
    window.RPStorage.savePreferences({ modelRoutes: next });
    window.RPEvents.emit('models:routes:changed', routes());
    return true;
  }

  window.RPModels = {
    routes: routes,
    models: function () { return models.slice(); },
    refreshModels: refreshModels,
    generate: generate,
    embed: embed,
    setRoute: setRoute,
    diagnostics: function () { return diagnostics.slice(-50); }
  };
})();
