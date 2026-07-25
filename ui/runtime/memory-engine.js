(function () {
  'use strict';

  var authored = window.RPTemplateData.memory;
  var prefix = window.RPTemplateData.app.storagePrefix;
  var legacyKey = prefix + ':structured-memory';
  var dbName = prefix + ':structured-memory:v1';
  var dbPromise = null;
  var readyPromise = null;
  var writeQueue = Promise.resolve();
  var legacy = readLegacy();
  var structured = mergeEntries(authored.structured.slice(), legacy);
  var vectors = authored.vectors.slice();
  var queue = [];

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function readLegacy() {
    try {
      var saved = JSON.parse(localStorage.getItem(legacyKey) || 'null');
      return Array.isArray(saved) ? saved : [];
    } catch (_error) {
      return [];
    }
  }

  function mergeEntries() {
    var output = [];
    var seen = new Set();
    Array.prototype.slice.call(arguments).forEach(function (rows) {
      (Array.isArray(rows) ? rows : []).forEach(function (row) {
        if (!row || !row.id || seen.has(row.id)) return;
        seen.add(row.id);
        output.push(Object.assign({}, row));
      });
    });
    return output;
  }

  function customEntries() {
    var authoredIds = new Set(authored.structured.map(function (item) { return item.id; }));
    return structured.filter(function (item) { return !authoredIds.has(item.id); }).map(clone);
  }

  function openDb() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains('memory')) db.createObjectStore('memory');
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('structured memory database unavailable')); };
    });
    return dbPromise;
  }

  async function readStored() {
    var db = await openDb();
    if (!db) return [];
    return new Promise(function (resolve, reject) {
      var request = db.transaction('memory', 'readonly').objectStore('memory').get('structured');
      request.onsuccess = function () { resolve(Array.isArray(request.result) ? request.result : []); };
      request.onerror = function () { reject(request.error || new Error('structured memory read failed')); };
    });
  }

  async function writeStored(rows) {
    var db = await openDb();
    if (!db) {
      localStorage.setItem(legacyKey, JSON.stringify(rows));
      return;
    }
    await new Promise(function (resolve, reject) {
      var request = db.transaction('memory', 'readwrite').objectStore('memory').put(rows, 'structured');
      request.onsuccess = function () { resolve(); };
      request.onerror = function () { reject(request.error || new Error('structured memory write failed')); };
    });
  }

  function schedulePersist() {
    var snapshot = customEntries();
    writeQueue = writeQueue.then(function () {
      return writeStored(snapshot).then(function () {
        if (typeof indexedDB !== 'undefined') {
          try { localStorage.removeItem(legacyKey); } catch (_error) {}
        }
      });
    }).catch(function () {
      try { localStorage.setItem(legacyKey, JSON.stringify(snapshot)); } catch (_error) {}
    });
    return writeQueue;
  }

  function init() {
    if (readyPromise) return readyPromise;
    readyPromise = readStored().then(function (saved) {
      structured = mergeEntries(authored.structured, saved, legacy);
      if (legacy.length) return schedulePersist();
      return null;
    }).then(function () {
      window.RPEvents.emit('memory:structured:changed', { action: 'loaded', total: structured.length });
      return stats();
    }).catch(function () {
      structured = mergeEntries(authored.structured, legacy);
      return stats();
    });
    return readyPromise;
  }

  function tokenize(text) {
    var normalized = String(text || '').toLowerCase();
    var latin = normalized.match(/[a-z0-9_]{2,}/g) || [];
    var cjk = normalized.match(/[\u3400-\u9fff]{2,6}/g) || [];
    return Array.from(new Set(latin.concat(cjk)));
  }

  function lexicalScore(query, memory) {
    var terms = tokenize(query);
    var text = [memory.title, memory.summary, (memory.tags || []).join(' ')].join(' ').toLowerCase();
    var hits = terms.filter(function (term) { return text.indexOf(term) !== -1; });
    return { score: terms.length ? hits.length / terms.length : 0, hits: hits };
  }

  function searchStructured(query, options) {
    options = Object.assign({ topK: 8 }, options || {});
    return structured
      .filter(function (memory) { return memory.stale !== true; })
      .map(function (memory) {
        var scored = lexicalScore(query, memory);
        return Object.assign({}, memory, { retrievalScore: scored.score, matchedTerms: scored.hits });
      })
      .filter(function (memory) { return memory.retrievalScore > 0; })
      .sort(function (a, b) { return b.retrievalScore - a.retrievalScore; })
      .slice(0, options.topK);
  }

  function addStructured(memory) {
    if (!memory || !memory.id || structured.some(function (item) { return item.id === memory.id; })) {
      return { ok: false, error: 'memory id missing or duplicated' };
    }
    structured.push(Object.assign({
      kind: 'fact',
      sourceIds: [],
      createdAt: new Date().toISOString(),
      stale: false
    }, memory));
    schedulePersist();
    window.RPEvents.emit('memory:structured:changed', { id: memory.id, action: 'add' });
    return { ok: true };
  }

  function removeStructured(predicate) {
    if (typeof predicate !== 'function') return 0;
    var before = structured.length;
    structured = structured.filter(function (item) {
      return authored.structured.some(function (base) { return base.id === item.id; }) || !predicate(item);
    });
    var removed = before - structured.length;
    if (removed) {
      schedulePersist();
      window.RPEvents.emit('memory:structured:changed', { action: 'remove', removed: removed });
    }
    return removed;
  }

  function enqueueEmbedding(memoryIds) {
    var caps = window.RPHost.capabilities();
    if (!caps.embeddings) return { ok: false, error: 'embedding route unavailable' };
    memoryIds.forEach(function (id) {
      if (!queue.some(function (task) { return task.memoryId === id && task.status !== 'done'; })) {
        queue.push({ id: 'embed-' + id, memoryId: id, status: 'pending', attempts: 0 });
      }
    });
    queue = queue.slice(-100);
    window.RPEvents.emit('memory:queue:changed', queue.slice());
    return { ok: true };
  }

  function stats() {
    return {
      structured: structured.length,
      classic: structured.filter(function (item) { return item.classicMemory === true || item.kind === 'classicMemory'; }).length,
      vector: vectors.length,
      vectorCoverage: structured.length ? Math.round(vectors.length / structured.length * 100) : 0,
      queuePending: queue.filter(function (task) { return task.status === 'pending'; }).length,
      storage: typeof indexedDB === 'undefined' ? 'localStorage-fallback' : 'indexedDB'
    };
  }

  function reset() {
    structured = authored.structured.slice();
    vectors = authored.vectors.slice();
    queue = [];
    try { localStorage.removeItem(legacyKey); } catch (_error) {}
    schedulePersist();
    window.RPEvents.emit('memory:structured:changed', { action: 'reset' });
    return true;
  }

  window.RPMemory = {
    init: init,
    flush: function () { return writeQueue; },
    listStructured: function () { return structured.map(function (item) { return Object.assign({}, item); }); },
    listVectors: function () { return vectors.map(function (item) { return Object.assign({}, item); }); },
    searchStructured: searchStructured,
    addStructured: addStructured,
    removeStructured: removeStructured,
    enqueueEmbedding: enqueueEmbedding,
    searchVectors: function (query, options) {
      return window.RPVectorMemory ? window.RPVectorMemory.search(query, options) : Promise.resolve([]);
    },
    queue: function () { return queue.map(function (item) { return Object.assign({}, item); }); },
    stats: stats,
    reset: reset
  };
})();
