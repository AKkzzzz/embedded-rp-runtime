(function () {
  'use strict';

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function stripThought(text) {
    return String(text || '')
      .replace(/<\s*(?:cot|think|thinking|reasoning)\s*>[\s\S]*?<\s*\/\s*(?:cot|think|thinking|reasoning)\s*>/gi, '')
      .trim();
  }

  function parse(raw) {
    var source = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { return JSON.parse(source); } catch (_error) {}
    var start = source.indexOf('{');
    var end = source.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(source.slice(start, end + 1)); } catch (_error2) {}
    }
    return null;
  }

  function pathParts(path) {
    return String(path || '').split('.').map(function (part) { return part.trim(); }).filter(Boolean);
  }

  function setPath(target, path, value) {
    var parts = pathParts(path);
    if (!parts.length) return clone(value);
    var cursor = target;
    parts.slice(0, -1).forEach(function (part) {
      if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) cursor[part] = {};
      cursor = cursor[part];
    });
    cursor[parts[parts.length - 1]] = clone(value);
    return target;
  }

  function normalizeUpdates(parsed) {
    if (Array.isArray(parsed)) return [{ variables: parsed, reason: '' }];
    if (!parsed || typeof parsed !== 'object') return [];
    if (Array.isArray(parsed.updates)) return parsed.updates.filter(function (item) {
      return item && typeof item === 'object' && item.variables && typeof item.variables === 'object';
    });
    if (parsed.variables && typeof parsed.variables === 'object') {
      return [{ id: parsed.id, variables: parsed.variables, reason: parsed.reason || '' }];
    }
    return [{ variables: parsed, reason: '' }];
  }

  async function updateFromChat(messages) {
    var state = window.RPStorage.getCanonical();
    var templates = Array.isArray(state.uiTemplates) ? state.uiTemplates : [];
    var active = templates.filter(function (template) { return template && template.enabled !== false && template.id; });
    if (!active.length || !window.RPModels || !window.RPModels.generate) {
      return { ok: false, skipped: true, reason: active.length ? 'model-unavailable' : 'no-active-template' };
    }
    var list = (messages || []).filter(function (message) {
      return message && (message.role === 'user' || message.role === 'assistant');
    }).slice(-8).map(function (message) {
      return { role: message.role, content: stripThought(message.content).slice(-12000) };
    });
    var result;
    try {
      result = await window.RPModels.generate('state', [
        {
          role: 'system',
          content: '你是RP-Hub UI Template状态副模型。只根据已经发生的对话更新启用模板变量。只返回JSON：{"updates":[{"id":"模板id","variables":{"路径":"新值"},"reason":"简短理由"}]}。不要输出正文、推理、Markdown、预测或未发生的计划。没有变化返回{"updates":[]}。'
        },
        {
          role: 'user',
          content: JSON.stringify({
            templates: active.map(function (template) {
              return {
                id: template.id,
                name: template.name || '',
                variables: template.variableState || template.initialVariableState || {},
                schema: template.variableSchema || null
              };
            }),
            recentMessages: list
          })
        }
      ], { stream: false, temperature: 0.05, monitor: false });
    } catch (error) {
      window.RPEvents.emit('ui-template:sync', { ok: false, reason: String(error.message || error) });
      return { ok: false, reason: String(error.message || error) };
    }
    var updates = normalizeUpdates(parse(result && result.content));
    var changed = [];
    active.forEach(function (template) {
      var update = updates.find(function (item) { return !item.id || item.id === template.id; });
      if (!update) return;
      var before = clone(template.variableState || template.initialVariableState || {});
      var next = clone(before);
      Object.keys(update.variables || {}).forEach(function (key) {
        if (key === '$root') next = clone(update.variables[key]);
        else setPath(next, key, update.variables[key]);
      });
      if (JSON.stringify(before) === JSON.stringify(next)) return;
      template.variableState = next;
      if (!Array.isArray(template.changeLog)) template.changeLog = [];
      template.changeLog.unshift({
        id: 'ui-sync-' + Date.now().toString(36),
        time: Date.now(),
        source: 'ai',
        route: 'state',
        changes: { from: before, to: next },
        reason: String(update.reason || '').slice(0, 500)
      });
      template.changeLog = template.changeLog.slice(0, 50);
      changed.push(template.id);
    });
    if (!changed.length) {
      window.RPEvents.emit('ui-template:sync', { ok: true, changed: [] });
      return { ok: true, changed: [] };
    }
    var patched = window.RPStateGuard.applyPatch(
      state,
      { uiTemplates: templates },
      window.RPTemplateData.stateSchema
    );
    if (!patched.ok) {
      window.RPEvents.emit('ui-template:sync', { ok: false, errors: patched.errors });
      return { ok: false, errors: patched.errors };
    }
    window.RPStorage.saveCanonical(patched.value);
    window.RPEvents.emit('ui-template:sync', { ok: true, changed: changed });
    return { ok: true, changed: changed };
  }

  window.RPUIStateSync = {
    list: function () { return clone(window.RPStorage.getCanonical().uiTemplates || []); },
    updateFromChat: updateFromChat
  };
})();
