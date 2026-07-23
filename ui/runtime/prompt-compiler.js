(function () {
  'use strict';

  // Placement order follows STA1N156/RP-Hub 092ab90 (CC BY-NC 4.0).

  var last = null;

  function block(hit) {
    return '【' + hit.name + '】\n' + hit.content;
  }

  function groupHits(hits) {
    var groups = {
      system_top: [],
      global_note: [],
      before_char: [],
      after_char: [],
      user_top: [],
      assistant_top: [],
      at_depth: []
    };
    (hits || []).forEach(function (hit) {
      var placement = window.RPWorldbook.normalizePlacement(hit.placement);
      groups[placement].push(hit);
    });
    Object.keys(groups).forEach(function (key) {
      groups[key].sort(function (a, b) { return Number(a.order || 0) - Number(b.order || 0); });
    });
    return groups;
  }

  function characterContent(character) {
    if (!character || typeof character !== 'object') return '';
    var parts = [];
    if (character.name) parts.push('Name: ' + character.name);
    if (character.description) parts.push('Description: ' + character.description);
    if (character.personality) parts.push('Personality: ' + character.personality);
    if (character.scenario) parts.push('Scenario: ' + character.scenario);
    if (character.examples || character.mesExample || character.mes_example) {
      parts.push('Examples:\n' + (character.examples || character.mesExample || character.mes_example));
    }
    return parts.length ? '[Character]\n' + parts.join('\n') : '';
  }

  function addWorldbookMessages(messages, hits, role, sourcePrefix) {
    hits.forEach(function (hit) {
      messages.push({ role: role, content: block(hit), source: sourcePrefix + hit.id, worldbookIds: [hit.id] });
    });
  }

  function insertAtDepth(messages, referenceMessages, hit, safeTargetLimit) {
    var reversed = referenceMessages.slice().reverse();
    var countdown = Number.isFinite(Number(hit.insertionDepth)) ? Number(hit.insertionDepth) : 4;
    var targetIndex = -1;
    for (var i = 0; i < reversed.length; i += 1) {
      if (reversed[i].role === 'user' || reversed[i].role === 'assistant') countdown -= 1;
      if (countdown < 0) {
        targetIndex = reversed.length - 1 - i;
        break;
      }
    }
    if (targetIndex < safeTargetLimit) targetIndex = safeTargetLimit;
    messages.splice(targetIndex, 0, {
      role: 'user',
      content: block(hit),
      source: 'worldbook:at-depth:' + hit.id,
      worldbookIds: [hit.id]
    });
  }

  async function compile(input, options) {
    options = Object.assign({
      history: [],
      state: window.RPStorage.getCanonical(),
      worldbook: {},
      character: window.RPCardContext || null,
      memoryTopK: 8
    }, options || {});
    var started = performance.now();
    var retrievalOptions = Object.assign({ history: options.history }, options.worldbook, { state: options.state });
    var retrieval = window.RPWorldbook.retrieve(input, retrievalOptions);
    var groups = groupHits(retrieval.hits);
    var memories = window.RPMemory.searchStructured(input, { topK: options.memoryTopK });
    var presetGroups = window.RPPresets.compile();
    var messages = [];

    presetGroups.systemRoot.forEach(function (preset) {
      messages.push({ role: preset.role, content: preset.content, source: 'preset:' + preset.id });
    });
    addWorldbookMessages(messages, groups.system_top, 'system', 'worldbook:system-top:');
    addWorldbookMessages(messages, groups.global_note, 'system', 'worldbook:global-note:');
    if (presetGroups.systemSupport.length) {
      messages.push({
        role: 'system',
        content: '[System Presets]\n' + presetGroups.systemSupport.map(function (preset) {
          return '【' + preset.name + '】\n' + preset.content;
        }).join('\n\n---\n\n'),
        source: 'presets:system-support'
      });
    }
    presetGroups.prelude.forEach(function (preset) {
      messages.push({ role: preset.role, content: preset.content, source: 'preset:' + preset.id });
    });

    var characterParts = [];
    groups.before_char.forEach(function (hit) { characterParts.push(block(hit)); });
    var authoredCharacter = characterContent(options.character);
    if (authoredCharacter) characterParts.push(authoredCharacter);
    groups.after_char.forEach(function (hit) { characterParts.push(block(hit)); });
    if (characterParts.length) {
      messages.push({
        role: 'user',
        content: characterParts.join('\n\n'),
        source: 'character:context',
        worldbookIds: groups.before_char.concat(groups.after_char).map(function (hit) { return hit.id; })
      });
    }
    if (memories.length) {
      messages.push({
        role: 'system',
        content: '【相关历史记忆】\n' + memories.map(function (memory) {
          return '- ' + memory.title + '：' + memory.summary;
        }).join('\n'),
        source: 'memory:structured'
      });
    }
    messages.push({
      role: 'system',
      content: '【当前权威状态】\n' + JSON.stringify(options.state),
      source: 'state:canonical'
    });

    var safeTargetLimit = messages.length;
    (options.history || []).forEach(function (message) {
      messages.push(Object.assign({}, message, { source: message.source || 'history' }));
    });
    messages.push({ role: 'user', content: String(input || ''), source: 'input' });

    var depthReference = messages.slice();
    groups.at_depth.forEach(function (hit) {
      insertAtDepth(messages, depthReference, hit, safeTargetLimit);
    });
    if (groups.user_top.length) {
      var latestUser = messages.slice().reverse().find(function (message) { return message.role === 'user' && message.source === 'input'; });
      if (latestUser) {
        latestUser.content = groups.user_top.map(block).join('\n\n') + '\n\n' + latestUser.content;
        latestUser.worldbookIds = groups.user_top.map(function (hit) { return hit.id; });
      }
    }
    if (groups.assistant_top.length) {
      messages.push({
        role: 'system',
        content: '[Instructions for next message]\n' + groups.assistant_top.map(block).join('\n\n'),
        source: 'worldbook:assistant-top',
        worldbookIds: groups.assistant_top.map(function (hit) { return hit.id; })
      });
    }

    var context = { input: input, messages: messages, retrieval: retrieval, memories: memories };
    context = await window.RPPlugins.run('beforePromptCompile', context);
    last = {
      input: String(input || ''),
      messages: context.messages,
      worldbookHits: retrieval.hits,
      memoryHits: memories,
      charCount: context.messages.reduce(function (sum, message) { return sum + String(message.content || '').length; }, 0),
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      at: new Date().toISOString()
    };
    await window.RPEvents.emit('prompt:compiled', last);
    return last;
  }

  window.RPPrompt = {
    compile: compile,
    last: function () { return last ? JSON.parse(JSON.stringify(last)) : null; }
  };
})();
