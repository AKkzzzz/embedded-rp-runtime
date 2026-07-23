(function () {
  'use strict';

  function settings() {
    return Object.assign({
      summaryEnabled: false,
      summaryEveryFloors: 10,
      maxHistoryFloors: 40
    }, window.RPStorage.getPreferences().memoryModules || {});
  }

  function turns(messages) {
    var output = [];
    for (var i = 0; i < (messages || []).length - 1; i += 1) {
      if (messages[i].role === 'user' && messages[i + 1].role === 'assistant') {
        output.push({ turn: output.length + 1, user: messages[i], assistant: messages[i + 1] });
        i += 1;
      }
    }
    return output;
  }

  function hasSummary(target) {
    return window.RPMemory.listStructured().some(function (memory) {
      return memory.kind === 'classicMemory' &&
        (memory.sourceIds || []).includes(target.assistant.id);
    });
  }

  async function summarize(messages) {
    var value = settings();
    if (!value.summaryEnabled) return { ok: false, skipped: true };
    var allTurns = turns(messages);
    var keep = Math.max(0, Number(value.maxHistoryFloors || 40));
    var candidates = keep > 0 ? allTurns.slice(0, -keep) : [];
    var target = candidates.find(function (turn) { return !hasSummary(turn); });
    if (!target) return { ok: false, skipped: true };
    var route = window.RPModels.routes().summary;
    var context = allTurns.slice(Math.max(0, target.turn - 4), target.turn + 1);
    var request = [{
      role: 'system',
      content: '你负责逐轮长期记忆。只总结标记为“最新对话：唯一总结目标”的一组；历史背景只用于理解。保留人物行动、关键话语含义、关系与立场变化、时间地点、物品、秘密、决定、承诺、冲突、计划和未解决事项。严格区分事实、猜测、隐瞒与未知。使用紧凑客观的第三人称，只输出总结正文。'
    }];
    context.forEach(function (turn) {
      var marker = turn === target ? '最新对话：唯一总结目标' : '历史背景：仅供理解';
      request.push({ role: 'user', content: '【' + marker + '｜第 ' + turn.turn + ' 轮】\n' + turn.user.content });
      request.push({ role: 'assistant', content: '【' + marker + '｜第 ' + turn.turn + ' 轮】\n' + turn.assistant.content });
    });
    request.push({ role: 'user', content: '只总结最后一组“最新对话：唯一总结目标”，不要总结历史背景。' });
    var result = await window.RPModels.generate('summary', request, { stream: false, temperature: route.temperature });
    var summary = String(result.content || '').trim();
    if (!summary) return { ok: false, error: '总结为空' };
    window.RPMemory.addStructured({
      id: 'classic-' + target.turn + '-' + Date.now().toString(36),
      kind: 'classicMemory',
      title: '第 ' + target.turn + ' 轮记忆',
      summary: summary,
      sourceIds: [target.user.id, target.assistant.id],
      turn: target.turn,
      sourceUserText: target.user.content,
      sourceAssistantText: target.assistant.content,
      stale: false
    });
    try {
      localStorage.setItem(window.RPTemplateData.app.storagePrefix + ':summary-count', String(allTurns.length));
    } catch (_error) {}
    return { ok: true, summary: summary, turn: target.turn };
  }

  window.RPSummary = {
    summarize: summarize,
    contextHistory: function (messages, keepFloors) {
      var allTurns = turns(messages);
      var keep = Math.max(0, Number(keepFloors || 0));
      var rawStart = keep > 0 ? Math.max(0, allTurns.length - keep) : 0;
      var memories = window.RPMemory.listStructured().filter(function (memory) {
        return memory.kind === 'classicMemory' && memory.stale !== true;
      });
      var output = [];
      allTurns.forEach(function (turn, index) {
        if (index >= rawStart) {
          output.push(turn.user, turn.assistant);
          return;
        }
        var memory = memories.find(function (item) {
          return (item.sourceIds || []).includes(turn.assistant.id);
        });
        if (memory) {
          output.push(turn.user);
          output.push(Object.assign({}, turn.assistant, {
            content: memory.summary,
            source: 'memory:classic:' + memory.id
          }));
        }
      });
      return output;
    },
    shouldSummarize: function (messages) {
      var value = settings();
      var count = turns(messages).length;
      var threshold = Math.max(1, Number(value.maxHistoryFloors) + 1);
      var last = Number(localStorage.getItem(window.RPTemplateData.app.storagePrefix + ':summary-count') || 0);
      var every = Math.max(1, Number(value.summaryEveryFloors || 10));
      return value.summaryEnabled && count >= threshold && count - last >= every;
    }
  };
})();
