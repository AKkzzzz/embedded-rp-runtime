(function () {
  'use strict';

  var dbName = window.RPTemplateData.app.storagePrefix + ':vectors:v1';
  var storeName = 'vectors';
  var metaStoreName = 'meta';
  var ledgerKey = 'indexed-fingerprints';
  var queueKey = window.RPTemplateData.app.storagePrefix + ':vector-retry-queue';
  var memory = [];
  var queue = readQueue();
  var loadPromise = null;
  var dbPromise = null;
  var patrolTimer = null;
  var patrolRunning = false;
  var retryDelays = [5000, 30000, 120000, 600000, 1800000, 3600000];
  var indexedFingerprints = new Set();
  var mutationTail = Promise.resolve();
  var lastSearch = {
    status: 'idle', query: '', totalVectors: 0, excludedRecent: 0,
    eligibleVectors: 0, aboveThreshold: 0, threshold: 0.4,
    highestSimilarity: null, recalled: 0, error: '', at: ''
  };

  function recordSearch(patch) {
    lastSearch = Object.assign({}, lastSearch, patch || {}, { at: new Date().toISOString() });
    return JSON.parse(JSON.stringify(lastSearch));
  }

  function prefs() {
    var value = window.RPStorage.getPreferences().memoryModules || {};
    return Object.assign({
      vectorEnabled: false,
      autoIndex: true,
      patrolEnabled: false,
      patrolIntervalMs: 60000,
      retryEnabled: true,
      maxRetryAttempts: 6,
      vectorKeepFloors: 50,
      maxHistoryFloors: 40,
      topK: 10,
      similarityThreshold: 0.4,
      vectorRecallMaxChars: 8000,
      maxVectors: 0
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

  function normalizeFingerprintText(text) {
    return String(text || '').replace(/\s+/g, '').replace(/[，。、“”‘’：；！？,.!?;:"'`~]/g, '');
  }

  function fingerprint(text) {
    var normalized = normalizeFingerprintText(text);
    if (!normalized) return '';
    var first = 2166136261;
    var second = 2246822519;
    for (var index = 0; index < normalized.length; index += 1) {
      var code = normalized.charCodeAt(index);
      first ^= code;
      first = Math.imul(first, 16777619);
      second ^= code + index;
      second = Math.imul(second, 3266489917);
    }
    return 'v2:' + normalized.length + ':' + (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0');
  }

  function stripVectorTransport(text) {
    return String(text || '')
      .replace(/<\s*(cot|think|thinking|reasoning)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/^[\s\S]*?<\s*\/\s*(?:cot|think|thinking|reasoning)\s*>/i, '')
      .replace(/<\s*(?:cot|think|thinking|reasoning)\b[^>]*>[\s\S]*$/gi, '')
      .replace(/\[COT_END\]/gi, '')
      .replace(/<\s*active_tool_results?(?:\s[^>]*)?>[\s\S]*?<\s*\/\s*active_tool_results?\s*>/gi, '')
      .replace(/<\s*\/?\s*active_tool_results?\b[^>]*>/gi, '')
      .replace(/^\s*<\s*\/?\s*tool_[^>]*>\s*$/gmi, '')
      .replace(/\[(ENCOUNTER_PENDING|ENCOUNTER_BRIEF|ENEMY_CARD|ATTACK_RESOLUTION|STATE_UPDATE|STATE_EVENT|PARTY_EVENT|CHECK_GATE|CHECK_TOOL_RESULT|CHECK_RESOLUTION_INPUT|ATTACK_INTENT|ITEM_INTENT|BATTLE_SETTLEMENT_REQUEST|BATTLE_ENEMY_CALIBRATION_REQUEST|BATTLE_FORCE_END_REQUEST|BATTLE_END)\](?:[\s\S]*?)\[\/\1\]/gi, '')
      .replace(/^\[(?:DICE_RESULT|CHECK_RESULT|CHECK_PENDING|CHECK_CONTEXT|CHECK_EVENT_COMMIT|CHECK_REQUEST|WILL_INTENT|IMAGE_PROMPT|IMAGE_PENDING|IMAGE_ERROR|IMAGE_RENDER|TURN_START|ROUND_START|DMG_OUT|HEAL_OUT|STATUS_APPLY|BREAK_GAIN|DETECTION_STATE|STORY_EVENT|WILL_SPEND|WILL_RESTORE|INJURY_WORSEN|FIRST_AID_STOP|TEMP_HP_SET|HEALTH_MAX_SET|SECOND_LIFE_CREATE|STAY_CONSCIOUS|NATURAL_RECOVERY)[^\]]*\].*$/gmi, '')
      .replace(/\[(?:BATTLE_START|BATTLE_END)(?:\|[^\]]*)?\]/gi, '');
  }

  function clean(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/~~~[\s\S]*?~~~/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function memoryText(text) {
    var source = String(text || '');
    if (window.RPRegex && typeof window.RPRegex.cleanGalForEmbedding === 'function') {
      source = window.RPRegex.cleanGalForEmbedding(source);
    } else if (window.RPRegex && typeof window.RPRegex.stripPromptTransport === 'function') {
      source = window.RPRegex.stripPromptTransport(source);
    }
    var cleaned = clean(stripVectorTransport(source));
    if (/\[(?:ENCOUNTER_PENDING|ENCOUNTER_BRIEF|ENEMY_CARD|ATTACK_RESOLUTION|STATE_UPDATE|STATE_EVENT|PARTY_EVENT|CHECK_GATE|CHECK_TOOL_RESULT|CHECK_RESOLUTION_INPUT|ATTACK_INTENT|ITEM_INTENT|BATTLE_SETTLEMENT_REQUEST|BATTLE_ENEMY_CALIBRATION_REQUEST|BATTLE_FORCE_END_REQUEST|DICE_RESULT|CHECK_RESULT|IMAGE_PROMPT|BATTLE_START|BATTLE_END)\b/i.test(cleaned)) return '';
    return cleaned;
  }

  function serializeMutation(task) {
    var run = mutationTail.catch(function () {}).then(task);
    mutationTail = run.catch(function () {});
    return run;
  }

  function normalizeStoredItem(item) {
    if (!item || typeof item !== 'object' || !item.id ||
        !((typeof item.embeddingQ === 'string' && item.embeddingQ.length <= 2000000) || isVector(item.embedding))) return null;
    var original = clean(item.sourceText);
    var sanitized = memoryText(item.sourceText);
    if (!sanitized || sanitized !== original) return null;
    var next = Object.assign({}, item, {
      sourceText: sanitized,
      summary: sanitized.replace(/^(?:用户|角色卡)：/, '').slice(0, 900),
      fingerprint: fingerprint(sanitized)
    });
    return next.fingerprint ? prepareRuntime(next) : null;
  }

  function dedupeItems(items) {
    var seen = new Set();
    return (items || []).map(normalizeStoredItem).filter(function (item) {
      if (!item || seen.has(item.fingerprint)) return false;
      seen.add(item.fingerprint);
      return true;
    });
  }

  function normalizeQueue(tasks, storedFingerprints) {
    var seen = new Set(storedFingerprints || []);
    return (tasks || []).slice(-20).map(function (task) {
      var chunks = Array.isArray(task && task.chunks) ? task.chunks : [];
      var cleanChunks = chunks.slice(0, 32).map(function (chunk) {
        var sourceText = memoryText(chunk && chunk.sourceText);
        var original = clean(chunk && chunk.sourceText);
        if (!sourceText || sourceText !== original) return null;
        var key = fingerprint(sourceText);
        if (!key || seen.has(key)) return null;
        seen.add(key);
        return Object.assign({}, chunk, { sourceText: sourceText, fingerprint: key, summary: sourceText.replace(/^(?:用户|角色卡)：/, '').slice(0, 900) });
      }).filter(Boolean);
      return cleanChunks.length ? Object.assign({}, task, { chunks: cleanChunks }) : null;
    }).filter(Boolean);
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
    var latestError = '';
    for (var index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index] && queue[index].lastError) {
        latestError = String(queue[index].lastError);
        break;
      }
    }
    return {
      pending: queue.filter(function (task) { return task.status === 'pending'; }).length,
      failed: queue.filter(function (task) { return task.status === 'failed'; }).length,
      queueTotal: queue.length,
      lastError: latestError
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
        var request = indexedDB.open(dbName, 2);
        request.onupgradeneeded = function () {
          if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: 'id' });
          if (!request.result.objectStoreNames.contains(metaStoreName)) request.result.createObjectStore(metaStoreName);
        };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { resolve(null); };
      } catch (_error) { resolve(null); }
    });
    return dbPromise;
  }

  async function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async function () {
      var db = await openDb();
      var rawItems = [];
      var rawLedger = [];
      if (db) {
        await new Promise(function (resolve) {
          try {
            var transaction = db.transaction([storeName, metaStoreName], 'readonly');
            var request = transaction.objectStore(storeName).getAll();
            var ledgerRequest = transaction.objectStore(metaStoreName).get(ledgerKey);
            request.onsuccess = function () { rawItems = Array.isArray(request.result) ? request.result : []; };
            ledgerRequest.onsuccess = function () { rawLedger = Array.isArray(ledgerRequest.result) ? ledgerRequest.result : []; };
            transaction.oncomplete = resolve;
            transaction.onerror = resolve;
          } catch (_error) { resolve(); }
        });
      }
      memory = dedupeItems(rawItems);
      indexedFingerprints = new Set(rawLedger.map(String).filter(function (key) { return /^v2:/.test(key); }).slice(0, 20000));
      memory.forEach(function (item) { indexedFingerprints.add(item.fingerprint); });
      queue = normalizeQueue(queue, indexedFingerprints);
      if (db && (memory.length !== rawItems.length || indexedFingerprints.size !== rawLedger.length)) await save(memory);
      saveQueue();
      startPatrol();
    })();
    return loadPromise;
  }

  async function save(items) {
    memory = dedupeItems(items);
    memory.forEach(function (item) { indexedFingerprints.add(item.fingerprint); });
    var db = await openDb();
    if (!db) return;
    var persisted = memory.map(compact);
    await new Promise(function (resolve) {
      try {
        var transaction = db.transaction([storeName, metaStoreName], 'readwrite');
        var store = transaction.objectStore(storeName);
        store.clear();
        persisted.forEach(function (item) { store.put(item); });
        if (transaction.objectStoreNames && transaction.objectStoreNames.contains(metaStoreName)) {
          transaction.objectStore(metaStoreName).put(Array.from(indexedFingerprints), ledgerKey);
        }
        transaction.oncomplete = resolve;
        transaction.onerror = resolve;
      } catch (_error) { resolve(); }
    });
  }

  async function clearAllUnlocked() {
    await load();
    memory = [];
    queue = [];
    indexedFingerprints = new Set();
    saveQueue();
    var db = await openDb();
    if (!db) return true;
    await new Promise(function (resolve) {
      try {
        var transaction = db.transaction([storeName, metaStoreName], 'readwrite');
        transaction.objectStore(storeName).clear();
        if (transaction.objectStoreNames && transaction.objectStoreNames.contains(metaStoreName)) transaction.objectStore(metaStoreName).delete(ledgerKey);
        transaction.oncomplete = resolve;
        transaction.onerror = resolve;
      } catch (_error) { resolve(); }
    });
    return true;
  }

  function clearAll() {
    return serializeMutation(clearAllUnlocked);
  }

  async function exportData() {
    await load();
    await mutationTail.catch(function () {});
    return {
      version: 2,
      encoding: 'int8:maxabs:v1',
      items: memory.map(compact),
      fingerprints: Array.from(indexedFingerprints),
      retryQueue: JSON.parse(JSON.stringify(queue)),
      exportedAt: new Date().toISOString()
    };
  }

  async function importDataUnlocked(payload) {
    await load();
    var source = payload && typeof payload === 'object' ? payload : {};
    var items = Array.isArray(source.items) ? source.items : [];
    var retries = Array.isArray(source.retryQueue) ? source.retryQueue : [];
    if (items.length > 50000) throw new Error('存档中的向量条目超过安全导入上限');
    if (retries.length > 100) throw new Error('存档中的向量重试队列超过上限');
    var validItems = dedupeItems(items);
    indexedFingerprints = new Set(Number(source.version || 0) >= 2 && Array.isArray(source.fingerprints)
      ? source.fingerprints.map(String).filter(function (key) { return /^v2:/.test(key); }).slice(0, 20000)
      : []);
    validItems.forEach(function (item) { indexedFingerprints.add(item.fingerprint); });
    queue = normalizeQueue(retries, indexedFingerprints);
    await save(validItems);
    saveQueue();
    await window.RPEvents.emit('memory:vectors:changed', { action: 'import', total: memory.length, queued: queue.length });
    return { imported: memory.length, queued: queue.length };
  }

  function importData(payload) {
    return serializeMutation(function () { return importDataUnlocked(payload); });
  }

  function split(text, max) {
    var normalized = memoryText(text);
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

  function buildChunks(messages, options) {
    var existing = new Set(Array.from(indexedFingerprints));
    memory.forEach(function (item) { existing.add(item.fingerprint); });
    queue.forEach(function (task) {
      (task.chunks || []).forEach(function (chunk) { existing.add(chunk.fingerprint); });
    });
    var chunks = [];
    var turnList = completeTurns(messages);
    if (options && options.latestOnly) turnList = turnList.slice(-1);
    turnList.forEach(function (turnInfo) {
      var userText = memoryText(turnInfo.user.content);
      var assistantText = memoryText(turnInfo.assistant.content);
      var parts = split(assistantText || userText, 1200);
      parts.forEach(function (text, sequence) {
        var sourceText = [userText ? '用户：' + userText : '', assistantText ? '角色卡：' + text : '用户：' + text].filter(Boolean).join('\n');
        var key = fingerprint(sourceText);
        if (!key || existing.has(key)) return;
        existing.add(key);
        chunks.push({
          id: 'vector-' + Date.now().toString(36) + '-' + key.slice(-8) + '-' + turnInfo.turn + '-' + sequence,
          sourceText: sourceText,
          summary: text.slice(0, 900),
          fingerprint: key,
          turn: turnInfo.turn,
          sequence: sequence + 1,
          sourceUserIds: turnInfo.sourceUserIds.slice(),
          sourceAssistantIds: turnInfo.sourceAssistantIds.slice(),
          sourceAssistantText: assistantText,
          createdAt: new Date().toISOString(),
          embeddingModel: (window.RPHost.settings() || {}).embeddingModel || 'inherited'
        });
      });
    });
    return chunks;
  }

  function completeTurns(messages) {
    var merged = [];
    (messages || []).forEach(function (message, index) {
      if (!message || (message.role !== 'user' && message.role !== 'assistant')) return;
      var next = Object.assign({}, message, {
        content: String(message.content || ''),
        _sourceIndexes: [index],
        _sourceIds: message.id ? [message.id] : []
      });
      var previous = merged[merged.length - 1];
      if (previous && previous.role === next.role) {
        previous.content = [previous.content, next.content].filter(Boolean).join('\n\n');
        previous._sourceIndexes = previous._sourceIndexes.concat(next._sourceIndexes);
        previous._sourceIds = previous._sourceIds.concat(next._sourceIds);
      } else {
        merged.push(next);
      }
    });
    var turns = [];
    var pendingUser = null;
    merged.forEach(function (message) {
      if (message.role === 'user') { pendingUser = message; return; }
      if (!pendingUser) return;
      turns.push({
        turn: turns.length + 1,
        user: pendingUser,
        assistant: message,
        messages: [pendingUser, message],
        messageIndexes: pendingUser._sourceIndexes.concat(message._sourceIndexes),
        sourceUserIds: pendingUser._sourceIds.slice(),
        sourceAssistantIds: message._sourceIds.slice()
      });
      pendingUser = null;
    });
    return turns;
  }

  function indexableMessages(messages) {
    return completeTurns(messages).reduce(function (output, turn) { return output.concat(turn.messages); }, []);
  }

  function retainedTurnSet(messages, keepFloors) {
    var count = completeTurns(messages).length;
    var keep = Math.max(0, Number(keepFloors) || 0);
    var first = Math.max(1, count - keep + 1);
    var retained = new Set();
    for (var turn = first; turn <= count; turn += 1) retained.add(turn);
    return retained;
  }

  async function embedChunks(chunks, options) {
    var existing = new Set(memory.map(function (item) { return item.fingerprint; }));
    var pending = (chunks || []).filter(function (item) {
      return item && item.fingerprint && !existing.has(item.fingerprint) && !indexedFingerprints.has(item.fingerprint);
    });
    if (!pending.length) return { ok: true, added: 0, total: memory.length };
    var vectors = await window.RPModels.embed(pending.map(function (item) { return item.sourceText; }), options || {});
    var additions = pending.map(function (item, index) {
      return prepareRuntime(Object.assign({}, item, { embedding: vectors[index] }));
    });
    additions.forEach(function (item) { indexedFingerprints.add(item.fingerprint); });
    var settings = prefs();
    var limit = Math.max(0, Number(settings.maxVectors) || 0);
    var next = memory.concat(additions);
    if (limit > 0) next = next.slice(-Math.max(100, limit));
    await save(next);
    await window.RPEvents.emit('memory:vectors:changed', { added: additions.length, total: next.length });
    return { ok: true, added: additions.length, total: next.length };
  }

  async function indexMessagesUnlocked(messages, options) {
    options = options || {};
    await load();
    var settings = prefs();
    if (!settings.vectorEnabled || settings.autoIndex === false) return { ok: false, skipped: true, added: 0 };
    var floors = completeTurns(messages).length;
    var chunks = buildChunks(messages, options);
    if (!chunks.length) {
      return {
        ok: true,
        added: 0,
        total: memory.length,
        conversationFloors: floors,
        indexFromFloor: 0,
        indexedFloors: floors,
        waitingForFloors: floors ? 0 : 1
      };
    }
    try {
      return await embedChunks(chunks, options);
    } catch (error) {
      if (options.queueOnError !== false && settings.retryEnabled !== false) enqueue(chunks, error);
      await window.RPEvents.emit('memory:vector:error', { message: String(error.message || error), queued: chunks.length });
      return { ok: false, queued: chunks.length, error: String(error.message || error), added: 0 };
    }
  }

  function indexMessages(messages, options) {
    return serializeMutation(function () { return indexMessagesUnlocked(messages, options); });
  }

  function indexLatest(messages, options) {
    return serializeMutation(function () {
      return indexMessagesUnlocked(messages, Object.assign({}, options || {}, { latestOnly: true }));
    });
  }

  function normalizedText(value) {
    return String(value || '').replace(/\s+/g, '').trim();
  }

  async function reconcileToMessagesUnlocked(messages, removal) {
    await load();
    var liveTurns = completeTurns(messages || []);
    var liveIds = new Set(liveTurns.flatMap(function (turn) { return turn.sourceAssistantIds; }));
    var targetedIds = new Set(Array.isArray(removal && removal.assistantIds) ? removal.assistantIds : []);
    var targetedTurns = new Set(Array.isArray(removal && removal.assistantTurns)
      ? removal.assistantTurns.map(Number).filter(Boolean)
      : []);
    var targeted = targetedIds.size > 0 || targetedTurns.size > 0;
    function keep(item) {
      var sourceIds = Array.isArray(item && item.sourceAssistantIds) ? item.sourceAssistantIds : [];
      if (targeted) {
        if (sourceIds.length) return !sourceIds.some(function (id) { return targetedIds.has(id); });
        return !targetedTurns.has(Number(item && item.turn || 0));
      }
      if (sourceIds.length) return sourceIds.every(function (id) { return liveIds.has(id); });
      var turnNumber = Number(item && item.turn || 0);
      if (!turnNumber || turnNumber > liveTurns.length) return false;
      if (!item.sourceAssistantText) return true;
      return normalizedText(item.sourceAssistantText) === normalizedText(memoryText(liveTurns[turnNumber - 1].assistant.content));
    }
    var before = memory.length;
    var queuedBefore = queue.reduce(function (sum, task) { return sum + (task.chunks || []).length; }, 0);
    memory = memory.filter(keep);
    queue = queue.map(function (task) {
      return Object.assign({}, task, { chunks: (task.chunks || []).filter(keep) });
    }).filter(function (task) { return task.chunks.length; });
    indexedFingerprints = new Set(memory.concat(queue.flatMap(function (task) { return task.chunks || []; }))
      .map(function (item) { return item.fingerprint; }).filter(Boolean));
    await save(memory);
    saveQueue();
    var removed = before - memory.length;
    var queuedRemoved = queuedBefore - queue.reduce(function (sum, task) { return sum + (task.chunks || []).length; }, 0);
    if (removed || queuedRemoved) {
      await window.RPEvents.emit('memory:vectors:changed', {
        action: 'branch-prune', removed: removed, queuedRemoved: queuedRemoved, total: memory.length
      });
    }
    return { ok: true, removed: removed, queuedRemoved: queuedRemoved, total: memory.length };
  }

  function reconcileToMessages(messages, removal) {
    return serializeMutation(function () { return reconcileToMessagesUnlocked(messages, removal); });
  }

  async function processQueueUnlocked(force) {
    await load();
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

  function processQueue(force) {
    return serializeMutation(function () { return processQueueUnlocked(force); });
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
    var threshold = Number(settings.similarityThreshold);
    if (!Number.isFinite(threshold)) threshold = 0.4;
    var baseSearch = {
      query: String(query || '').slice(0, 240), totalVectors: memory.length,
      excludedRecent: 0, eligibleVectors: 0, aboveThreshold: 0,
      threshold: threshold, highestSimilarity: null, recalled: 0, error: ''
    };
    if (!settings.vectorEnabled) { recordSearch(Object.assign(baseSearch, { status: 'disabled' })); return []; }
    if (!memory.length) { recordSearch(Object.assign(baseSearch, { status: 'empty-index' })); return []; }
    var cleanQuery = memoryText(query).slice(0, 800);
    if (!cleanQuery) { recordSearch(Object.assign(baseSearch, { status: 'query-empty' })); return []; }
    var vectors;
    try {
      vectors = await window.RPModels.embed(['当前问题：用户：' + cleanQuery], options || {});
    } catch (error) {
      recordSearch(Object.assign(baseSearch, { status: 'embedding-error', error: String(error.message || error) }));
      await window.RPEvents.emit('memory:vector:error', { message: String(error.message || error) });
      return [];
    }
    var queryVector = vectors[0];
    var terms = cleanQuery.toLowerCase().split(/\s+/).filter(Boolean);
    var messages = window.RPConversation && window.RPConversation.list ? window.RPConversation.list() : [];
    var retained = retainedTurnSet(messages, settings.vectorKeepFloors || settings.maxHistoryFloors);
    var excludedRecent = 0;
    var eligibleVectors = 0;
    var highestSimilarity = -1;
    var scored = memory.filter(function (item) {
      if (retained.has(Number(item.turn || 0))) { excludedRecent += 1; return false; }
      eligibleVectors += 1;
      return true;
    }).map(function (item) {
      var rawScore = cosine(queryVector, item.embedding);
      if (Number.isFinite(rawScore)) highestSimilarity = Math.max(highestSimilarity, rawScore);
      var hits = terms.filter(function (term) { return item.sourceText.toLowerCase().includes(term); });
      return { item: item, rawScore: rawScore, score: rawScore + Math.min(0.08, hits.length * 0.015) };
    }).filter(function (entry) { return entry.rawScore >= threshold; });
    var selected = scored
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, Math.max(1, Number(settings.topK) || 10))
      .map(function (entry) { return Object.assign(publicItem(entry.item), { retrievalScore: entry.score }); });
    recordSearch(Object.assign(baseSearch, {
      status: selected.length ? 'recalled' : (eligibleVectors ? 'below-threshold' : 'no-eligible-memory'),
      excludedRecent: excludedRecent,
      eligibleVectors: eligibleVectors,
      aboveThreshold: scored.length,
      highestSimilarity: highestSimilarity >= -0.999 ? highestSimilarity : null,
      recalled: selected.length
    }));
    return selected;
  }

  window.RPVectorMemory = {
    init: load,
    indexMessages: indexMessages,
    indexLatest: indexLatest,
    search: search,
    patrol: patrol,
    restartPatrol: function () { startPatrol(true); },
    retryQueue: function () { return processQueue(true); },
    clearAll: clearAll,
    reconcileToMessages: reconcileToMessages,
    exportData: exportData,
    importData: importData,
    list: function () { return memory.map(publicItem); },
    queue: function () { return JSON.parse(JSON.stringify(queue)); },
    stats: function () {
      var messages = window.RPConversation && window.RPConversation.list ? window.RPConversation.list() : [];
      var floors = completeTurns(messages).length;
      var keep = Math.max(0, Number(prefs().vectorKeepFloors || prefs().maxHistoryFloors) || 0);
      var indexedTurns = new Set(memory.map(function (item) { return Number(item.turn || 0); }).filter(Boolean));
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
        patrolRunning: patrolRunning,
        conversationFloors: floors,
        indexFromFloor: 0,
        indexedFloors: indexedTurns.size,
        recallExcludedFloors: Math.min(floors, keep),
        recallEligibleFloors: Math.max(0, floors - keep),
        waitingForFloors: floors ? 0 : 1,
        embeddingModel: (window.RPHost.settings() || {}).embeddingModel || ''
      }, queueStats());
    },
    indexableMessages: indexableMessages,
    completeTurns: completeTurns,
    retainedTurnSet: retainedTurnSet,
    memoryText: memoryText,
    cleanEmbeddingText: memoryText,
    lastSearch: function () { return JSON.parse(JSON.stringify(lastSearch)); },
    fingerprint: fingerprint,
    quantize: quantize,
    decode: base64ToInt8,
    cosine: cosine
  };
})();
