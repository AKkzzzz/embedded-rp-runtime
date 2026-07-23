(function () {
  'use strict';

  var authored = window.RPTemplateData.memory;
  var structured = authored.structured.slice();
  try {
    var saved = JSON.parse(localStorage.getItem(window.RPTemplateData.app.storagePrefix + ':structured-memory') || 'null');
    if (Array.isArray(saved)) structured = structured.concat(saved);
  } catch (_error) {}
  var vectors = authored.vectors.slice();
  var queue = [];

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
    try {
      localStorage.setItem(window.RPTemplateData.app.storagePrefix + ':structured-memory', JSON.stringify(
        structured.filter(function (item) {
          return !authored.structured.some(function (base) { return base.id === item.id; });
        })
      ));
    } catch (_error) {}
    window.RPEvents.emit('memory:structured:changed', { id: memory.id, action: 'add' });
    return { ok: true };
  }

  function enqueueEmbedding(memoryIds) {
    var caps = window.RPHost.capabilities();
    if (!caps.embeddings) return { ok: false, error: 'embedding route unavailable' };
    memoryIds.forEach(function (id) {
      if (!queue.some(function (task) { return task.memoryId === id && task.status !== 'done'; })) {
        queue.push({ id: 'embed-' + id, memoryId: id, status: 'pending', attempts: 0 });
      }
    });
    window.RPEvents.emit('memory:queue:changed', queue.slice());
    return { ok: true };
  }

  function stats() {
    return {
      structured: structured.length,
      vector: vectors.length,
      vectorCoverage: structured.length ? Math.round(vectors.length / structured.length * 100) : 0,
      queuePending: queue.filter(function (task) { return task.status === 'pending'; }).length
    };
  }

  window.RPMemory = {
    listStructured: function () { return structured.map(function (item) { return Object.assign({}, item); }); },
    listVectors: function () { return vectors.map(function (item) { return Object.assign({}, item); }); },
    searchStructured: searchStructured,
    addStructured: addStructured,
    enqueueEmbedding: enqueueEmbedding,
    searchVectors: function (query, options) {
      return window.RPVectorMemory ? window.RPVectorMemory.search(query, options) : Promise.resolve([]);
    },
    queue: function () { return queue.map(function (item) { return Object.assign({}, item); }); },
    stats: stats
  };
})();
