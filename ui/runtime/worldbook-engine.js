(function () {
  'use strict';

  var lastResult = null;

  function entries() {
    return window.RPTemplateData.worldbook.concat(
      window.RPWorldbookPatches ? window.RPWorldbookPatches.entries() : []
    );
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isDisabled(id) {
    return (window.RPStorage.getPreferences().worldbookDisabled || []).indexOf(id) !== -1;
  }

  function parseRegex(source) {
    var match = String(source || '').match(/^\/([\s\S]*)\/([dgimsuvy]*)$/);
    try {
      return match ? new RegExp(match[1], match[2].replace(/[gy]/g, '')) : new RegExp(String(source), 'i');
    } catch (_error) {
      return null;
    }
  }

  function stateMatches(state, path, expected) {
    var value = String(path || '').split('.').reduce(function (current, key) {
      return current == null ? undefined : current[key];
    }, state);
    if (expected && typeof expected === 'object') {
      if (Object.prototype.hasOwnProperty.call(expected, 'eq')) return value === expected.eq;
      if (Object.prototype.hasOwnProperty.call(expected, 'in')) return expected.in.indexOf(value) !== -1;
      if (Object.prototype.hasOwnProperty.call(expected, 'gte')) return Number(value) >= Number(expected.gte);
      if (Object.prototype.hasOwnProperty.call(expected, 'lte')) return Number(value) <= Number(expected.lte);
    }
    return value === expected;
  }

  function evaluate(entry, query, state) {
    var trigger = entry.trigger || {};
    if (entry.constant || trigger.type === 'constant') return { matched: true, score: 1000, reason: 'constant' };
    if (trigger.type === 'literal') {
      var haystack = trigger.caseSensitive ? query : query.toLowerCase();
      var keys = trigger.keys || [];
      var matchedKeys = keys.filter(function (key) {
        var needle = trigger.caseSensitive ? String(key) : String(key).toLowerCase();
        return haystack.indexOf(needle) !== -1;
      });
      return { matched: matchedKeys.length > 0, score: matchedKeys.length * 20, reason: 'literal:' + matchedKeys.join(',') };
    }
    if (trigger.type === 'regex') {
      var matchedPatterns = (trigger.patterns || []).filter(function (pattern) {
        var regex = parseRegex(pattern);
        return regex ? regex.test(query) : false;
      });
      return { matched: matchedPatterns.length > 0, score: matchedPatterns.length * 25, reason: 'regex:' + matchedPatterns.join(',') };
    }
    if (trigger.type === 'state') {
      var ok = stateMatches(state, trigger.path, trigger.expected);
      return { matched: ok, score: ok ? 30 : 0, reason: 'state:' + trigger.path };
    }
    if (trigger.type === 'semantic') {
      return { matched: false, score: 0, reason: 'semantic:pending-vector-index' };
    }
    return { matched: false, score: 0, reason: 'unsupported:' + String(trigger.type || 'none') };
  }

  function byId(id) {
    return entries().find(function (entry) { return entry.id === id; }) || null;
  }

  function retrieve(query, options) {
    options = Object.assign({
      charBudget: 26000,
      selectiveLimit: 12,
      maxDependencyDepth: 3,
      state: window.RPStorage.getCanonical()
    }, options || {});
    var diagnostics = [];
    var primary = [];
    entries().forEach(function (entry) {
      if (entry.enabled === false || isDisabled(entry.id)) return;
      var result = evaluate(entry, String(query || ''), options.state);
      diagnostics.push({ id: entry.id, matched: result.matched, score: result.score, reason: result.reason });
      if (result.matched) primary.push({ entry: entry, score: result.score, depth: 0, reason: result.reason });
    });
    primary.sort(function (a, b) {
      return b.score - a.score || Number(b.entry.order || 0) - Number(a.entry.order || 0);
    });
    var constants = primary.filter(function (row) { return row.entry.constant; });
    var selective = primary.filter(function (row) { return !row.entry.constant; }).slice(0, options.selectiveLimit);
    var queue = constants.concat(selective);
    var seen = new Set();
    var hits = [];
    var usedChars = 0;
    while (queue.length) {
      var row = queue.shift();
      if (!row.entry || seen.has(row.entry.id)) continue;
      if (row.depth > options.maxDependencyDepth) {
        diagnostics.push({ id: row.entry.id, matched: false, reason: 'dependency-depth-limit' });
        continue;
      }
      var block = '【' + row.entry.name + '】\n' + row.entry.content;
      if (usedChars + block.length > options.charBudget) {
        diagnostics.push({ id: row.entry.id, matched: false, reason: 'char-budget' });
        continue;
      }
      seen.add(row.entry.id);
      usedChars += block.length;
      hits.push({
        id: row.entry.id,
        name: row.entry.name,
        depth: row.depth,
        reason: row.reason,
        placement: row.entry.placement,
        chars: block.length,
        content: row.entry.content
      });
      (row.entry.dependencies || []).forEach(function (dependencyId) {
        var dependency = byId(dependencyId);
        if (!dependency) {
          diagnostics.push({ id: dependencyId, matched: false, reason: 'missing-dependency', parent: row.entry.id });
          return;
        }
        if (seen.has(dependencyId)) return;
        queue.push({
          entry: dependency,
          score: row.score,
          depth: row.depth + 1,
          reason: 'dependency:' + row.entry.id
        });
      });
    }
    lastResult = {
      query: String(query || ''),
      hits: hits,
      usedChars: usedChars,
      diagnostics: diagnostics,
      at: new Date().toISOString()
    };
    window.RPEvents.emit('worldbook:retrieved', clone(lastResult));
    return clone(lastResult);
  }

  function setEnabled(id, enabled) {
    if (!byId(id)) return false;
    var disabled = (window.RPStorage.getPreferences().worldbookDisabled || []).filter(function (value) {
      return value !== id;
    });
    if (!enabled) disabled.push(id);
    window.RPStorage.savePreferences({ worldbookDisabled: Array.from(new Set(disabled)) });
    window.RPEvents.emit('worldbook:preferences:changed', { id: id, enabled: enabled });
    return true;
  }

  function list() {
    return entries().map(function (entry) {
      return Object.assign(clone(entry), { runtimeEnabled: entry.enabled !== false && !isDisabled(entry.id) });
    });
  }

  window.RPWorldbook = {
    list: list,
    byId: byId,
    retrieve: retrieve,
    setEnabled: setEnabled,
    last: function () { return clone(lastResult); }
  };
})();
