(function () {
  'use strict';

  var active = null;
  var sequence = 0;
  var uiTemplateSyncPending = Promise.resolve();
  var lastNarrativeTrace = null;

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

  function canonicalConversation() {
    return window.RPStorage.getCanonical().conversation;
  }

  function persist(messages, status) {
    var state = window.RPStorage.getCanonical();
    state.conversation = {
      revision: Number(state.conversation.revision || 1) + 1,
      messages: clone(messages),
      status: status || 'idle'
    };
    window.RPStorage.saveCanonical(state);
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

  async function generateWith(input, baseMessages, options) {
    options = options || {};
    if (active) throw new Error('已有生成任务正在进行');
    await uiTemplateSyncPending;
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
      var maxFloors = Math.max(0, Number(configured.maxHistoryFloors || 50));
      var sourceHistory = options.historyMessages || baseMessages;
      var promptHistory = configured.summaryEnabled && window.RPSummary
        ? window.RPSummary.contextHistory(sourceHistory, maxFloors)
        : (maxFloors > 0 ? sourceHistory.slice(-maxFloors * 2) : sourceHistory);
      var compiled = await window.RPPrompt.compile(input, {
        history: history(promptHistory),
        character: window.RPCardContext || null
      });
      lastNarrativeTrace.prompt = clone(compiled);
      var requestMessages = compiled.messages.slice();
      var result = await window.RPModels.generate('narrative', requestMessages, {
        signal: controller.signal,
        onDelta: function (delta) {
          draft.content += delta;
          changed('stream-delta');
        },
        onReasoning: function (delta) {
          draft.reasoning += delta;
          changed('reasoning-delta');
        }
      });
      if (!draft.content && result.content) draft.content = result.content;
      if (!draft.reasoning && result.reasoning) draft.reasoning = result.reasoning;
      var toolRounds = 0;
      var toolSource = result.content || draft.content;
      while (window.RPTools && toolRounds < 4) {
        var toolResult = await window.RPTools.run(toolSource, { messages: baseMessages });
        if (!toolResult.calls.length) break;
        lastNarrativeTrace.toolResults = lastNarrativeTrace.toolResults.concat(clone(toolResult.calls));
        toolRounds += 1;
        requestMessages.push({ role: 'assistant', content: draft.content, source: 'tool:request' });
        requestMessages.push({ role: 'user', content: toolResult.prompt, source: 'tool:result' });
        var diceMarkers = toolResult.calls.map(diceMarker).filter(Boolean);
        if (diceMarkers.length) draft.content += '\n\n' + diceMarkers.join('\n') + '\n\n';
        var beforeToolContinuation = draft.content.length;
        var continuation = await window.RPModels.generate('narrative', requestMessages, {
          signal: controller.signal,
          onDelta: function (delta) {
            draft.content += delta;
            changed('stream-delta');
          },
          onReasoning: function (delta) {
            draft.reasoning += delta;
            changed('reasoning-delta');
          }
        });
        var generated = draft.content.slice(beforeToolContinuation) || continuation.content || '';
        requestMessages.push({ role: 'assistant', content: generated, source: 'tool:continuation' });
        toolSource = generated;
        if (!window.RPTools.parse(generated).length) break;
      }
      draft.content = draft.content.replace(/<\s*tool_[a-z0-9_]+\s*:[\s\S]*?>/gi, '').trim();
      if (window.RPRegex) {
        draft.content = window.RPRegex.applyOutput(draft.content, { role: 'assistant' }, baseMessages.length);
      }
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
      lastNarrativeTrace.response = draft.content;
      lastNarrativeTrace.reasoning = draft.reasoning;
      lastNarrativeTrace.completedAt = now();
      active = null;
      persist(finalMessages, 'idle');
      if (window.RPUIStateSync) {
        uiTemplateSyncPending = uiTemplateSyncPending.then(function () {
          return window.RPUIStateSync.updateFromChat(finalMessages);
        }).catch(function (error) {
          window.RPEvents.emit('ui-template:sync', { ok: false, reason: String(error.message || error) });
        });
      }
      if (window.RPVectorMemory) {
        window.RPVectorMemory.indexMessages(finalMessages).catch(function (error) {
          window.RPEvents.emit('memory:vector:error', { message: String(error.message || error) });
        });
      }
      if (window.RPSummary && window.RPSummary.shouldSummarize(finalMessages)) {
        window.RPSummary.summarize(finalMessages).catch(function (error) {
          window.RPEvents.emit('memory:summary:error', { message: String(error.message || error) });
        });
      }
      await changed('generation-complete');
      return clone(draft);
    } catch (error) {
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
      persist(failedMessages, 'idle');
      await changed(interrupted ? 'generation-stopped' : 'generation-error');
      if (!interrupted) throw error;
      return clone(draft);
    }
  }

  async function send(text) {
    var input = String(text || '').trim();
    if (!input) throw new Error('请输入内容');
    var messages = canonicalConversation().messages.slice();
    messages.push({
      id: id('user'),
      role: 'user',
      content: input,
      reasoning: '',
      createdAt: now(),
      status: 'complete'
    });
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
    persist(base, 'idle');
    return generateWith(user.content, base, {
      mode: 'regenerate',
      historyMessages: base.slice(0, -1)
    });
  }

  async function continueLast() {
    var messages = canonicalConversation().messages.slice();
    var last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') throw new Error('没有可继续的助手回复');
    return generateWith('请自然地继续上一条回复，不要复述已经写出的内容。', messages, {
      mode: 'continue',
      appendToId: last.id
    });
  }

  async function edit(messageId, content) {
    if (active) throw new Error('请先停止当前生成');
    var messages = canonicalConversation().messages.slice();
    var index = messages.findIndex(function (message) { return message.id === messageId; });
    if (index < 0) throw new Error('消息不存在');
    messages[index].content = String(content || '').trim();
    messages = messages.slice(0, index + 1);
    persist(messages, 'idle');
    await changed('message-edited');
    return clone(messages[index]);
  }

  async function remove(messageId) {
    if (active) throw new Error('请先停止当前生成');
    var messages = canonicalConversation().messages.slice();
    var index = messages.findIndex(function (message) { return message.id === messageId; });
    if (index < 0) return false;
    messages.splice(index, 1);
    persist(messages, 'idle');
    await changed('message-removed');
    return true;
  }

  async function clear() {
    if (active) stop();
    persist([], 'idle');
    await changed('conversation-cleared');
  }

  window.RPConversation = {
    list: visible,
    isGenerating: function () { return Boolean(active); },
    send: send,
    stop: stop,
    regenerate: regenerate,
    continueLast: continueLast,
    edit: edit,
    remove: remove,
    clear: clear,
    debugTrace: function () { return clone(lastNarrativeTrace); },
    diagnostics: function () {
      var conversation = canonicalConversation();
      return {
        messages: conversation.messages.length,
        status: conversation.status,
        activeMode: active && active.mode || ''
      };
    }
  };
  if (canonicalConversation().status === 'generating') {
    persist(canonicalConversation().messages, 'idle');
  }
})();
