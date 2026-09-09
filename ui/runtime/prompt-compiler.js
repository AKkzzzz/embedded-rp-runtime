(function () {
  'use strict';

  // Placement order follows STA1N156/RP-Hub 092ab90 (CC BY-NC 4.0).

  var last = null;

  function block(hit) {
    return '【' + hit.name + '】\n' + hit.content;
  }

  function resolvePlaceholders(content, state, character) {
    var playerName = state && state.player && String(state.player.name || '').trim();
    var characterName = character && String(character.name || '').trim();
    var output = String(content == null ? '' : content);
    if (playerName && playerName !== '{{user}}') output = output.replace(/\{\{user\}\}/gi, playerName);
    if (characterName && characterName !== '{{char}}') output = output.replace(/\{\{char\}\}/gi, characterName);
    return output;
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
      groups[key].sort(function (a, b) {
        return Number(a.order || 0) - Number(b.order || 0) ||
          Number(a.sourceOrder || 0) - Number(b.sourceOrder || 0);
      });
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

  function stylePriority() {
    return '[Style Priority]\n开场白和历史消息只用于理解剧情事实、人物关系和场景状态，不作为文风模板；不要继承或模仿开场白、前文回复的句式、语气密度、段落节奏或排版习惯。最终回复的文风必须优先遵守上方系统预设中的规定文风。';
  }

  function unwrapWritingStyle(content) {
    return String(content || '').replace(/^\s*<writing_style>\s*/i, '').replace(/\s*<\/writing_style>\s*$/i, '').trim();
  }

  function nextResponsePrompt(presetGroups) {
    var style = (presetGroups.writingStyle || []).map(function (preset) {
      return unwrapWritingStyle(preset.content);
    }).filter(Boolean).join('\n\n');
    return [
      '<next_response>',
      '完整承接最新用户输入中已经发生的言行，结合当前场景继续剧情。',
      presetGroups.cot && presetGroups.cot.length ? '按当前COT预设完成内部分析，不要用分析摘要或正文草稿取代正式正文。' : '',
      style,
      '按系统中当前启用的人称、时间戳、记忆、变量与输出格式执行。',
      '</next_response>'
    ].filter(Boolean).join('\n');
  }

  function escapeXmlAttribute(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function vectorMemoryText(memory) {
    return String(memory && (memory.paragraph || memory.sourceText || memory.summary) || '').trim();
  }

  function compileVectorRecall(memories, maxChars) {
    var budget = Math.max(1000, Math.min(30000, Number(maxChars) || 8000));
    var header = '<role_memory_vector_recall>\n  <description>以下内容是按当前输入检索出的较早剧情分片，不是当前现场。</description>';
    var footer = '</role_memory_vector_recall>';
    var selected = [];
    function render(items) {
      return [header, items.map(function (memory) {
        return '  <memory_fragment turn="' + escapeXmlAttribute(memory.turn || '?') + '" similarity="' +
          escapeXmlAttribute((Number(memory.retrievalScore || 0) * 100).toFixed(1) + '%') + '">\n    ' +
          memory.recallText.replace(/\n/g, '\n    ') + '\n  </memory_fragment>';
      }).join('\n\n'), footer].join('\n');
    }
    (memories || []).forEach(function (memory) {
      var text = vectorMemoryText(memory);
      if (!text) return;
      var candidate = Object.assign({}, memory, { recallText: text });
      var content = render(selected.concat(candidate));
      if (content.length > budget) {
        var remaining = Math.max(0, budget - render(selected.concat(Object.assign({}, candidate, { recallText: '' }))).length - 1);
        if (!remaining) return;
        candidate.recallText = text.slice(0, remaining).trim() + '…';
        content = render(selected.concat(candidate));
      }
      if (content.length <= budget) selected.push(candidate);
    });
    selected.sort(function (a, b) { return Number(a.turn || 0) - Number(b.turn || 0) || Number(a.sequence || 0) - Number(b.sequence || 0); });
    if (!selected.length) return { content: '', items: [], chars: 0, truncated: false };
    var content = render(selected);
    return { content: content, items: selected, chars: content.length, truncated: selected.length < (memories || []).length };
  }

  function promptDiagnostics(messages) {
    var output = { totalChars: 0, historyChars: 0, vectorRecallChars: 0, worldbookChars: 0, presetChars: 0, stateChars: 0, otherChars: 0 };
    (messages || []).forEach(function (message) {
      var count = String(message && message.content || '').length;
      var source = String(message && message.source || '');
      output.totalChars += count;
      if (source === 'history' || source.indexOf('memory:classic:') === 0) output.historyChars += count;
      else if (source === 'memory:vector') output.vectorRecallChars += count;
      else if (source.indexOf('worldbook:') === 0) output.worldbookChars += count;
      else if (source.indexOf('preset:') === 0 || source.indexOf('presets:') === 0) output.presetChars += count;
      else if (source === 'state:variables') output.stateChars += count;
      else output.otherChars += count;
    });
    return output;
  }

  function narrativePolicy() {
    return String(window.RPTemplateData.narrativePolicy || '').trim();
  }

  function activeToolProtocol() {
    if (!window.RPTools) return '';
    var enabled = window.RPTools.list().filter(function (tool) { return tool.enabled; });
    if (!enabled.length) return '';
    var lines = enabled.map(function (tool) {
      if (tool.type === 'vector_memory') return '<tool_memory_add:具体检索内容> 或 <tool_memory_cover:具体检索内容>：检索较早剧情、人物关系、物品和事件记忆。';
      if (tool.type === 'keyword_dialogue') return '<tool_grep_add:原文关键词> 或 <tool_grep_cover:原文关键词>：精准查找当前对话历史中的原文片段。';
      if (tool.type === 'web_search') return '<tool_web_add:搜索词或URL> 或 <tool_web_cover:搜索词或URL>：查询外部资料；只有宿主提供搜索能力时可用。';
      if (tool.type === 'worldbook') return '<tool_worldbook_add:具体设定查询> 或 <tool_worldbook_cover:具体设定查询>：显式搜索卡内世界书的名称、触发词、标签与正文；可读取当前对话尚未自动触发的条目，每次最多返回6条并报告总命中数，仍遵守禁用、范围、状态与依赖规则。';
      if (tool.type === 'dice') return '<tool_dice:骰式>：执行公开随机检定，例如 d20、2d6+3。';
      return '<' + tool.callName + ':查询内容>';
    });
    return '[Active Tools]\n上下文不足时，可在正式正文前单独输出工具标签。每行一个，单轮最多5个；收到 <active_tool_results> 后继续正文，不要复述标签。\n' + lines.join('\n');
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

  function narrativeVariables(state) {
    var root = state || {};
    var rpg = root.rpg || {};
    return {
      player: root.player || {},
      scene: rpg.scene || root.scene || {},
      rpg: {
        revision: rpg.revision,
        player: rpg.player || {},
        presentCharacters: rpg.presentCharacters || [],
        quests: rpg.quests || [],
        inventory: rpg.inventory || [],
        stats: rpg.stats || {},
        film: rpg.film || {},
        battle: rpg.battle || {}
      }
    };
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
    var memories = window.RPMemory.searchStructured(input, { topK: options.memoryTopK }).filter(function (memory) {
      return memory.kind !== 'summary' && memory.kind !== 'classicMemory' && memory.classicMemory !== true;
    });
    var summaries = [];
    var vectorMemories = await window.RPMemory.searchVectors(input, { signal: options.signal });
    var memoryPreferences = window.RPStorage.getPreferences().memoryModules || {};
    var vectorRecall = compileVectorRecall(vectorMemories, memoryPreferences.vectorRecallMaxChars);
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
        }).join('\n\n---\n\n') + '\n\n' + stylePriority(),
        source: 'presets:system-support'
      });
    } else {
      messages.push({ role: 'system', content: stylePriority(), source: 'runtime:style-priority' });
    }
    var policy = narrativePolicy();
    if (policy) messages.push({ role: 'system', content: policy, source: 'runtime:narrative-policy' });
    var toolProtocol = activeToolProtocol();
    if (toolProtocol) messages.push({ role: 'system', content: toolProtocol, source: 'runtime:active-tools' });
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
    if (vectorRecall.content) {
      messages.push({
        role: 'system',
        content: vectorRecall.content,
        source: 'memory:vector'
      });
    }
    if (summaries.length) {
      messages.push({
        role: 'system',
        content: '【历史总结】\n' + summaries.map(function (memory) {
          return '- ' + memory.summary;
        }).join('\n\n') + '\n这些总结来自较早楼层，只用于保持长期连续性。',
        source: 'memory:summary'
      });
    }
    messages.push({
      role: 'system',
      content: '【当前变量状态】\n' + JSON.stringify(narrativeVariables(options.state)),
      source: 'state:variables'
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

    var latestInput = messages.slice().reverse().find(function (message) {
      return message.role === 'user' && message.source === 'input';
    });
    if (latestInput) latestInput.content = String(latestInput.content || '').trimEnd() + '\n\n' + nextResponsePrompt(presetGroups);

    messages = messages.map(function (message) {
      return Object.assign({}, message, {
        content: resolvePlaceholders(message.content, options.state, options.character)
      });
    });
    var context = { input: input, messages: messages, retrieval: retrieval, memories: memories };
    context = await window.RPPlugins.run('beforePromptCompile', context);
    if (window.RPRegex) context.messages = window.RPRegex.applyPrompt(context.messages);
    var diagnostics = promptDiagnostics(context.messages);
    last = {
      input: String(input || ''),
      messages: context.messages,
      worldbookHits: retrieval.hits,
      memoryHits: memories,
      vectorMemoryHits: vectorRecall.items,
      vectorRecallTruncated: vectorRecall.truncated,
      diagnostics: diagnostics,
      charCount: diagnostics.totalChars,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      at: new Date().toISOString()
    };
    await window.RPEvents.emit('prompt:compiled', last);
    return last;
  }

  window.RPPrompt = {
    compile: compile,
    compileVectorRecall: compileVectorRecall,
    diagnostics: promptDiagnostics,
    last: function () { return last ? JSON.parse(JSON.stringify(last)) : null; }
  };
})();
