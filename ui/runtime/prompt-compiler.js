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

  function stylePriority() {
    return '[Style Priority]\n开场白和历史消息只用于理解剧情事实、人物关系和场景状态，不作为文风模板；不要继承或模仿开场白、前文回复的句式、语气密度、段落节奏或排版习惯。最终回复的文风必须优先遵守上方系统预设中的规定文风。';
  }

  function activeToolProtocol() {
    if (!window.RPTools) return '';
    var enabled = window.RPTools.list().filter(function (tool) { return tool.enabled; });
    if (!enabled.length) return '';
    var lines = enabled.map(function (tool) {
      if (tool.type === 'vector_memory') return '<tool_memory_add:具体检索内容> 或 <tool_memory_cover:具体检索内容>：检索较早剧情、人物关系、物品和事件记忆。';
      if (tool.type === 'keyword_dialogue') return '<tool_grep_add:原文关键词> 或 <tool_grep_cover:原文关键词>：精准查找当前对话历史中的原文片段。';
      if (tool.type === 'web_search') return '<tool_web_add:搜索词或URL> 或 <tool_web_cover:搜索词或URL>：查询外部资料；只有宿主提供搜索能力时可用。';
      if (tool.type === 'worldbook') return '<tool_worldbook_add:设定查询> 或 <tool_worldbook_cover:设定查询>：主动检索卡内世界书、规则与角色资料。';
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
    if (vectorMemories.length) {
      messages.push({
        role: 'system',
        content: '【相关历史向量记忆】\n以下内容来自较早剧情的语义检索，不是当前现场；只把有证据的内容作为背景参考：\n' +
          vectorMemories.map(function (memory) {
            return '- ' + memory.sourceText + '（相关度 ' + Number(memory.retrievalScore || 0).toFixed(2) + '）';
          }).join('\n'),
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

    messages = messages.map(function (message) {
      return Object.assign({}, message, {
        content: resolvePlaceholders(message.content, options.state, options.character)
      });
    });
    var context = { input: input, messages: messages, retrieval: retrieval, memories: memories };
    context = await window.RPPlugins.run('beforePromptCompile', context);
    if (window.RPRegex) context.messages = window.RPRegex.applyPrompt(context.messages);
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
