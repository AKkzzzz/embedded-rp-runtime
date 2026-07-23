(function () {
  'use strict';

  var prefix = window.RPTemplateData.app.storagePrefix + ':community:';
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function read(key, fallback) {
    try {
      var value = JSON.parse(localStorage.getItem(prefix + key) || 'null');
      return value == null ? clone(fallback) : value;
    } catch (_error) { return clone(fallback); }
  }
  function write(key, value) {
    try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch (_error) {}
    return clone(value);
  }
  function parseJson(text, fallback) {
    var source = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { return JSON.parse(source); } catch (_error) { return fallback; }
  }

  window.RPPromptInspector = {
    snapshot: function () {
      var prompt = window.RPPrompt.last();
      return {
        compiledAt: prompt && prompt.at || '',
        messages: prompt && clone(prompt.messages) || [],
        worldbookHits: prompt && clone(prompt.worldbookHits) || [],
        memoryHits: prompt && clone(prompt.memoryHits) || [],
        charCount: prompt && prompt.charCount || 0,
        regex: window.RPRegex && window.RPRegex.diagnostics ? window.RPRegex.diagnostics() : null
      };
    },
    sources: function () {
      return this.snapshot().messages.map(function (message, index) {
        return { index: index, role: message.role, source: message.source || '', chars: String(message.content || '').length };
      });
    }
  };

  window.RPGuided = {
    suggest: async function (count) {
      count = Math.max(2, Math.min(4, Number(count || 2)));
      var state = window.RPStorage.getCanonical();
      var recent = (window.RPConversation ? window.RPConversation.list() : []).slice(-6);
      var prompt = [
        { role: 'system', content: '根据当前互动生成彼此有明显差异的玩家行动建议。只输出 JSON 字符串数组，不推进剧情，不替玩家选择。' },
        { role: 'user', content: JSON.stringify({ count: count, scene: state.scene, rpg: state.rpg, recent: recent }) }
      ];
      try {
        var result = await window.RPModels.generate('state', prompt, { stream: false, temperature: 0.55 });
        var rows = parseJson(result.content, []);
        if (Array.isArray(rows) && rows.length) return rows.slice(0, count).map(String);
      } catch (_error) {}
      return ['观察现场并确认风险', '主动与面前的人交谈', '检查当前任务与随身物品', '暂时离开并前往其他地点'].slice(0, count);
    }
  };

  window.RPCharMemory = {
    list: function () {
      return window.RPMemory.listStructured().filter(function (item) { return item.kind === 'character'; });
    },
    add: function (character, summary, sourceIds, tags) {
      return window.RPMemory.addStructured({
        id: 'character-' + String(character || 'unknown').replace(/\s+/g, '-').toLowerCase() + '-' + Date.now().toString(36),
        kind: 'character',
        title: String(character || '未命名角色'),
        summary: String(summary || ''),
        sourceIds: Array.isArray(sourceIds) ? sourceIds : [],
        tags: Array.isArray(tags) ? tags : []
      });
    },
    extract: async function () {
      var messages = (window.RPConversation ? window.RPConversation.list() : []).slice(-20);
      var result = await window.RPModels.generate('summarize', [
        { role: 'system', content: '提取角色长期记忆。只输出 JSON 数组，每项包含 character、summary、sourceIds、tags。不要杜撰。' },
        { role: 'user', content: JSON.stringify(messages) }
      ], { stream: false, temperature: 0.2 });
      var rows = parseJson(result.content, []);
      return Array.isArray(rows) ? rows : [];
    }
  };

  var notes = read('notebook', []);
  window.RPNotebook = {
    list: function () { return clone(notes); },
    add: function (title, content, inject) {
      var note = { id: 'note-' + Date.now().toString(36), title: String(title || '便签'), content: String(content || ''), inject: Boolean(inject), createdAt: new Date().toISOString() };
      notes.push(note); write('notebook', notes); return clone(note);
    },
    update: function (id, patch) {
      var note = notes.find(function (item) { return item.id === id; });
      if (!note) return false;
      Object.assign(note, clone(patch || {})); write('notebook', notes); return true;
    },
    remove: function (id) { notes = notes.filter(function (item) { return item.id !== id; }); write('notebook', notes); return true; }
  };

  var personas = read('personas', []);
  window.RPPersonas = {
    list: function () { return clone(personas); },
    save: function (persona) {
      var next = Object.assign({ id: 'persona-' + Date.now().toString(36), name: '未命名', description: '' }, clone(persona || {}));
      var index = personas.findIndex(function (item) { return item.id === next.id; });
      if (index >= 0) personas[index] = next; else personas.push(next);
      write('personas', personas); return clone(next);
    },
    activate: function (id) {
      var persona = personas.find(function (item) { return item.id === id; });
      if (!persona) return false;
      var state = window.RPStorage.getCanonical();
      state.player = Object.assign({}, state.player, clone(persona), { activePersonaId: persona.id });
      window.RPStorage.saveCanonical(state);
      window.RPEvents.emit('persona:changed', clone(persona));
      return true;
    }
  };

  window.RPDiagrams = {
    render: function (nodes, edges) {
      nodes = Array.isArray(nodes) ? nodes.slice(0, 40) : [];
      edges = Array.isArray(edges) ? edges.slice(0, 80) : [];
      var width = 720, row = 72, height = Math.max(160, nodes.length * row + 40);
      var positions = {};
      nodes.forEach(function (node, index) { positions[node.id] = { x: index % 2 ? 500 : 80, y: 40 + index * row }; });
      var lines = edges.map(function (edge) {
        var a = positions[edge.from], b = positions[edge.to];
        return a && b ? '<line x1="' + (a.x + 70) + '" y1="' + (a.y + 20) + '" x2="' + (b.x + 70) + '" y2="' + (b.y + 20) + '" stroke="#6f86aa"/>' : '';
      }).join('');
      var boxes = nodes.map(function (node) {
        var p = positions[node.id];
        var label = String(node.label || node.id).replace(/[&<>"]/g, '');
        return '<g><rect x="' + p.x + '" y="' + p.y + '" width="140" height="40" rx="9" fill="#17243b" stroke="#7890b5"/><text x="' + (p.x + 70) + '" y="' + (p.y + 25) + '" text-anchor="middle" fill="#e9f1ff" font-size="13">' + label.slice(0, 18) + '</text></g>';
      }).join('');
      return '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img">' + lines + boxes + '</svg>';
    }
  };

  var randomizer = read('parameter-randomizer', { enabled: false, temperatureMin: 0.7, temperatureMax: 1.0 });
  window.RPParameterRandomizer = {
    settings: function () { return clone(randomizer); },
    configure: function (patch) { randomizer = Object.assign({}, randomizer, clone(patch || {})); return write('parameter-randomizer', randomizer); }
  };

  window.RPLoreCopilot = {
    draft: async function (instruction) {
      var state = window.RPStorage.getCanonical();
      var result = await window.RPModels.generate('state', [
        { role: 'system', content: '根据证据起草卡内世界书补丁提案。只输出 proposal JSON；不得直接提交，不得修改作者锁定条目。' },
        { role: 'user', content: JSON.stringify({ instruction: instruction, revision: state.knowledge.revision, recent: window.RPConversation.list().slice(-12) }) }
      ], { stream: false, temperature: 0.2 });
      return parseJson(result.content, { error: '无法解析提案', raw: result.content });
    }
  };

  window.RPLoreRecommender = {
    inspect: function (query) {
      var result = window.RPWorldbook.retrieve(query || '', { history: window.RPConversation.list(), state: window.RPStorage.getCanonical() });
      var entries = window.RPWorldbook.list();
      var duplicateKeys = {};
      entries.forEach(function (entry) {
        (entry.keys || []).forEach(function (key) {
          var normalized = String(key).toLowerCase();
          if (!duplicateKeys[normalized]) duplicateKeys[normalized] = [];
          duplicateKeys[normalized].push(entry.id);
        });
      });
      return {
        hits: result.hits,
        diagnostics: result.diagnostics,
        duplicateKeys: Object.keys(duplicateKeys).filter(function (key) { return duplicateKeys[key].length > 1; }).map(function (key) { return { key: key, entries: duplicateKeys[key] }; }),
        broadEntries: entries.filter(function (entry) { return (entry.keys || []).some(function (key) { return String(key).length < 2; }); }).map(function (entry) { return entry.id; })
      };
    }
  };

  window.RPPlugins.attach('runtime.prompt-inspector', {});
  window.RPPlugins.attach('runtime.guided-generations', {});
  window.RPPlugins.attach('runtime.character-memory', {});
  window.RPPlugins.attach('runtime.notebook', {
    beforePromptCompile: function (context) {
      var injected = notes.filter(function (note) { return note.inject && note.content; });
      if (injected.length) context.messages.push({ role: 'system', content: '【玩家便签】\n' + injected.map(function (note) { return note.title + '：' + note.content; }).join('\n'), source: 'plugin:notebook' });
      return context;
    }
  });
  window.RPPlugins.attach('runtime.persona-switcher', {});
  window.RPPlugins.attach('runtime.visual-novel', {
    activate: function () { document.documentElement.classList.add('rp-visual-novel'); },
    dispose: function () { document.documentElement.classList.remove('rp-visual-novel'); }
  });
  window.RPPlugins.attach('runtime.diagram', {});
  window.RPPlugins.attach('runtime.parameter-randomizer', {
    beforeRequest: function (context) {
      if (!randomizer.enabled || context.route !== 'narrative') return context;
      var min = Number(randomizer.temperatureMin || 0.7), max = Number(randomizer.temperatureMax || 1);
      context.options.temperature = min + Math.random() * Math.max(0, max - min);
      return context;
    }
  });
  window.RPPlugins.attach('runtime.lore-copilot', {});
  window.RPPlugins.attach('runtime.lore-recommender', {});
})();
