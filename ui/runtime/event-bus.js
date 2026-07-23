(function () {
  'use strict';

  var events = new Map();
  var history = [];
  var sequence = 0;
  var ranks = { first: 0, normal: 100, last: 200 };

  function normalizePriority(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return Object.prototype.hasOwnProperty.call(ranks, value) ? ranks[value] : ranks.normal;
  }

  function on(name, listener, options) {
    options = options || {};
    if (typeof listener !== 'function') throw new TypeError('event listener must be a function');
    var record = {
      id: ++sequence,
      name: String(name),
      listener: listener,
      owner: String(options.owner || 'anonymous'),
      priority: normalizePriority(options.priority),
      once: options.once === true
    };
    if (!events.has(record.name)) events.set(record.name, []);
    events.get(record.name).push(record);
    events.get(record.name).sort(function (a, b) {
      return a.priority - b.priority || a.id - b.id;
    });
    return function () { off(record.id); };
  }

  function once(name, listener, options) {
    return on(name, listener, Object.assign({}, options, { once: true }));
  }

  function off(id) {
    events.forEach(function (records, name) {
      var next = records.filter(function (record) { return record.id !== id; });
      if (next.length) events.set(name, next);
      else events.delete(name);
    });
  }

  function disposeOwner(owner) {
    events.forEach(function (records, name) {
      var next = records.filter(function (record) { return record.owner !== owner; });
      if (next.length) events.set(name, next);
      else events.delete(name);
    });
  }

  async function emit(name, payload) {
    var started = performance.now();
    var records = (events.get(String(name)) || []).slice();
    var errors = [];
    for (var i = 0; i < records.length; i += 1) {
      try {
        await records[i].listener(payload);
      } catch (error) {
        errors.push({ owner: records[i].owner, message: String(error && error.message || error) });
      }
      if (records[i].once) off(records[i].id);
    }
    history.push({
      name: String(name),
      listeners: records.length,
      errors: errors,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      at: new Date().toISOString()
    });
    history = history.slice(-100);
    return { errors: errors };
  }

  function inspect() {
    var listeners = [];
    events.forEach(function (records, name) {
      records.forEach(function (record) {
        listeners.push({
          event: name,
          owner: record.owner,
          priority: record.priority,
          once: record.once
        });
      });
    });
    return { listeners: listeners, history: history.slice() };
  }

  window.RPEvents = {
    on: on,
    once: once,
    emit: emit,
    disposeOwner: disposeOwner,
    inspect: inspect
  };
})();
