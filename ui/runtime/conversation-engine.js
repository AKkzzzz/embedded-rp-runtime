(function () {
  'use strict';

  var active = null;
  var sequence = 0;
  var stateSyncPending = Promise.resolve();
  var generationEpoch = 0;
  var lastNarrativeTrace = null;
  var lastFailedGeneration = null;
  var storagePrefix = window.RPTemplateData.app.storagePrefix;
  var conversationDbName = storagePrefix + ':conversation:v1';
  var conversationDbPromise = null;
  var conversationReady = null;
  var conversationWriteQueue = Promise.resolve();
  var initialConversation = window.RPStorage.getCanonical().conversation || { revision: 1, messages: [], status: 'idle' };
  var committedMessages = clone(initialConversation.messages || []);
  var committedRevision = Number(initialConversation.revision || 1);

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function now() {
    return new Date().toISOString();
  }

  function id(role) {
    sequence += 1;
    return role + '-' + Date.now().toString(36) + '-' + sequence.toString(36);
  }

  function markerField(value) {
    return String(value == null ? '' : value).replace(/[|\]\r\n]/g, ' ').trim();
  }

  function diceMarker(result) {
    var data = result && result.data;
    if (!data || !Array.isArray(data.rolls)) return '';
    return '[DICE_RESULT|' + [
      markerField(data.kind || 'ordinary'),
      markerField(data.expression || ''),
      markerField(data.rolls.join(',')),
      markerField(data.kind === 'success-pool' ? data.successes : data.total),
      markerField(data.exploded || 0),
      markerField(data.dice || data.rolls.length)
    ].join('|') + ']';
  }

  function stripInternalTransport(content) {
    return String(content || '')
      .replace(/<\s*active_tool_results(?:\s[^>]*)?>[\s\S]*?<\s*\/\s*active_tool_results\s*>/gi, '')
      .replace(/<\s*cot(?:\s[^>]*)?>[\s\S]*?<\s*\/\s*cot\s*>/gi, '')
      .replace(/<\s*\/?\s*(?:active_tool_results?|cot)\b[^>]*>/gi, '')
      .replace(/<\s*tool_[a-z0-9_]+\s*:[\s\S]*?>/gi, '')
      .trim();
  }

  function extractImageRequest(content) {
    var request = null;
    var cleaned = String(content || '').replace(/\[IMAGE_PROMPT\|([^|\]]+)\|([^\]]+)\]/gi, function (_all, id, prompt) {
      if (!request) {
        request = {
          id: markerField(id),
          prompt: String(prompt || '').trim()
        };
      }
      return '';
    });
    return { content: cleaned.trim(), request: request && request.id && request.prompt ? request : null };
  }

  function requestSceneImage(request) {
    if (!request || !window.RPImageGen || !window.RPPlugins ||
      typeof window.RPPlugins.isEnabled !== 'function' || !window.RPPlugins.isEnabled('runtime.image-generation')) return;
    if (window.RPImageGen.get && window.RPImageGen.get(request.id)) return;
    // RPImageGen owns the request/generating/error event chain. Keep this
    // detached so image failures never fail the narrative response itself.
    window.RPImageGen.generate(request.prompt, { id: request.id, count: 1 }).catch(function () {});
  }

  function stateSnapshot() {
    var state = window.RPStorage.getCanonical();
    delete state.conversation;
    return state;
  }

  function saveActionCheckpoint(messageId) {
    if (!window.RPStorage.saveActionCheckpoint) return;
    window.RPStorage.saveActionCheckpoint({
      messageId: String(messageId || ''),
      state: stateSnapshot(),
      savedAt: now()
    });
  }

  function restoreActionCheckpoint(message) {
    if (!message || !window.RPStorage.getActionCheckpoint) return false;
    var checkpoint = window.RPStorage.getActionCheckpoint();
    if (!checkpoint || checkpoint.messageId !== message.id || !checkpoint.state) return false;
    var current = window.RPStorage.getCanonical();
    var restored = clone(checkpoint.state);
    restored.conversation = current.conversation;
    window.RPStorage.saveCanonical(restored);
    return true;
  }

  function branchRemoval(priorMessages, retainedMessages) {
    var retainedIds = new Set((retainedMessages || []).map(function (message) { return message && message.id; }).filter(Boolean));
    var turns = window.RPVectorMemory && window.RPVectorMemory.completeTurns
      ? window.RPVectorMemory.completeTurns(priorMessages || [])
      : [];
    var assistantIds = [];
    var assistantTurns = [];
    turns.forEach(function (turn) {
      var ids = turn.sourceAssistantIds && turn.sourceAssistantIds.length
        ? turn.sourceAssistantIds
        : (turn.assistant && turn.assistant.id ? [turn.assistant.id] : []);
      if (ids.some(function (id) { return !retainedIds.has(id); })) {
        assistantIds = assistantIds.concat(ids);
        assistantTurns.push(turn.turn);
      }
    });
    return { assistantIds: Array.from(new Set(assistantIds)), assistantTurns: Array.from(new Set(assistantTurns)) };
  }

  async function reconcileBranchMemories(retainedMessages, priorMessages) {
    var removal = branchRemoval(priorMessages || [], retainedMessages || []);
    if (window.RPSummary && window.RPSummary.abortActive) await window.RPSummary.abortActive();
    if (!removal.assistantIds.length && !removal.assistantTurns.length) return removal;
    if (window.RPMemory && window.RPMemory.pruneToMessages) {
      window.RPMemory.pruneToMessages(retainedMessages || [], removal);
      if (window.RPMemory.flush) await window.RPMemory.flush();
    }
    if (window.RPVectorMemory && window.RPVectorMemory.reconcileToMessages) {
      await window.RPVectorMemory.reconcileToMessages(retainedMessages || [], removal);
    }
    return removal;
  }

  function lastUserActionIndex(messages) {
    var list = messages || canonicalConversation().messages;
    for (var index = list.length - 1; index >= 0; index -= 1) {
      if (list[index] && list[index].role === 'user') return index;
    }
    return -1;
  }

  function canonicalConversation() {
    var meta = window.RPStorage.getCanonical().conversation || {};
    return Object.assign({}, meta, { revision: committedRevision, messages: clone(committedMessages) });
  }

  function openConversationDb() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (conversationDbPromise) return conversationDbPromise;
    conversationDbPromise = new Promise(function (resolve, reject) {
      var request = indexedDB.open(conversationDbName, 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains('conversation')) request.result.createObjectStore('conversation');
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('conversation database unavailable')); };
    });
    return conversationDbPromise;
  }

  async function readConversationStore() {
    var db = await openConversationDb();
    if (!db) return null;
    return new Promise(function (resolve, reject) {
      var request = db.transaction('conversation', 'readonly').objectStore('conversation').get('history');
      request.onsuccess = function () { resolve(request.result || null); };
      request.onerror = function () { reject(request.error || new Error('conversation read failed')); };
    });
  }

  async function writeConversationStore(record) {
    var db = await openConversationDb();
    if (!db) return;
    await new Promise(function (resolve, reject) {
      var request = db.transaction('conversation', 'readwrite').objectStore('conversation').put(record, 'history');
      request.onsuccess = function () { resolve(); };
      request.onerror = function () { reject(request.error || new Error('conversation write failed')); };
    });
  }

  function scheduleConversationWrite() {
    var record = { revision: committedRevision, messages: clone(committedMessages), savedAt: now() };
    conversationWriteQueue = conversationWriteQueue.catch(function () { return null; })
      .then(function () { return writeConversationStore(record); })
      .catch(function (error) {
        window.RPEvents.emit('conversation:storage:error', { message: String(error.message || error) });
      });
    return conversationWriteQueue;
  }

  function init() {
    if (conversationReady) return conversationReady;
    conversationReady = readConversationStore().then(function (stored) {
      if (stored && Array.isArray(stored.messages) && Number(stored.revision || 0) >= committedRevision) {
        committedMessages = clone(stored.messages);
        committedRevision = Number(stored.revision || committedRevision);
      }
      persist(committedMessages, initialConversation.status === 'generating' ? 'idle' : initialConversation.status);
      return conversationWriteQueue;
    }).then(function () { return clone(committedMessages); });
    return conversationReady;
  }

  function persist(messages, status) {
    var state = window.RPStorage.getCanonical();
    committedMessages = clone(messages);
    committedRevision = Math.max(committedRevision, Number(state.conversation && state.conversation.revision || 1)) + 1;
    var configured = window.RPStorage.getPreferences().memoryModules || {};
    var recentFloors = Math.max(1, Number(configured.memoryMode === 'vector' ? configured.vectorKeepFloors : configured.summaryKeepFloors) || 40);
    var canonicalMessages = typeof indexedDB === 'undefined'
      ? committedMessages
      : committedMessages.slice(-recentFloors * 2);
    state.conversation = {
      revision: committedRevision,
      messages: clone(canonicalMessages),
      totalMessages: committedMessages.length,
      archivedMessages: Math.max(0, committedMessages.length - recentFloors * 2),
      status: status || 'idle'
    };
    window.RPStorage.saveCanonical(state);
    scheduleConversationWrite();
    return clone(state.conversation);
  }

  function visible() {
    var messages = canonicalConversation().messages.slice();
    if (active && active.draft) messages.push(clone(active.draft));
    return messages;
  }

  function history(messages) {
    return (messages || canonicalConversation().messages).map(function (message) {
      return { role: message.role, content: String(message.content || '') };
    });
  }

  async function changed(reason) {
    await window.RPEvents.emit('conversation:changed', {
      reason: reason,
      generating: Boolean(active),
      messages: visible()
    });
  }

  function retryableOptions(options) {
    options = options || {};
    return {
      mode: options.mode || 'send',
      seed: String(options.seed || ''),
      appendToId: options.appendToId || '',
      historyMessages: clone(options.historyMessages || null),
      stateInput: options.stateInput == null ? null : String(options.stateInput)
    };
  }

  function retryContext(input, baseMessages, options) {
    return {
      input: String(input || ''),
      baseMessages: clone(baseMessages || []),
      options: retryableOptions(options)
    };
  }

  async function generateWith(input, baseMessages, options) {
    options = options || {};
    if (active) throw new Error('已有生成任务正在进行');
    await stateSyncPending;
    var failedAttempt = retryContext(input, baseMessages, options);
    lastFailedGeneration = null;
    if (window.RPStateSync && window.RPStateSync.clearSuggestions) window.RPStateSync.clearSuggestions();
    var epoch = generationEpoch;
    var controller = new AbortController();
    var draft = {
      id: id('assistant'),
      role: 'assistant',
      content: options.seed || '',
      reasoning: '',
      createdAt: now(),
      status: 'complete'
    };
    active = { controller: controller, draft: draft, mode: options.mode || 'send' };
    lastNarrativeTrace = {
      startedAt: now(),
      mode: options.mode || 'send',
      input: String(input || ''),
      prompt: null,
      toolResults: [],
      response: '',
      reasoning: '',
      error: ''
    };
    persist(baseMessages, 'generating');
    await changed('generation-start');
    try {
      var configured = window.RPStorage.getPreferences().memoryModules || {};
      var maxFloors = Math.max(0, Number(configured.memoryMode === 'vector' ? configured.vectorKeepFloors : configured.summaryKeepFloors || 40));
      var sourceHistory = options.historyMessages || baseMessages;
      var promptHistory = configured.memoryMode !== 'vector' && window.RPSummary
        ? window.RPSummary.contextHistory(sourceHistory, maxFloors)
        : (maxFloors > 0 ? sourceHistory.slice(-maxFloors * 2) : sourceHistory);
      var compiled = await window.RPPrompt.compile(input, {
        history: history(promptHistory),
        character: window.RPCardContext || null,
        signal: controller.signal
      });
      lastNarrativeTrace.prompt = clone(compiled);
      var requestMessages = compiled.messages.slice();
      var result = await window.RPModels.generate('narrative', requestMessages, {
        signal: controller.signal,
        onDelta: function (delta) {
          if (epoch !== generationEpoch) return;
          draft.content += delta;
          changed('stream-delta');
        },
        onReasoning: function (delta) {
          if (epoch !== generationEpoch) return;
          draft.reasoning += delta;
          changed('reasoning-delta');
        }
      });
      if (epoch !== generationEpoch) return clone(draft);
      if (!draft.content && result.content) draft.content = result.content;
      if (!draft.reasoning && result.reasoning) draft.reasoning = result.reasoning;
      var toolRounds = 0;
      var seenToolCalls = new Map();
      var toolSource = result.content || draft.content;
      while (window.RPTools && toolRounds < 4) {
        var toolResult = await window.RPTools.run(toolSource, { messages: baseMessages }, seenToolCalls);
        if (!toolResult.calls.length) break;
        lastNarrativeTrace.toolResults = lastNarrativeTrace.toolResults.concat(clone(toolResult.calls));
        toolRounds += 1;
        requestMessages.push({ role: 'assistant', content: draft.content, source: 'tool:request' });
        requestMessages.push({ role: 'user', content: toolResult.prompt, source: 'tool:result' });
        var diceMarkers = toolResult.calls.filter(function (call) { return call.status !== 'duplicate'; }).map(diceMarker).filter(Boolean);
        if (diceMarkers.length) draft.content += '\n\n' + diceMarkers.join('\n') + '\n\n';
        var beforeToolContinuation = draft.content.length;
        var continuation = await window.RPModels.generate('narrative', requestMessages, {
          signal: controller.signal,
          onDelta: function (delta) {
            if (epoch !== generationEpoch) return;
            draft.content += delta;
            changed('stream-delta');
          },
          onReasoning: function (delta) {
            if (epoch !== generationEpoch) return;
            draft.reasoning += delta;
            changed('reasoning-delta');
          }
        });
        if (epoch !== generationEpoch) return clone(draft);
        var generated = draft.content.slice(beforeToolContinuation) || continuation.content || '';
        requestMessages.push({ role: 'assistant', content: generated, source: 'tool:continuation' });
        toolSource = generated;
        if (!window.RPTools.parse(generated).length) break;
      }
      draft.content = stripInternalTransport(draft.content);
      if (window.RPRegex) {
        draft.content = window.RPRegex.applyOutput(draft.content, { role: 'assistant' }, baseMessages.length);
      }
      var imageProtocol = extractImageRequest(draft.content);
      draft.content = imageProtocol.content;
      var finalMessages = baseMessages.slice();
      if (options.appendToId) {
        var index = finalMessages.findIndex(function (message) { return message.id === options.appendToId; });
        if (index >= 0) {
          finalMessages[index] = Object.assign({}, finalMessages[index], {
            content: String(finalMessages[index].content || '') + draft.content,
            reasoning: String(finalMessages[index].reasoning || '') + draft.reasoning,
            status: 'complete'
          });
        }
      } else {
        finalMessages.push(clone(draft));
      }
      if (epoch !== generationEpoch) return clone(draft);
      lastNarrativeTrace.response = draft.content;
      lastNarrativeTrace.reasoning = draft.reasoning;
      lastNarrativeTrace.completedAt = now();
      active = null;
      persist(finalMessages, 'idle');
      requestSceneImage(imageProtocol.request);
      if (window.RPStateSync) {
        stateSyncPending = stateSyncPending.then(function () {
          return window.RPStateSync.reconcile(options.stateInput || input, draft.content);
        }).catch(function (error) {
          window.RPEvents.emit('state:sync', { ok: false, source: 'state-model', reason: String(error.message || error) });
        });
      } else if (window.RPUIStateSync) {
        stateSyncPending = stateSyncPending.then(function () {
          return window.RPUIStateSync.updateFromChat(finalMessages);
        }).catch(function (error) {
          window.RPEvents.emit('ui-template:sync', { ok: false, reason: String(error.message || error) });
        });
      }
      if (window.RPVectorMemory) {
        var vectorTask = window.RPVectorMemory.indexLatest || window.RPVectorMemory.indexMessages;
        vectorTask.call(window.RPVectorMemory, finalMessages).catch(function (error) {
          window.RPEvents.emit('memory:vector:error', { message: String(error.message || error) });
        });
      }
      if (window.RPSummary && window.RPSummary.shouldSummarize(finalMessages)) {
        var summaryTask = window.RPSummary.summarizeLatest || window.RPSummary.summarize;
        summaryTask.call(window.RPSummary, finalMessages).catch(function (error) {
          window.RPEvents.emit('memory:summary:error', { message: String(error.message || error) });
        });
      }
      await changed('generation-complete');
      return clone(draft);
    } catch (error) {
      if (epoch !== generationEpoch) return clone(draft);
      var interrupted = error && error.name === 'AbortError';
      var failedMessages = baseMessages.slice();
      if (!options.appendToId && draft.content) {
        draft.status = interrupted ? 'interrupted' : 'error';
        failedMessages.push(clone(draft));
      }
      active = null;
      if (lastNarrativeTrace) {
        lastNarrativeTrace.response = draft.content;
        lastNarrativeTrace.reasoning = draft.reasoning;
        lastNarrativeTrace.error = String(error && error.message || error);
        lastNarrativeTrace.completedAt = now();
      }
      if (!interrupted) lastFailedGeneration = failedAttempt;
      if (!interrupted && window.RPGenerationMonitor) {
        var monitor = window.RPGenerationMonitor.snapshot();
        if (monitor.phase !== 'error') {
          window.RPGenerationMonitor.start({ route: 'narrative', model: monitor.model || '', stream: true });
          window.RPGenerationMonitor.fail(error);
        }
      }
      persist(failedMessages, 'idle');
      await changed(interrupted ? 'generation-stopped' : 'generation-error');
      if (!interrupted) throw error;
      return clone(draft);
    }
  }

  async function send(text) {
    await init();
    var input = String(text || '').trim();
    if (!input) throw new Error('请输入内容');
    var messages = canonicalConversation().messages.slice();
    var message = {
      id: id('user'),
      role: 'user',
      content: input,
      reasoning: '',
      createdAt: now(),
      status: 'complete'
    };
    saveActionCheckpoint(message.id);
    messages.push(message);
    persist(messages, 'idle');
    await changed('user-message');
    return generateWith(input, messages, { historyMessages: messages.slice(0, -1) });
  }

  function stop() {
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  async function regenerate() {
    await init();
    await stateSyncPending;
    var messages = canonicalConversation().messages.slice();
    var assistantIndex = -1;
    for (var index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'assistant') {
        assistantIndex = index;
        break;
      }
    }
    if (assistantIndex < 1 || messages[assistantIndex - 1].role !== 'user') {
      throw new Error('没有可重新生成的回复');
    }
    var user = messages[assistantIndex - 1];
    var base = messages.slice(0, assistantIndex);
    restoreActionCheckpoint(user);
    persist(base, 'idle');
    await reconcileBranchMemories(base, messages);
    return generateWith(user.content, base, {
      mode: 'regenerate',
      historyMessages: base.slice(0, -1)
    });
  }

  async function retryLastGeneration() {
    await init();
    if (active) throw new Error('当前请求仍在生成');
    if (!lastFailedGeneration) throw new Error('没有可重试的失败请求');
    var failed = clone(lastFailedGeneration);
    return generateWith(failed.input, failed.baseMessages, failed.options);
  }

  async function retryLastAction() {
    await init();
    if (active) throw new Error('请先停止当前生成');
    await stateSyncPending;
    var messages = canonicalConversation().messages.slice();
    var actionIndex = lastUserActionIndex(messages);
    if (actionIndex < 0) throw new Error('没有可重roll的玩家行动');
    var action = messages[actionIndex];
    var base = messages.slice(0, actionIndex + 1);
    restoreActionCheckpoint(action);
    persist(base, 'idle');
    await reconcileBranchMemories(base, messages);
    await changed('player-action-retry');
    return generateWith(action.content, base, {
      mode: 'action-retry',
      historyMessages: base.slice(0, -1),
      stateInput: action.content
    });
  }

  async function reviseLastAction(content) {
    await init();
    if (active) throw new Error('请先停止当前生成');
    var nextText = String(content || '').trim();
    if (!nextText) throw new Error('改写内容不能为空');
    await stateSyncPending;
    var messages = canonicalConversation().messages.slice();
    var actionIndex = lastUserActionIndex(messages);
    if (actionIndex < 0) throw new Error('没有可改写的玩家行动');
    var action = Object.assign({}, messages[actionIndex], { content: nextText, status: 'complete' });
    restoreActionCheckpoint(action);
    var base = messages.slice(0, actionIndex);
    base.push(action);
    persist(base, 'idle');
    await reconcileBranchMemories(base, messages);
    await changed('player-action-revised');
    return generateWith(nextText, base, {
      mode: 'action-revise',
      historyMessages: base.slice(0, -1),
      stateInput: nextText
    });
  }

  async function continueLast() {
    await init();
    var messages = canonicalConversation().messages.slice();
    var last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') throw new Error('没有可继续的助手回复');
    return generateWith('请自然地继续上一条回复，不要复述已经写出的内容。', messages, {
      mode: 'continue',
      appendToId: last.id
    });
  }

  async function edit(messageId, content) {
    await init();
    if (active) throw new Error('请先停止当前生成');
    var messages = canonicalConversation().messages.slice();
    var index = messages.findIndex(function (message) { return message.id === messageId; });
    if (index < 0) throw new Error('消息不存在');
    var priorMessages = messages.slice();
    messages[index].content = String(content || '').trim();
    messages = messages.slice(0, index + 1);
    persist(messages, 'idle');
    await reconcileBranchMemories(messages, priorMessages);
    await changed('message-edited');
    return clone(messages[index]);
  }

  async function remove(messageId) {
    await init();
    if (active) throw new Error('请先停止当前生成');
    var messages = canonicalConversation().messages.slice();
    var index = messages.findIndex(function (message) { return message.id === messageId; });
    if (index < 0) return false;
    var priorMessages = messages.slice();
    messages.splice(index, 1);
    persist(messages, 'idle');
    await reconcileBranchMemories(messages, priorMessages);
    await changed('message-removed');
    return true;
  }

  async function clear() {
    await init();
    generationEpoch += 1;
    if (active && active.controller) active.controller.abort();
    active = null;
    lastFailedGeneration = null;
    stateSyncPending = Promise.resolve();
    if (window.RPStorage.saveActionCheckpoint) window.RPStorage.saveActionCheckpoint(null);
    persist([], 'idle');
    await changed('conversation-cleared');
    return true;
  }

  async function exportData() {
    await init();
    await conversationWriteQueue.catch(function () { return null; });
    return {
      revision: committedRevision,
      messages: clone(committedMessages),
      savedAt: now()
    };
  }

  async function importData(record) {
    await init();
    var next = record && typeof record === 'object' ? record : {};
    if (!Array.isArray(next.messages)) throw new Error('存档中的完整对话不是有效数组');
    if (next.messages.length > 20000) throw new Error('存档中的对话楼层超过上限');
    committedMessages = clone(next.messages);
    committedRevision = Math.max(1, Number(next.revision || 1));
    var state = window.RPStorage.getCanonical();
    var configured = window.RPStorage.getPreferences().memoryModules || {};
    var recentFloors = Math.max(1, Number(configured.memoryMode === 'vector'
      ? configured.vectorKeepFloors : configured.summaryKeepFloors) || (configured.memoryMode === 'vector' ? 50 : 20));
    state.conversation = {
      revision: committedRevision,
      messages: typeof indexedDB === 'undefined'
        ? clone(committedMessages)
        : clone(committedMessages.slice(-recentFloors * 2)),
      totalMessages: committedMessages.length,
      archivedMessages: Math.max(0, committedMessages.length - recentFloors * 2),
      status: 'idle'
    };
    window.RPStorage.saveCanonical(state);
    await writeConversationStore({
      revision: committedRevision,
      messages: clone(committedMessages),
      savedAt: String(next.savedAt || now())
    });
    await changed('conversation-imported');
    return exportData();
  }

  window.RPConversation = {
    init: init,
    flush: function () { return conversationWriteQueue; },
    list: visible,
    committed: function () { return clone(canonicalConversation().messages); },
    exportData: exportData,
    importData: importData,
    isGenerating: function () { return Boolean(active); },
    send: send,
    stop: stop,
    regenerate: regenerate,
    retryLastGeneration: retryLastGeneration,
    canRetryLastGeneration: function () { return Boolean(lastFailedGeneration) && !active; },
    retryLastAction: retryLastAction,
    reviseLastAction: reviseLastAction,
    lastAction: function () {
      var messages = canonicalConversation().messages;
      var index = lastUserActionIndex(messages);
      return index < 0 ? '' : String(messages[index].content || '');
    },
    continueLast: continueLast,
    edit: edit,
    remove: remove,
    clear: clear,
    whenStateSettled: function () { return stateSyncPending.catch(function () { return null; }); },
    debugTrace: function () { return clone(lastNarrativeTrace); },
    diagnostics: function () {
      var conversation = canonicalConversation();
      return {
        messages: conversation.messages.length,
        totalMessages: committedMessages.length,
        storage: typeof indexedDB === 'undefined' ? 'canonical-fallback' : 'indexedDB',
        status: conversation.status,
        activeMode: active && active.mode || ''
      };
    }
  };
})();
