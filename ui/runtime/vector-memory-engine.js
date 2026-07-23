(function () {
  'use strict';

  var dbName = 'nanami_embedded_rp_vectors_v1';
  var storeName = 'vectors';
  var memory = [];
  var initialized = false;
  var dbPromise = null;

  function prefs() {
    var value = window.RPStorage.getPreferences().memoryModules || {};
    return Object.assign({
      vectorEnabled: false,
      autoIndex: true,
      maxHistoryFloors: 40,
      topK: 10,
      similarityThreshold: 0.5,
      maxVectors: 2000
    }, value);
  }

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

  function cosine(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return -1;
    var length = Math.min(a.length, b.length);
    var dot = 0; var normA = 0; var normB = 0;
    for (var i = 0; i < length; i += 1) {
      var x = Number(a[i]) || 0; var y = Number(b[i]) || 0;
      dot += x * y; normA += x * x; normB += y * y;
    }
    return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : -1;
  }

  function fingerprint(text) {
    return String(text || '').replace(/\s+/g, '').replace(/[，。、“”‘’：；！？,.!?;:"'`~]/g, '').slice(0, 1000);
  }

  function clean(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    dbPromise = new Promise(function (resolve) {
      try {
        var request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = function () {
          if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: 'id' });
        };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { resolve(null); };
      } catch (_error) { resolve(null); }
    });
    return dbPromise;
  }

  async function load() {
    if (initialized) return;
    initialized = true;
    var db = await openDb();
    if (!db) return;
    await new Promise(function (resolve) {
      try {
        var request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        request.onsuccess = function () { memory = Array.isArray(request.result) ? request.result : []; resolve(); };
        request.onerror = function () { resolve(); };
      } catch (_error) { resolve(); }
    });
  }

  async function save(items) {
    memory = items.slice();
    var db = await openDb();
    if (!db) return;
    await new Promise(function (resolve) {
      try {
        var transaction = db.transaction(storeName, 'readwrite');
        var store = transaction.objectStore(storeName);
        store.clear();
        memory.forEach(function (item) { store.put(item); });
        transaction.oncomplete = resolve;
        transaction.onerror = resolve;
      } catch (_error) { resolve(); }
    });
  }

  function split(text, max) {
    var normalized = clean(text);
    if (!normalized) return [];
    var paragraphs = normalized.split(/\n\s*\n/g).filter(Boolean);
    var output = [];
    paragraphs.forEach(function (paragraph) {
      var remaining = paragraph.trim();
      while (remaining.length > max) {
        var cut = Math.max(remaining.lastIndexOf('。', max), remaining.lastIndexOf('\n', max));
        if (cut < Math.floor(max * 0.55)) cut = max;
        output.push(remaining.slice(0, cut + 1).trim());
        remaining = remaining.slice(cut + 1).trim();
      }
      if (remaining) output.push(remaining);
    });
    return output;
  }

  async function indexMessages(messages, options) {
    await load();
    var settings = prefs();
    if (!settings.vectorEnabled || settings.autoIndex === false) return { ok: false, skipped: true, added: 0 };
    var existing = new Set(memory.map(function (item) { return item.fingerprint; }));
    var chunks = [];
    (messages || []).forEach(function (message, index) {
      if (!message || !['user', 'assistant'].includes(message.role)) return;
      split(message.content, 1200).forEach(function (text, sequence) {
        var sourceText = (message.role === 'user' ? '用户：' : '角色卡：') + text;
        var key = fingerprint(sourceText);
        if (!key || existing.has(key)) return;
        existing.add(key);
        chunks.push({
          id: 'vector-' + Date.now().toString(36) + '-' + index + '-' + sequence,
          sourceText: sourceText,
          summary: text.slice(0, 900),
          fingerprint: key,
          turn: Math.floor(index / 2) + 1,
          sequence: sequence + 1,
          createdAt: new Date().toISOString(),
          embeddingModel: (window.RPHost.settings() || {}).embeddingModel || 'inherited',
          embedding: null
        });
      });
    });
    if (!chunks.length) return { ok: true, added: 0 };
    var vectors = await window.RPModels.embed(chunks.map(function (item) { return item.sourceText; }), options || {});
    chunks.forEach(function (item, index) { item.embedding = vectors[index]; });
    var next = memory.concat(chunks).slice(-Math.max(100, Number(settings.maxVectors) || 2000));
    await save(next);
    await window.RPEvents.emit('memory:vectors:changed', { added: chunks.length, total: next.length });
    return { ok: true, added: chunks.length, total: next.length };
  }

  async function search(query, options) {
    await load();
    var settings = prefs();
    if (!settings.vectorEnabled || !memory.length) return [];
    var vectors;
    try {
      vectors = await window.RPModels.embed([String(query || '')], options || {});
    } catch (error) {
      await window.RPEvents.emit('memory:vector:error', { message: String(error.message || error) });
      return [];
    }
    var queryVector = vectors[0];
    var terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    return memory.map(function (item) {
      var score = cosine(queryVector, item.embedding);
      var hits = terms.filter(function (term) { return item.sourceText.toLowerCase().includes(term); });
      return { item: item, score: score + Math.min(0.08, hits.length * 0.015) };
    }).filter(function (entry) { return entry.score >= Number(settings.similarityThreshold || 0.5); })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, Math.max(1, Number(settings.topK) || 10))
      .map(function (entry) { return Object.assign({}, clone(entry.item), { retrievalScore: entry.score }); });
  }

  window.RPVectorMemory = {
    init: load,
    indexMessages: indexMessages,
    search: search,
    list: function () { return clone(memory); },
    stats: function () { return { total: memory.length, enabled: Boolean(prefs().vectorEnabled) }; },
    cosine: cosine
  };
})();
