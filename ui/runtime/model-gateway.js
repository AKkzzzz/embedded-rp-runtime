(function () {
  'use strict';

  var authoredRoutes = window.RPTemplateData.modelRoutes;
  var models = [];
  var diagnostics = [];

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function routes() {
    var overrides = window.RPStorage.getPreferences().modelRoutes || {};
    var output = {};
    Object.keys(authoredRoutes).forEach(function (id) {
      output[id] = Object.assign({}, authoredRoutes[id], overrides[id] || {});
    });
    return output;
  }

  function remember(entry) {
    diagnostics.push(Object.assign({ at: new Date().toISOString() }, entry));
    diagnostics = diagnostics.slice(-50);
  }

  function apiError(status, payload) {
    var message = '';
    if (payload && typeof payload === 'object') {
      message = payload.error && (payload.error.message || payload.error.msg) ||
        payload.message || payload.msg || '';
    }
    if (!message) message = String(payload || '').slice(0, 500);
    return new Error('API ' + status + (message ? '：' + message : ''));
  }

  function reasoningFrom(value) {
    if (!value || typeof value !== 'object') return '';
    return String(
      value.reasoning_content ||
      value.reasoning ||
      value.reasoningContent ||
      value.thinking ||
      ''
    );
  }

  function parseSseText(text, handlers) {
    var content = '';
    var reasoning = '';
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      var value = trimmed.slice(5).trim();
      if (!value || value === '[DONE]') return;
      var data;
      try {
        data = JSON.parse(value);
      } catch (_error) {
        return;
      }
      if (data.error) throw apiError(200, data);
      var choice = data.choices && data.choices[0];
      if (!choice) return;
      var delta = choice.delta || choice.message || {};
      var nextContent = String(delta.content || '');
      var nextReasoning = reasoningFrom(delta) || reasoningFrom(choice);
      if (nextReasoning) {
        reasoning += nextReasoning;
        if (handlers.onReasoning) handlers.onReasoning(nextReasoning, reasoning);
      }
      if (nextContent) {
        content += nextContent;
        if (handlers.onDelta) handlers.onDelta(nextContent, content);
      }
    });
    return { content: content, reasoning: reasoning };
  }

  function parseJsonResponse(data, handlers) {
    if (data && data.error) throw apiError(200, data);
    var choice = data && data.choices && data.choices[0] || {};
    var message = choice.message || choice.delta || {};
    var content = String(message.content || '');
    var reasoning = reasoningFrom(message) || reasoningFrom(choice);
    if (reasoning && handlers.onReasoning) handlers.onReasoning(reasoning, reasoning);
    if (content && handlers.onDelta) handlers.onDelta(content, content);
    return {
      content: content,
      reasoning: reasoning,
      finishReason: choice.finish_reason || '',
      usage: clone(data && data.usage || null)
    };
  }

  async function consumeStream(response, handlers) {
    var reader = response.body && response.body.getReader ? response.body.getReader() : null;
    if (!reader) return parseSseText(await response.text(), handlers);
    var decoder = new TextDecoder();
    var buffer = '';
    var content = '';
    var reasoning = '';
    var finishReason = '';
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (var index = 0; index < lines.length; index += 1) {
        var trimmed = lines[index].trim();
        if (!trimmed.startsWith('data:')) continue;
        var raw = trimmed.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        var data;
        try {
          data = JSON.parse(raw);
        } catch (_error) {
          continue;
        }
        if (data.error) throw apiError(response.status, data);
        var choice = data.choices && data.choices[0];
        if (!choice) continue;
        finishReason = choice.finish_reason || finishReason;
        var delta = choice.delta || choice.message || {};
        var nextContent = String(delta.content || '');
        var nextReasoning = reasoningFrom(delta) || reasoningFrom(choice);
        if (nextReasoning) {
          reasoning += nextReasoning;
          if (handlers.onReasoning) handlers.onReasoning(nextReasoning, reasoning);
        }
        if (nextContent) {
          content += nextContent;
          if (handlers.onDelta) handlers.onDelta(nextContent, content);
        }
      }
    }
    if (buffer.trim()) {
      var tail = parseSseText(buffer, {
        onDelta: function (delta) {
          content += delta;
          if (handlers.onDelta) handlers.onDelta(delta, content);
        },
        onReasoning: function (delta) {
          reasoning += delta;
          if (handlers.onReasoning) handlers.onReasoning(delta, reasoning);
        }
      });
      if (!content && tail.content) content = tail.content;
      if (!reasoning && tail.reasoning) reasoning = tail.reasoning;
    }
    return { content: content, reasoning: reasoning, finishReason: finishReason, usage: null };
  }

  async function readResponse(response, streamRequested, handlers) {
    var contentType = String(response.headers && response.headers.get('content-type') || '').toLowerCase();
    if (streamRequested && contentType.includes('text/event-stream')) {
      return consumeStream(response, handlers);
    }
    var raw = await response.text();
    try {
      return parseJsonResponse(JSON.parse(raw), handlers);
    } catch (error) {
      if (error && /^API /.test(error.message || '')) throw error;
      if (/^\s*data:/m.test(raw)) return parseSseText(raw, handlers);
      throw new Error('无法解析模型响应：' + String(error && error.message || error));
    }
  }

  async function refreshModels() {
    var caps = window.RPHost.capabilities();
    if (!caps.modelsList) {
      models = [];
      remember({ kind: 'models', status: 'degraded', detail: caps.lastError || 'RP-Hub 设置不可用' });
      return [];
    }
    var started = performance.now();
    try {
      var response = await window.RPHost.apiFetch('models');
      var raw = await response.text();
      if (!response.ok) {
        var detail;
        try { detail = JSON.parse(raw); } catch (_error) { detail = raw; }
        throw apiError(response.status, detail);
      }
      var data = JSON.parse(raw);
      var list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
      models = list.map(function (item) {
        return typeof item === 'string' ? { id: item } : item;
      }).filter(function (item) { return item && (item.id || item.name); });
      remember({ kind: 'models', status: 'ok', detail: models.length + ' models', durationMs: Math.round(performance.now() - started) });
      return clone(models);
    } catch (error) {
      models = [];
      remember({ kind: 'models', status: 'error', detail: String(error.message || error) });
      return [];
    }
  }

  async function generate(routeId, messages, options) {
    options = options || {};
    var caps = window.RPHost.capabilities();
    var route = routes()[routeId];
    if (!route) throw new Error('unknown model route: ' + routeId);
    if (!caps.generation) throw new Error(caps.lastError || 'RP-Hub API 设置不可用');
    var model = window.RPHost.resolveModel(route.inherit || 'current', route.model);
    if (!model) throw new Error('RP-Hub 尚未选择可用模型');
    var hostSettings = window.RPHost.settings() || {};
    var stream = options.stream !== undefined ? options.stream !== false : hostSettings.stream !== false;
    var context = {
      route: routeId,
      model: model,
      messages: clone(messages || []),
      options: Object.assign({}, options, {
        temperature: options.temperature != null ? Number(options.temperature) : Number(route.temperature != null ? route.temperature : hostSettings.temperature),
        stream: stream
      })
    };
    context = await window.RPPlugins.run('beforeRequest', context);
    var started = performance.now();
    if (window.RPGenerationMonitor) {
      window.RPGenerationMonitor.start({
        route: routeId,
        model: context.model,
        stream: context.options.stream
      });
    }
    try {
      var response = await window.RPHost.apiFetch('chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: context.model,
          messages: context.messages.map(function (message) {
            return { role: message.role, content: String(message.content || '') };
          }),
          temperature: context.options.temperature,
          stream: context.options.stream,
          ...(context.options.stream ? { stream_options: { include_usage: true } } : {})
        }),
        signal: options.signal
      });
      if (!response.ok) {
        var raw = await response.text();
        var detail;
        try { detail = JSON.parse(raw); } catch (_error) { detail = raw; }
        throw apiError(response.status, detail);
      }
      var result = await readResponse(response, context.options.stream, {
        onDelta: function (delta, total) {
          if (window.RPGenerationMonitor) window.RPGenerationMonitor.content(delta, total);
          if (options.onDelta) options.onDelta(delta, total);
        },
        onReasoning: function (delta, total) {
          if (window.RPGenerationMonitor) window.RPGenerationMonitor.reasoning(delta, total);
          if (options.onReasoning) options.onReasoning(delta, total);
        }
      });
      result.route = routeId;
      result.model = context.model;
      result.durationMs = Math.round(performance.now() - started);
      result = await window.RPPlugins.run('afterResponse', result);
      remember({ kind: 'generation', route: routeId, model: context.model, status: 'ok', durationMs: result.durationMs });
      if (window.RPGenerationMonitor) window.RPGenerationMonitor.finish(result);
      return result;
    } catch (error) {
      remember({ kind: 'generation', route: routeId, model: context.model, status: error && error.name === 'AbortError' ? 'aborted' : 'error', detail: String(error.message || error) });
      if (window.RPGenerationMonitor) window.RPGenerationMonitor.fail(error);
      throw error;
    }
  }

  async function embed(inputs, options) {
    options = options || {};
    var caps = window.RPHost.capabilities();
    if (!caps.generation) throw new Error(caps.lastError || 'RP-Hub API 设置不可用');
    var route = routes().embedding;
    var model = window.RPHost.resolveModel('embedding', route && route.model);
    if (!model) throw new Error('尚未选择向量嵌入模型');
    var values = (Array.isArray(inputs) ? inputs : [inputs]).map(function (value) {
      return String(value || '').trim();
    }).filter(Boolean);
    if (!values.length) return [];
    var response = await window.RPHost.apiFetch('embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model, input: values.length === 1 ? values[0] : values }),
      signal: options.signal
    });
    var raw = await response.text();
    var data;
    try { data = JSON.parse(raw); } catch (_error) { throw new Error('无法解析向量接口响应'); }
    if (!response.ok || data.error) throw apiError(response.status, data);
    var rows = Array.isArray(data.data) ? data.data.slice().sort(function (a, b) {
      return Number(a.index || 0) - Number(b.index || 0);
    }) : [];
    var vectors = rows.map(function (row) {
      var vector = row && (row.embedding || row.values);
      return Array.isArray(vector) ? vector.map(Number).filter(Number.isFinite) : [];
    });
    if (vectors.length !== values.length || vectors.some(function (vector) { return !vector.length; })) {
      throw new Error('向量接口返回的数据不完整');
    }
    remember({ kind: 'embedding', model: model, status: 'ok', count: vectors.length });
    return vectors;
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
    models: function () { return clone(models); },
    refreshModels: refreshModels,
    generate: generate,
    embed: embed,
    setRoute: setRoute,
    diagnostics: function () { return clone(diagnostics); },
    parseSseText: parseSseText,
    parseJsonResponse: parseJsonResponse
  };
})();
