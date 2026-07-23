(function () {
  'use strict';

  function settings() {
    return Object.assign({
      summaryEnabled: false,
      summaryEveryFloors: 10,
      maxHistoryFloors: 40
    }, window.RPStorage.getPreferences().memoryModules || {});
  }

  async function summarize(messages) {
    var value = settings();
    if (!value.summaryEnabled) return { ok: false, skipped: true };
    var route = window.RPModels.routes().summary;
    var input = (messages || []).slice(0, -Math.max(0, Number(value.maxHistoryFloors) * 2))
      .map(function (message) { return (message.role === 'user' ? '用户：' : '角色卡：') + message.content; })
      .join('\n\n');
    if (!input.trim()) return { ok: false, skipped: true };
    var result = await window.RPModels.generate('summary', [
      { role: 'system', content: '请把以下较早剧情压缩成事实摘要。保留人物关系、地点、物品、承诺、未解决线索和状态变化。只输出摘要正文，不要解释。' },
      { role: 'user', content: input }
    ], { stream: false, temperature: route.temperature });
    var summary = String(result.content || '').trim();
    if (!summary) return { ok: false, error: '总结为空' };
    window.RPMemory.addStructured({
      id: 'summary-' + Date.now().toString(36),
      kind: 'summary',
      title: '历史总结',
      summary: summary,
      sourceIds: [],
      stale: false
    });
    try {
      localStorage.setItem(window.RPTemplateData.app.storagePrefix + ':summary-count', String(messages.length));
    } catch (_error) {}
    return { ok: true, summary: summary };
  }

  window.RPSummary = {
    summarize: summarize,
    shouldSummarize: function (messages) {
      var value = settings();
      var count = (messages || []).length;
      var threshold = Math.max(2, Number(value.maxHistoryFloors) * 2 + 2);
      var last = Number(localStorage.getItem(window.RPTemplateData.app.storagePrefix + ':summary-count') || 0);
      var every = Math.max(2, Number(value.summaryEveryFloors || 10) * 2);
      return value.summaryEnabled && count >= threshold && count - last >= every;
    }
  };
})();
