(function () {
  'use strict';

  var pending = new Map();
  var sequence = 0;
  var timeoutMs = 2500;
  var capabilities = {
    host: window.parent !== window ? 'unknown' : 'standalone-preview',
    enhancedBridge: false,
    intentSubmit: typeof window.triggerSlash === 'function',
    modelsList: false,
    generation: false,
    embeddings: false,
    recordsRead: typeof window.rpHubGetCardRecords === 'function'
  };

  function request(type, payload, options) {
    options = options || {};
    if (window.parent === window) return Promise.reject(new Error('host bridge unavailable in standalone preview'));
    var requestId = 'rp-runtime-' + Date.now() + '-' + (++sequence);
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        pending.delete(requestId);
        reject(new Error(type + ' timed out'));
      }, options.timeoutMs || timeoutMs);
      pending.set(requestId, { resolve: resolve, reject: reject, timer: timer, type: type });
      window.parent.postMessage(Object.assign({
        type: type,
        requestId: requestId,
        runtimeId: window.RPTemplateData.app.id,
        protocolVersion: 1
      }, payload || {}), '*');
    });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent || !event.data || !event.data.requestId) return;
    var record = pending.get(event.data.requestId);
    if (!record) return;
    clearTimeout(record.timer);
    pending.delete(event.data.requestId);
    if (event.data.error) record.reject(new Error(String(event.data.error)));
    else record.resolve(event.data);
  });

  async function detect() {
    if (window.parent === window) {
      capabilities.intentSubmit = true;
      await window.RPEvents.emit('host:capabilities', Object.assign({}, capabilities));
      return Object.assign({}, capabilities);
    }
    try {
      var response = await request('RPHUB_CAPABILITIES_REQUEST', {}, { timeoutMs: 1200 });
      var supported = response.capabilities || {};
      capabilities = Object.assign(capabilities, {
        host: response.host || 'rp-hub',
        enhancedBridge: true,
        intentSubmit: supported.intentSubmit !== false,
        modelsList: supported.modelsList === true,
        generation: supported.generation === true,
        embeddings: supported.embeddings === true,
        recordsRead: supported.recordsRead === true || capabilities.recordsRead
      });
    } catch (_error) {
      capabilities.host = 'rp-hub-compatible';
      capabilities.intentSubmit = typeof window.triggerSlash === 'function';
    }
    await window.RPEvents.emit('host:capabilities', Object.assign({}, capabilities));
    return Object.assign({}, capabilities);
  }

  function submitIntent(text) {
    var command = String(text || '').trim();
    if (!command) return false;
    if (typeof window.triggerSlash === 'function') {
      window.triggerSlash(command.charAt(0) === '/' ? command : '/send ' + command);
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
    capabilities: function () { return Object.assign({}, capabilities); },
    request: request,
    submitIntent: submitIntent
  };
})();
