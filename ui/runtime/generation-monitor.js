(function () {
  'use strict';

  var listeners = new Set();
  var recent = [];
  var sequence = 0;
  var state = idleState();
  var notifyTimer = 0;

  function idleState() {
    return {
      id: '',
      phase: 'idle',
      route: '',
      model: '',
      stream: false,
      startedAt: 0,
      updatedAt: 0,
      durationMs: 0,
      reasoning: '',
      content: '',
      reasoningChars: 0,
      contentChars: 0,
      finishReason: '',
      usage: null,
      error: ''
    };
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function snapshot() {
    var output = clone(state);
    if (output.startedAt && ['starting', 'thinking', 'writing'].includes(output.phase)) {
      output.durationMs = Date.now() - output.startedAt;
    }
    return output;
  }

  function notify(immediate) {
    if (notifyTimer && typeof clearTimeout === 'function') clearTimeout(notifyTimer);
    var run = function () {
      notifyTimer = 0;
      var value = snapshot();
      listeners.forEach(function (listener) {
        try { listener(value); } catch (_error) {}
      });
    };
    if (immediate || typeof setTimeout !== 'function') run();
    else notifyTimer = setTimeout(run, 80);
  }

  function start(meta) {
    meta = meta || {};
    state = idleState();
    state.id = 'generation-' + Date.now().toString(36) + '-' + (++sequence).toString(36);
    state.phase = 'starting';
    state.route = String(meta.route || '');
    state.model = String(meta.model || '');
    state.stream = meta.stream !== false;
    state.startedAt = Date.now();
    state.updatedAt = state.startedAt;
    notify(true);
    return state.id;
  }

  function reasoning(delta, total) {
    state.phase = 'thinking';
    state.reasoning = String(total != null ? total : state.reasoning + String(delta || ''));
    state.reasoningChars = state.reasoning.length;
    state.updatedAt = Date.now();
    notify(false);
  }

  function content(delta, total) {
    state.phase = 'writing';
    state.content = String(total != null ? total : state.content + String(delta || ''));
    state.contentChars = state.content.length;
    state.updatedAt = Date.now();
    notify(false);
  }

  function finish(result) {
    result = result || {};
    if (result.reasoning != null) state.reasoning = String(result.reasoning);
    if (result.content != null) state.content = String(result.content);
    state.reasoningChars = state.reasoning.length;
    state.contentChars = state.content.length;
    state.finishReason = String(result.finishReason || '');
    state.usage = clone(result.usage || null);
    state.phase = 'complete';
    state.updatedAt = Date.now();
    state.durationMs = state.startedAt ? state.updatedAt - state.startedAt : Number(result.durationMs || 0);
    recent.unshift(snapshot());
    recent = recent.slice(0, 20);
    notify(true);
  }

  function fail(error) {
    state.phase = error && error.name === 'AbortError' ? 'stopped' : 'error';
    state.error = String(error && error.message || error || '未知错误');
    state.updatedAt = Date.now();
    state.durationMs = state.startedAt ? state.updatedAt - state.startedAt : 0;
    recent.unshift(snapshot());
    recent = recent.slice(0, 20);
    notify(true);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return function () {};
    listeners.add(listener);
    listener(snapshot());
    return function () { listeners.delete(listener); };
  }

  window.RPGenerationMonitor = {
    start: start,
    reasoning: reasoning,
    content: content,
    finish: finish,
    fail: fail,
    snapshot: snapshot,
    recent: function () { return clone(recent); },
    subscribe: subscribe
  };
})();
