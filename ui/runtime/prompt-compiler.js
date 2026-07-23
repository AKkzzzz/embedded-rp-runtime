(function () {
  'use strict';

  var last = null;

  async function compile(input, options) {
    options = Object.assign({
      history: [],
      state: window.RPStorage.getCanonical(),
      worldbook: {},
      memoryTopK: 8
    }, options || {});
    var started = performance.now();
    var retrieval = window.RPWorldbook.retrieve(input, Object.assign({}, options.worldbook, { state: options.state }));
    var memories = window.RPMemory.searchStructured(input, { topK: options.memoryTopK });
    var presets = window.RPTemplateData.presets
      .filter(function (preset) { return preset.enabled !== false; })
      .sort(function (a, b) { return Number(b.order || 0) - Number(a.order || 0); });
    var messages = [];
    presets.forEach(function (preset) {
      messages.push({ role: preset.role, content: preset.content, source: 'preset:' + preset.id });
    });
    retrieval.hits.forEach(function (hit) {
      messages.push({ role: 'system', content: '【' + hit.name + '】\n' + hit.content, source: 'worldbook:' + hit.id });
    });
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
    (options.history || []).forEach(function (message) {
      messages.push(Object.assign({}, message, { source: message.source || 'history' }));
    });
    messages.push({ role: 'user', content: String(input || ''), source: 'input' });
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
