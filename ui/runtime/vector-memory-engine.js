(function () {
  'use strict';

  var dbName = 'nanami_embedded_rp_vectors_v1';
  var storeName = 'vectors';
  var queueKey = window.RPTemplateData.app.storagePrefix + ':vector-retry-queue';
  var memory = [];
  var queue = readQueue();
  var initialized = false;
  var dbPromise = null;
  var patrolTimer = null;
  var patrolRunning = false;
  var retryDelays = [5000, 30000, 120000, 600000, 1800000, 3600000];

  function prefs() {
    var value = window.RPStorage.getPreferences().memoryModules || {};
    return Object.assign({
      vectorEnabled: false,
      autoIndex: true,
      patrolEnabled: true,
      patrolIntervalMs: 60000,
      retryEnabled: true,
      maxRetryAttempts: 6,
      maxHistoryFloors: 40,
      topK: 10,
      similarityThreshold: 0.5,
      maxVectors: 2000
    }, value);
  }

  function isVector(value) {
    return Array.isArray(value) || ArrayBuffer.isView(value);
  }

  function bytesToBase64(bytes) {
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var output = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var a = bytes[i];
      var b = i + 1 < bytes.length ? bytes[i + 1] : 0;
      var c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      var triple = (a << 16) | (b << 8) | c;
      output += alphabet[(triple >> 18) & 63] + alphabet[(triple >> 12) & 63] +
        (i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : '=') +
        (i + 2 < bytes.length ? alphabet[triple & 63] : '=');
    }
    return output;
  }

  function base64ToInt8(value) {
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var cleanValue = String(value || '').replace(/[^A-Za-z0-9+/=]/g, '');
    var output = [];
    for (var i = 0; i < cleanValue.length; i += 4) {
      var a = alphabet.indexOf(cleanValue[i]);
      var b = alphabet.indexOf(cleanValue[i + 1]);
      var c = cleanValue[i + 2] === '=' ? -1 : alphabet.indexOf(cleanValue[i + 2]);
      var d = cleanValue[i + 3] === '=' ? -1 : alphabet.indexOf(cleanValue[i + 3]);
      output.push((a << 2) | (b >> 4));
      if (c >= 0) output.push(((b & 15) << 4) | (c >> 2));
      if (d >= 0) output.push(((c & 3) << 6) | d);
    }
    return new Int8Array(new Uint8Array(output).buffer);
  }

  function quantize(embedding) {
    if (!isVector(embedding) || !embedding.length) return null;
    var maxAbs = 0;
    for (var i = 0; i < embedding.length; i += 1) {
      maxAbs = Math.max(maxAbs, Math.abs(Number(embedding[i]) || 0));
    }
    if (!maxAbs) return null;
    var packed = new Int8Array(embedding.length);
    for (var j = 0; j < embedding.length; j += 1) {
      packed[j] = Math.max(-127, Math.min(127, Math.round(((Number(embedding[j]) || 0) / maxAbs) * 127)));
    }
    return {
      embeddingQ: bytesToBase64(new Uint8Array(packed.buffer)),
      embeddingScale: maxAbs / 127,
      embeddingDims: embedding.length,
      embeddingEncoding: 'int8:maxabs:v1'
    };
  }

  function prepareRuntime(item) {
    var next = Object.assign({}, item);
    if (typeof next.embeddingQ === 'string' && next.embeddingQ) {
      try { next.embedding = base64ToInt8(next.embeddingQ); } catch (_error) { next.embedding = []; }
    } else if (isVector(next.embedding)) {
      var packed = quantize(next.embedding);
      if (packed) {
        Object.assign(next, packed);
        next.embedding = base64ToInt8(packed.embeddingQ);
      }
    }
    return next;
  }

  function compact(item) {
    var next = Object.assign({}, item);
    var packed = next.embeddingQ ? null : quantize(next.embedding);
    delete next.embedding;
    if (packed) Object.assign(next, packed);
    return next;
  }

  function publicItem(item) {
    var next = Object.assign({}, item);
    delete next.embedding;
    return next;
  }

  function cosine(a, b) {
    if (!isVector(a) || !isVector(b) || !a.length || !b.length) return -1;
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

  function readQueue() {
    try {
      var value = JSON.parse(localStorage.getItem(queueKey) || '[]');
      return Array.isArray(value) ? value.slice(-20) : [];
    } catch (_error) {
      return [];
    }
  }

  function saveQueue() {
    try { localStorage.setItem(queueKey, JSON.stringify(queue.slice(-20))); } catch (_error) {}
    window.RPEvents.emit('memory:vector:queue', queueStats());
  }

  function queueStats() {
    return {
      pending: queue.filter(function (task) { return task.status === 'pending'; }).length,
      failed: queue.filter(function (task) { return task.status === 'failed'; }).length,
      total: queue.length
    };
  }

  function enqueue(chunks, error) {
    var fingerprints = new Set(queue.flatMap(function (task) {
      return (task.chunks || []).map(function (chunk) { return chunk.fingerprint; });
    }));
    var missing = (chunks || []).filter(function (chunk) { return !fingerprints.has(chunk.fingerprint); }).slice(0, 32);
    if (!missing.length) return;
    queue.push({
      id: 'vector-task-' + Date.now().toString(36),
      chunks: missing.map(function (chunk) {
        var next = Object.assign({}, chunk);
        delete next.embedding;
        return next;
      }),
      attempts: 0,
      status: 'pending',
      nextAttemptAt: Date.now() + retryDelays[0],
      lastError: String(error && error.message || error || ''),
      createdAt: new Date().toISOString()
    });
    queue = queue.slice(-20);
    saveQueue();
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
    if (db) {
      await new Promise(function (resolve) {
        try {
          var request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
          request.onsuccess = function () {
            memory = (Array.isArray(request.result) ? request.result : []).map(prepareRuntime);
            resolve();
          };
          request.onerror = function () { resolve(); };
        } catch (_error) { resolve(); }
      });
    }
    startPatrol();
  }

  async function save(items) {
    memory = items.map(prepareRuntime);
    var db = await openDb();
    if (!db) return;
    var persisted = memory.map(compact);
    await new Promise(function (resolve) {
      try {
        var transaction = db.transaction(storeName, 'readwrite');
        var store = transaction.objectStore(storeName);
        store.clear();
        persisted.forEach(function (item) { store.put(item); });
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

  function buildChunks(messages) {
    var existing = new Set(memory.map(function (item) { return item.fingerprint; }));
    queue.forEach(function (task) {
      (task.chunks || []).forEach(function (chunk) { existing.add(chunk.fingerprint); });
    });
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
          embeddingModel: (window.RPHost.settings() || {}).embeddingModel || 'inherited'
        });
      });
    });
    return chunks;
  }

  async function embedChunks(chunks, options) {
    if (!chunks.length) return { ok: true, added: 0, total: memory.length };
    var vectors = await window.RPModels.embed(chunks.map(function (item) { return item.sourceText; }), options || {});
    var additions = chunks.map(function (item, index) {
      return prepareRuntime(Object.assign({}, item, { embedding: vectors[index] }));
    });
    var settings = prefs();
    var next = memory.concat(additions).slice(-Math.max(100, Number(settings.maxVectors) || 2000));
    await save(next);
    await window.RPEvents.emit('memory:vectors:changed', { added: additions.length, total: next.length });
    return { ok: true, added: additions.length, total: next.length };
  }

  async function indexMessages(messages, options) {
    options = options || {};
    await load();
    var settings = prefs();
    if (!settings.vectorEnabled || settings.autoIndex === false) return { ok: false, skipped: true, added: 0 };
    var chunks = buildChunks(messages);
    if (!chunks.length) return { ok: true, added: 0, total: memory.length };
    try {
      return await embedChunks(chunks, options);
    } catch (error) {
      if (options.queueOnError !== false && settings.retryEnabled !== false) enqueue(chunks, error);
      await window.RPEvents.emit('memory:vector:error', { message: String(error.message || error), queued: chunks.length });
      return { ok: false, queued: chunks.length, error: String(error.message || error), added: 0 };
    }
  }

  async function processQueue(force) {
    if (!prefs().retryEnabled || !queue.length) return queueStats();
    var now = Date.now();
    var maxAttempts = Math.max(1, Number(prefs().maxRetryAttempts) || 6);
    for (var i = 0; i < queue.length; i += 1) {
      var task = queue[i];
      if (task.status === 'failed' && !force) continue;
      if (!force && Number(task.nextAttemptAt || 0) > now) continue;
      try {
        await embedChunks(task.chunks || [], { queueOnError: false });
        queue.splice(i, 1);
        i -= 1;
      } catch (error) {
        task.attempts = Number(task.attempts || 0) + 1;
        task.lastError = String(error.message || error);
        task.status = task.attempts >= maxAttempts ? 'failed' : 'pending';
        task.nextAttemptAt = Date.now() + retryDelays[Math.min(task.attempts, retryDelays.length - 1)];
      }
      saveQueue();
    }
    return queueStats();
  }

  async function patrol(force) {
    if (patrolRunning || !prefs().vectorEnabled || prefs().patrolEnabled === false) return { skipped: true };
    patrolRunning = true;
    try {
      await processQueue(Boolean(force));
      if (window.RPConversation && !window.RPConversation.isGenerating()) {
        await indexMessages(window.RPConversation.list(), { queueOnError: true });
      }
      return { ok: true, queue: queueStats() };
    } finally {
      patrolRunning = false;
    }
  }

  function startPatrol(force) {
    if (force && patrolTimer && typeof clearInterval === 'function') {
      clearInterval(patrolTimer);
      patrolTimer = null;
    }
    if (patrolTimer || typeof setInterval !== 'function') return;
    var interval = Math.max(15000, Number(prefs().patrolIntervalMs) || 60000);
    patrolTimer = setInterval(function () { patrol(false); }, interval);
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
      .map(function (entry) { return Object.assign(publicItem(entry.item), { retrievalScore: entry.score }); });
  }

  window.RPVectorMemory = {
    init: load,
    indexMessages: indexMessages,
    search: search,
    patrol: patrol,
    restartPatrol: function () { startPatrol(true); },
    retryQueue: function () { return processQueue(true); },
    list: function () { return memory.map(publicItem); },
    queue: function () { return JSON.parse(JSON.stringify(queue)); },
    stats: function () {
      var dims = memory.reduce(function (sum, item) { return sum + Number(item.embeddingDims || item.embedding && item.embedding.length || 0); }, 0);
      var packedBytes = memory.reduce(function (sum, item) {
        return sum + (typeof item.embeddingQ === 'string' ? Math.ceil(item.embeddingQ.length * 0.75) : Number(item.embedding && item.embedding.byteLength || 0));
      }, 0);
      return Object.assign({
        total: memory.length,
        enabled: Boolean(prefs().vectorEnabled),
        encoding: 'int8:maxabs:v1',
        estimatedBytes: packedBytes,
        float32EquivalentBytes: dims * 4,
        patrolRunning: patrolRunning
      }, queueStats());
    },
    quantize: quantize,
    decode: base64ToInt8,
    cosine: cosine
  };
})();
