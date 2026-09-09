(function () {
  'use strict';
  var handlers = {};
  var recent = {};
  var MAX_RECENT = 200;
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function eventId(event) { return String(event && (event.eventId || event.id || '') || '').trim(); }
  function valid(event) { return Boolean(event && typeof event === 'object' && !Array.isArray(event) && typeof event.type === 'string' && /^[a-z][a-z0-9_.-]{1,100}$/i.test(event.type)); }
  function register(type, handler, options) { if (typeof handler !== 'function' || !/^[a-z][a-z0-9_.-]{1,100}$/i.test(String(type || ''))) return false; handlers[String(type)] = { handler: handler, options: clone(options || {}) }; return true; }
  function unregister(type) { delete handlers[String(type || '')]; }
  function applyEvent(state, event, context) {
    if (!valid(event)) return { ok: false, reason: 'invalid-event' };
    var key = eventId(event);
    if (key && recent[key]) return { ok: true, duplicate: true, result: clone(recent[key]) };
    var record = handlers[String(event.type)];
    if (!record) return { ok: false, ignored: true, reason: 'no-handler', type: event.type };
    var before = clone(state);
    try {
      var result = record.handler(state, clone(event), context || {});
      var response = result && typeof result === 'object' ? result : { ok: result !== false };
      response.type = event.type;
      if (key) { recent[key] = clone(response); var keys = Object.keys(recent); if (keys.length > MAX_RECENT) delete recent[keys[0]]; }
      return response;
    } catch (error) {
      return { ok: false, type: event.type, reason: String(error && error.message || error), stateUnchanged: JSON.stringify(before) === JSON.stringify(state) };
    }
  }
  function applyEvents(state, events, context) { return (Array.isArray(events) ? events : []).map(function (event) { return applyEvent(state, event, context); }); }
  function clearRecent() { recent = {}; }
  window.RPAdvancedRules = { register: register, unregister: unregister, applyEvent: applyEvent, applyEvents: applyEvents, clearRecent: clearRecent, handlers: function () { return Object.keys(handlers); }, ensure: function (state) { return state; } };
})();
