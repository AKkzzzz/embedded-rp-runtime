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

  async function execute(call, context) {
    var tool = definition(call.name);
    if (!tool || !enabled(tool)) return { call: call, status: 'disabled', content: '该工具未启用。' };
    if (tool.type === 'vector_memory' && window.RPMemory) {
      var rows = await window.RPMemory.searchVectors(call.query, { topK: tool.resultCount || 5 });
      return { call: call, mode: /_cover$/i.test(call.name) ? 'cover' : 'add', status: 'ok', content: rows.map(function (row) { return row.sourceText || row.summary || ''; }).filter(Boolean).join('\n') || '没有找到相关向量记忆。' };
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
