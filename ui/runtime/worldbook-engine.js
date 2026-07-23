(function () {
  'use strict';

  // RP-Hub field and scan semantics, extended with explicit dependency traversal.
  // Source baseline: STA1N156/RP-Hub 092ab90 (CC BY-NC 4.0).

  var lastResult = null;
  var placementAliases = {
    before_character: 'before_char',
    after_character: 'after_char',
    character_top: 'before_char',
    character_bottom: 'after_char',
    before_examples: 'before_char',
    after_examples: 'after_char',
    example_top: 'before_char',
    example_bottom: 'after_char',
    an_top: 'global_note',
    an_bottom: 'global_note',
    author_note: 'global_note'
  };
  var numericPlacements = {
    0: 'before_char',
    1: 'after_char',
    2: 'global_note',
    3: 'global_note',
    4: 'at_depth'
  };
  var validPlacements = new Set([
    'system_top', 'global_note', 'before_char', 'after_char',
    'user_top', 'assistant_top', 'at_depth'
  ]);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function toBoolean(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'false') return false;
      if (value.toLowerCase() === 'true') return true;
    }
    return Boolean(value);
  }

  function toNumber(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeKeys(value) {
    if (Array.isArray(value)) return value.map(String).map(function (key) { return key.trim(); }).filter(Boolean);
    if (typeof value === 'string') return value.split(/[,，]/).map(function (key) { return key.trim(); }).filter(Boolean);
    return [];
  }

  function stableId(source, index) {
    if (source.id || source.uid) return String(source.id || source.uid);
    var seed = [source.comment || source.name || '', source.content || '', normalizeKeys(source.keys || source.key).join('|')].join('\n');
    var hash = 2166136261;
    for (var i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return 'worldbook-imported-' + (hash >>> 0).toString(36) + (seed ? '' : '-' + (index + 1));
  }

  function normalizePlacement(value) {
    if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
    if (typeof value === 'number' && Object.prototype.hasOwnProperty.call(numericPlacements, value)) {
      return numericPlacements[value];
    }
    var normalized = String(value || 'at_depth').toLowerCase().replace(/ /g, '_');
    normalized = placementAliases[normalized] || normalized;
    return validPlacements.has(normalized) ? normalized : 'at_depth';
  }

  function normalizeEntry(source, index) {
    source = source || {};
    var merged = Object.assign({}, source, source.extensions || {});
    var explicitTrigger = merged.trigger && typeof merged.trigger === 'object' ? clone(merged.trigger) : null;
    var keys = normalizeKeys(merged.keys !== undefined ? merged.keys : merged.key);
    if (!keys.length && explicitTrigger && explicitTrigger.type === 'literal') keys = normalizeKeys(explicitTrigger.keys);
    if (!keys.length && explicitTrigger && explicitTrigger.type === 'regex') keys = normalizeKeys(explicitTrigger.patterns);
    var useRegex = toBoolean(merged.useRegex !== undefined ? merged.useRegex : merged.use_regex, false) ||
      Boolean(explicitTrigger && explicitTrigger.type === 'regex');
    var constant = toBoolean(merged.constant, false) || Boolean(explicitTrigger && explicitTrigger.type === 'constant');
    var trigger = explicitTrigger || (constant
      ? { type: 'constant' }
      : useRegex
        ? { type: 'regex', patterns: keys }
        : { type: 'literal', keys: keys, caseSensitive: false });
    var disabled = toBoolean(merged.disable !== undefined ? merged.disable : merged.disabled, false);
    return Object.assign({}, clone(merged), {
      id: stableId(merged, index),
      name: String(merged.name || merged.comment || '未命名条目'),
      comment: String(merged.comment || merged.name || '未命名条目'),
      content: String(merged.content || ''),
      enabled: toBoolean(merged.enabled, true) && !disabled,
      locked: toBoolean(merged.locked, false),
      constant: constant,
      scope: merged.scope === 'global' ? 'global' : 'character',
      trigger: trigger,
      keys: keys,
      useRegex: useRegex,
      placement: normalizePlacement(merged.placement !== undefined ? merged.placement : merged.position),
      position: normalizePlacement(merged.placement !== undefined ? merged.placement : merged.position),
      order: toNumber(merged.order !== undefined ? merged.order : merged.insertion_order, 0),
      depth: Math.max(0, toNumber(merged.depth, 4)),
      scanDepth: merged.scanDepth !== undefined || merged.scan_depth !== undefined
        ? Math.max(0, toNumber(merged.scanDepth !== undefined ? merged.scanDepth : merged.scan_depth, 0))
        : null,
      probability: Math.min(100, Math.max(0, toNumber(merged.probability, 100))),
      useProbability: toBoolean(merged.useProbability !== undefined ? merged.useProbability : merged.use_probability, true),
      dependencies: Array.isArray(merged.dependencies) ? merged.dependencies.map(String) : []
    });
  }

  function entries() {
    var source = window.RPTemplateData.worldbook.concat(
      window.RPWorldbookPatches ? window.RPWorldbookPatches.entries() : []
    );
    return source.map(normalizeEntry);
  }

  function isDisabled(id) {
    return (window.RPStorage.getPreferences().worldbookDisabled || []).indexOf(id) !== -1;
  }

  function runtimeEnabled(entry) {
    return entry.enabled !== false && !isDisabled(entry.id);
  }

  function parseRegex(source) {
    var match = String(source || '').match(/^\/([\s\S]*)\/([dgimsuvy]*)$/);
    try {
      var flags = match ? match[2] : 'i';
      flags = flags.replace(/[gy]/g, '');
      if (match && /\\[pP]\{/.test(match[1]) && flags.indexOf('u') === -1) flags += 'u';
      return match ? new RegExp(match[1], flags) : new RegExp(String(source), 'i');
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

  function messageContent(message) {
    return String(message && message.content !== undefined ? message.content : message || '');
  }

  function postprocessHistory(history, query) {
    var queryIndex = (history || []).length;
    var source = (history || []).map(function (message, index) {
      return {
        role: message && message.role === 'assistant' ? 'assistant' : message && message.role === 'user' ? 'user' : 'system',
        content: messageContent(message),
        indexes: [index]
      };
    }).filter(function (message) {
      return (message.role === 'user' || message.role === 'assistant') && message.content.trim();
    });
    source.push({ role: 'user', content: String(query || ''), indexes: [queryIndex] });
    return source.reduce(function (merged, message) {
      var previous = merged[merged.length - 1];
      if (previous && previous.role === message.role) {
        previous.content += '\n\n' + message.content;
        previous.indexes = previous.indexes.concat(message.indexes);
      } else {
        merged.push(message);
      }
      return merged;
    }, []);
  }

  function scanWindow(entry, query, history, options) {
    var messages = postprocessHistory(history, query);
    var rawDepth = entry.scanDepth === null ? options.scanDepth : entry.scanDepth;
    var depth = Math.max(0, toNumber(rawDepth, options.scanDepth));
    if (options.maxScanDepth > 0) depth = Math.min(depth, options.maxScanDepth);
    return { depth: depth, messages: depth > 0 ? messages.slice(-depth) : [] };
  }

  function evaluate(entry, query, history, state, options, probabilityCache) {
    var trigger = entry.trigger || {};
    if (entry.constant || trigger.type === 'constant') {
      return { matched: true, score: 1000, reason: 'constant', matchedKeys: ['常驻'], messageIndexes: [] };
    }
    if (entry.useProbability && entry.probability < 100) {
      if (!probabilityCache.has(entry.id)) probabilityCache.set(entry.id, entry.probability > 0 && options.random() * 100 < entry.probability);
      if (!probabilityCache.get(entry.id)) {
        return { matched: false, score: 0, reason: 'probability', matchedKeys: [], messageIndexes: [] };
      }
    }
    if (trigger.type === 'state') {
      var stateOk = stateMatches(state, trigger.path, trigger.expected);
      return { matched: stateOk, score: stateOk ? 30 : 0, reason: 'state:' + trigger.path, matchedKeys: [], messageIndexes: [] };
    }
    if (trigger.type === 'semantic') {
      return { matched: false, score: 0, reason: 'semantic:pending-vector-index', matchedKeys: [], messageIndexes: [] };
    }
    var window = scanWindow(entry, query, history, options);
    if (!window.messages.length) {
      return { matched: false, score: 0, reason: 'scan-depth:0', matchedKeys: [], messageIndexes: [] };
    }
    var patterns = trigger.type === 'regex' ? (trigger.patterns || entry.keys) : (trigger.keys || entry.keys);
    var matchedKeys = [];
    var messageIndexes = new Set();
    (patterns || []).forEach(function (pattern) {
      var matched = false;
      window.messages.forEach(function (message) {
        var ok;
        if (trigger.type === 'regex') {
          var regex = parseRegex(pattern);
          ok = regex ? regex.test(message.content) : false;
        } else {
          var caseSensitive = trigger.caseSensitive === true;
          var haystack = caseSensitive ? message.content : message.content.toLowerCase();
          var needle = caseSensitive ? String(pattern) : String(pattern).toLowerCase();
          ok = Boolean(needle) && haystack.indexOf(needle) !== -1;
        }
        if (ok) {
          matched = true;
          message.indexes.forEach(function (index) { messageIndexes.add(index); });
        }
      });
      if (matched) matchedKeys.push(String(pattern));
    });
    return {
      matched: matchedKeys.length > 0,
      score: matchedKeys.length * (trigger.type === 'regex' ? 25 : 20),
      reason: trigger.type + ':' + matchedKeys.join(','),
      matchedKeys: matchedKeys,
      messageIndexes: Array.from(messageIndexes),
      scanDepth: window.depth
    };
  }

  function byId(id) {
    return entries().find(function (entry) { return entry.id === id; }) || null;
  }

  function dependencyImplementation(context) {
    (context.entry.dependencies || []).forEach(function (dependencyId) {
      var dependency = context.byId(dependencyId);
      if (!dependency) {
        context.diagnostics.push({ id: dependencyId, matched: false, reason: 'missing-dependency', parent: context.entry.id });
        return;
      }
      if (!context.runtimeEnabled(dependency)) {
        context.diagnostics.push({ id: dependencyId, matched: false, reason: 'dependency-disabled', parent: context.entry.id });
        return;
      }
      if (context.seen.has(dependencyId)) return;
      context.queue.push({
        entry: dependency,
        score: context.score,
        depth: context.depth + 1,
        reason: 'dependency:' + context.entry.id,
        matchedKeys: [],
        messageIndexes: []
      });
    });
    return context;
  }

  window.RPPlugins.attach('runtime.worldbook.recursion', {
    expandDependencies: dependencyImplementation
  });

  function retrieve(query, options) {
    var configured = window.RPTemplateData.worldbookSettings || {};
    options = Object.assign({
      history: [],
      scanDepth: toNumber(configured.scanDepth, 2),
      maxScanDepth: toNumber(configured.maxScanDepth, 0),
      charBudget: toNumber(configured.charBudget, 0),
      maxDependencyDepth: toNumber(configured.maxDependencyDepth, 3),
      selectiveLimit: 0,
      scopes: ['global', 'character'],
      random: Math.random,
      state: window.RPStorage.getCanonical()
    }, options || {});
    if (options.maxDepth !== undefined && options.maxDepth !== null) {
      options.maxScanDepth = Math.max(0, toNumber(options.maxDepth, options.maxScanDepth));
    }
    var diagnostics = [];
    var primary = [];
    var probabilityCache = new Map();
    var allEntries = entries();
    var entryMap = new Map(allEntries.map(function (entry) { return [entry.id, entry]; }));
    var disabledIds = new Set(window.RPStorage.getPreferences().worldbookDisabled || []);
    var enabledForRetrieval = function (entry) {
      return entry.enabled !== false && !disabledIds.has(entry.id);
    };
    allEntries.forEach(function (entry) {
      if (!enabledForRetrieval(entry)) return;
      if (options.scopes.indexOf(entry.scope) === -1) return;
      var result = evaluate(entry, String(query || ''), options.history, options.state, options, probabilityCache);
      diagnostics.push({
        id: entry.id,
        matched: result.matched,
        score: result.score,
        reason: result.reason,
        matchedKeys: result.matchedKeys,
        messageIndexes: result.messageIndexes,
        scanDepth: result.scanDepth
      });
      if (result.matched) {
        primary.push({
          entry: entry,
          score: result.score,
          depth: 0,
          reason: result.reason,
          matchedKeys: result.matchedKeys,
          messageIndexes: result.messageIndexes
        });
      }
    });
    primary.sort(function (a, b) {
      if (a.entry.constant && !b.entry.constant) return -1;
      if (!a.entry.constant && b.entry.constant) return 1;
      return b.score - a.score || Number(b.entry.order || 0) - Number(a.entry.order || 0);
    });
    var constants = primary.filter(function (row) { return row.entry.constant; });
    var selective = primary.filter(function (row) { return !row.entry.constant; });
    if (options.selectiveLimit > 0) selective = selective.slice(0, options.selectiveLimit);
    var queue = constants.concat(selective);
    var seen = new Set();
    var hits = [];
    var usedChars = 0;
    while (queue.length) {
      var row = queue.shift();
      if (!row.entry || seen.has(row.entry.id)) continue;
      if (!enabledForRetrieval(row.entry)) {
        diagnostics.push({ id: row.entry.id, matched: false, reason: 'disabled-before-injection' });
        continue;
      }
      if (row.depth > options.maxDependencyDepth) {
        diagnostics.push({ id: row.entry.id, matched: false, reason: 'dependency-depth-limit' });
        continue;
      }
      var block = '【' + row.entry.name + '】\n' + row.entry.content;
      if (options.charBudget > 0 && usedChars + block.length > options.charBudget) {
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
        matchedKeys: row.matchedKeys,
        messageIndexes: row.messageIndexes,
        placement: row.entry.placement,
        insertionDepth: row.entry.depth,
        scope: row.entry.scope,
        order: row.entry.order,
        chars: block.length,
        content: row.entry.content
      });
      window.RPPlugins.call('runtime.worldbook.recursion', 'expandDependencies', {
        entry: row.entry,
        score: row.score,
        depth: row.depth,
        queue: queue,
        seen: seen,
        diagnostics: diagnostics,
        byId: function (id) { return entryMap.get(id) || null; },
        runtimeEnabled: enabledForRetrieval
      });
    }
    lastResult = {
      query: String(query || ''),
      hits: hits,
      usedChars: usedChars,
      diagnostics: diagnostics,
      settings: {
        scanDepth: options.scanDepth,
        maxScanDepth: options.maxScanDepth,
        charBudget: options.charBudget,
        maxDependencyDepth: options.maxDependencyDepth
      },
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
      return Object.assign(clone(entry), { runtimeEnabled: runtimeEnabled(entry) });
    });
  }

  function toRpHub(entry) {
    entry = normalizeEntry(entry, 0);
    return {
      comment: entry.comment,
      content: entry.content,
      enabled: runtimeEnabled(entry),
      scope: entry.scope,
      keys: entry.keys.slice(),
      useRegex: entry.useRegex,
      constant: entry.constant,
      position: entry.position,
      order: entry.order,
      depth: entry.depth,
      scanDepth: entry.scanDepth,
      probability: entry.probability,
      useProbability: entry.useProbability
    };
  }

  function exportRpHub(ids) {
    var selected = Array.isArray(ids) && ids.length ? new Set(ids) : null;
    return list().filter(function (entry) {
      return !selected || selected.has(entry.id);
    }).map(toRpHub);
  }

  function importRpHub(payload) {
    var data = payload && payload.data ? payload.data : payload;
    var book = data && (data.character_book || data.characterBook);
    var input = book && Array.isArray(book.entries) ? book.entries
      : data && Array.isArray(data.entries) ? data.entries
        : Array.isArray(data) ? data : [];
    var state = window.RPStorage.getCanonical();
    var existing = new Set(entries().map(function (entry) { return entry.id; }));
    var imported = [];
    var errors = [];
    input.forEach(function (item, index) {
      if (!item || typeof item !== 'object' || !String(item.content || '').trim()) {
        errors.push('第 ' + (index + 1) + ' 项缺少有效 content');
        return;
      }
      var normalized = normalizeEntry(item, index);
      var baseId = normalized.id;
      var suffix = 2;
      while (existing.has(normalized.id)) {
        normalized.id = baseId + '-' + suffix;
        suffix += 1;
      }
      existing.add(normalized.id);
      normalized.source = 'imported';
      normalized.locked = false;
      imported.push(normalized);
    });
    if (imported.length) {
      state.knowledge.entries = state.knowledge.entries.concat(imported);
      state.knowledge.revision += 1;
      var validation = window.RPStateGuard.validate(state, window.RPTemplateData.stateSchema);
      if (!validation.ok) return { ok: false, imported: [], errors: validation.errors };
      window.RPStorage.saveCanonical(state);
      window.RPEvents.emit('worldbook:imported', { count: imported.length, revision: state.knowledge.revision });
    }
    return { ok: imported.length > 0, imported: clone(imported), errors: errors };
  }

  window.RPWorldbook = {
    list: list,
    byId: byId,
    retrieve: retrieve,
    setEnabled: setEnabled,
    normalizeEntry: normalizeEntry,
    normalizePlacement: normalizePlacement,
    importRpHub: importRpHub,
    exportRpHub: exportRpHub,
    last: function () { return clone(lastResult); }
  };
})();
