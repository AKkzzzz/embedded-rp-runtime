(function () {
  'use strict';

  var tools = (window.RPTemplateData && window.RPTemplateData.tools) || [];
  var calls = [];

  function enabled(tool) {
    var configured = window.RPStorage.getPreferences().toolEnabled || {};
    return Object.prototype.hasOwnProperty.call(configured, tool.id)
      ? configured[tool.id] !== false
      : tool.enabled !== false;
  }

  function parse(text) {
    var found = [];
    String(text || '').replace(/<\s*(tool_[a-z0-9_]+)\s*:\s*([\s\S]*?)\s*>/gi, function (_all, name, query) {
      found.push({ name: String(name).toLowerCase(), query: String(query || '').trim() });
      return _all;
    });
    return found.slice(0, 5);
  }

  function definition(name) {
    var base = String(name).toLowerCase().replace(/_(?:add|cover)$/i, '');
    return tools.find(function (tool) {
      return String(tool.callName || tool.id).toLowerCase() === base;
    });
  }

  function randomInt(max) {
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      var bytes = new Uint32Array(1);
      window.crypto.getRandomValues(bytes);
      return (bytes[0] % max) + 1;
    }
    return Math.floor(Math.random() * max) + 1;
  }

  function rollDice(expression) {
    var source = String(expression || '').trim().toLowerCase().replace(/\s+/g, '');
    var modifier = 0;
    var modifierMatch = source.match(/([+-]\d+)$/);
    if (modifierMatch) {
      modifier = Number(modifierMatch[1]);
      source = source.slice(0, -modifierMatch[1].length);
    }
    var match = source.match(/^(\d*)d(\d+)$/);
    if (!match) return { ok: false, error: '骰式格式应为 NdM、d20 或 NdM+修正' };
    var count = Math.max(1, Math.min(100, Number(match[1] || 1)));
    var sides = Math.max(2, Math.min(1000, Number(match[2])));
    var rolls = [];
    for (var i = 0; i < count; i += 1) rolls.push(randomInt(sides));
    return { ok: true, expression: expression, rolls: rolls, modifier: modifier, total: rolls.reduce(function (sum, value) { return sum + value; }, modifier) };
  }

  async function execute(call, context) {
    var tool = definition(call.name);
    if (!tool || !enabled(tool)) return { call: call, status: 'disabled', content: '该工具未启用。' };
    if (tool.type === 'vector_memory' && window.RPMemory) {
      var rows = await window.RPMemory.searchVectors(call.query, { topK: tool.resultCount || 5 });
      return { call: call, mode: /_cover$/i.test(call.name) ? 'cover' : 'add', status: 'ok', content: rows.map(function (row) { return row.sourceText || row.summary || ''; }).filter(Boolean).join('\n') || '没有找到相关向量记忆。' };
    }
    if (tool.type === 'dice') {
      var result = rollDice(call.query);
      return { call: call, mode: 'add', status: result.ok ? 'ok' : 'invalid', content: result.ok
        ? '骰式 ' + result.expression + '：[' + result.rolls.join(', ') + '] ' + (result.modifier ? (result.modifier > 0 ? '+ ' : '- ') + Math.abs(result.modifier) + '，' : '') + '结果 = ' + result.total
        : result.error };
    }
    if (tool.type === 'keyword_dialogue') {
      var messages = window.RPConversation ? window.RPConversation.list() : [];
      var query = call.query.toLowerCase();
      var rows = messages.filter(function (message) { return String(message.content || '').toLowerCase().includes(query); });
      return { call: call, mode: /_cover$/i.test(call.name) ? 'cover' : 'add', status: 'ok', content: rows.slice(-tool.resultCount || -5).map(function (row) {
        return '[' + row.role + '] ' + row.content;
      }).join('\n') || '没有找到包含该关键词的对话片段。' };
    }
    return { call: call, mode: /_cover$/i.test(call.name) ? 'cover' : 'add', status: 'unavailable', content: '联网工具需要宿主提供受控的搜索能力；当前卡内运行时未启用外部搜索。' };
  }

  async function run(text, context) {
    var parsed = parse(text);
    if (!parsed.length) return { calls: [], prompt: '' };
    var results = [];
    for (var i = 0; i < parsed.length; i += 1) results.push(await execute(parsed[i], context));
    calls = calls.concat(results).slice(-20);
    var prompt = '<active_tool_results>\n' + results.map(function (result) {
      return '<active_tool_result name="' + result.call.name + '" mode="' + (result.mode || 'add') + '" status="' + result.status + '" query="' +
        result.call.query.replace(/"/g, '&quot;') + '">\n' + result.content + '\n</active_tool_result>';
    }).join('\n\n') + '\n</active_tool_results>';
    return { calls: results, prompt: prompt };
  }

  window.RPTools = {
    list: function () { return tools.map(function (tool) { return Object.assign({}, tool, { enabled: enabled(tool) }); }); },
    setEnabled: function (id, value) {
      var next = Object.assign({}, window.RPStorage.getPreferences().toolEnabled || {});
      next[id] = Boolean(value);
      window.RPStorage.savePreferences({ toolEnabled: next });
    },
    parse: parse,
    run: run,
    calls: function () { return JSON.parse(JSON.stringify(calls)); }
  };
})();
