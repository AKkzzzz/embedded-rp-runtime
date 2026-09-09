(function () {
  'use strict';
  var recent = [];
  var generatedById = {};
  var errorsById = {};
  var promptsById = {};
  var statusById = {};
  var latestStatus = { phase: 'idle', id: '', prompt: '', message: '' };
  var revision = 0;
  var cacheKey = (window.RPTemplateData && window.RPTemplateData.app ? window.RPTemplateData.app.storagePrefix : 'rp-runtime') + ':image-cache';
  try {
    var savedCache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
    generatedById = savedCache.generated && typeof savedCache.generated === 'object' ? savedCache.generated : {};
    errorsById = savedCache.errors && typeof savedCache.errors === 'object' ? savedCache.errors : {};
    promptsById = savedCache.prompts && typeof savedCache.prompts === 'object' ? savedCache.prompts : {};
  } catch (_cacheError) {}
  function persistCache() {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ generated: generatedById, errors: errorsById, prompts: promptsById }));
    } catch (_cacheWriteError) {}
  }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function errorMessage(error, fallback) {
    return String(error && error.message || error || fallback || '生图失败');
  }
  function setStatus(id, phase, prompt, message) {
    var key = String(id || '');
    var status = {
      phase: String(phase || 'idle'),
      id: key,
      prompt: String(prompt || ''),
      message: String(message || ''),
      updatedAt: new Date().toISOString()
    };
    if (key) statusById[key] = status;
    latestStatus = status;
    return status;
  }
  function emitStatus(eventName, status, extra) {
    window.RPEvents.emit(eventName, Object.assign(clone(status), extra || {}));
  }
  function verifyImage(url) {
    return new Promise(function (resolve, reject) {
      if (typeof Image === 'undefined') { resolve(url); return; }
      var image = new Image();
      var timer = window.setTimeout(function () {
        image.onload = image.onerror = null;
        reject(new Error('图片服务响应超时，可点击重试'));
      }, 120000);
      image.onload = function () {
        window.clearTimeout(timer);
        resolve(url);
      };
      image.onerror = function () {
        window.clearTimeout(timer);
        reject(new Error('图片服务返回失败，可点击重试'));
      };
      image.referrerPolicy = 'no-referrer';
      image.src = url;
    });
  }
  window.RPImageGen = {
    settings: function () { return window.RPHost.imageSettings(); },
    serviceStatus: function () { return window.RPHost.imageServiceStatus(); },
    redetectService: function () { return window.RPHost.redetectImageGeneration(); },
    recent: function () { return clone(recent); },
    get: function (id) { return generatedById[String(id || '')] || null; },
    error: function (id) { return errorsById[String(id || '')] || null; },
    errors: function () { return clone(errorsById); },
    prompt: function (id) { return promptsById[String(id || '')] || ''; },
    status: function (id) { return clone(statusById[String(id || '')] || null); },
    latestStatus: function () { return clone(latestStatus); },
    statuses: function () { return clone(statusById); },
    revision: function () { return revision; },
    generate: async function (prompt, options) {
      options = options || {};
      var key = String(options.id || '');
      var text = String(prompt || '');
      setStatus(key, 'starting', text, '');
      emitStatus('image:requested', latestStatus, { options: clone(options) });
      try {
        if (!window.RPPlugins.isEnabled('runtime.image-generation')) {
          throw new Error('生图插件未启用');
        }
        if (!text) throw new Error('提示词为空');
        if (key) {
          promptsById[key] = text;
          persistCache();
        }
        setStatus(key, 'generating', text, '');
        emitStatus('image:generating', latestStatus);
        var result = await window.RPHost.generateImage(text, options);
        if (!result || !result.url) throw new Error('生图服务未返回图片地址');
        await verifyImage(result && result.url);
        recent.unshift(Object.assign({ createdAt: new Date().toISOString() }, result));
        if (key && result && result.url) {
          generatedById[key] = result.url;
          promptsById[key] = text;
          delete errorsById[key];
          persistCache();
        }
        recent = recent.slice(0, 12);
        revision += 1;
        var complete = setStatus(key, 'complete', text, '图片已生成');
        emitStatus('image:generated', Object.assign(clone(result) || {}, complete, {
          id: key,
          revision: revision
        }));
        return result;
      } catch (error) {
        var failed = setStatus(key, 'error', text, errorMessage(error));
        if (key) {
          delete generatedById[key];
          errorsById[key] = failed.message;
          persistCache();
        }
        revision += 1;
        emitStatus('image:generation-error', failed, { revision: revision });
        throw error;
      }
    },
    retry: function (id, prompt, options) {
      var key = String(id || '');
      delete generatedById[key];
      delete errorsById[key];
      if (prompt) promptsById[key] = String(prompt);
      persistCache();
      return window.RPImageGen.generate(String(prompt || promptsById[key] || ''), Object.assign({}, options || {}, { id: key }));
    },
    invalidate: function (id, error) {
      var key = String(id || '');
      delete generatedById[key];
      errorsById[key] = errorMessage(error, '图片载入失败');
      persistCache();
      revision += 1;
      var status = setStatus(key, 'error', promptsById[key], errorsById[key]);
      window.RPEvents.emit('image:generation-error', { id: key, message: errorsById[key], phase: status.phase, prompt: status.prompt, revision: revision });
    },
    recordError: function (id, error) {
      var key = String(id || '');
      delete generatedById[key];
      errorsById[key] = errorMessage(error, '生图失败');
      persistCache();
      revision += 1;
      var status = setStatus(key, 'error', promptsById[key], errorsById[key]);
      window.RPEvents.emit('image:generation-error', { id: key, message: errorsById[key], phase: status.phase, prompt: status.prompt, revision: revision });
    }
  };
  window.RPPlugins.attach('runtime.image-generation', {
    generate: function (context) { return window.RPImageGen.generate(context.prompt, context.options); }
  });
})();
