(function () {
  'use strict';
  var lastConfigCheck = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function page(id) {
    return document.querySelector('[data-debug-page="' + id + '"]');
  }

  function badge(value, type) {
    return '<span class="badge ' + (type || '') + '">' + escapeHtml(value) + '</span>';
  }

  function pageHead(title, description, action) {
    return '<header class="page-head"><div><p class="eyebrow">RUNTIME INSPECTOR</p><h2>' +
      escapeHtml(title) + '</h2><p>' + escapeHtml(description) + '</p></div>' + (action || '') + '</header>';
  }

  function downloadJson(name, value) {
    var blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function renderOverview() {
    var target = page('overview');
    var diagnostic = window.RPDiagnostics.snapshot();
    var worldbook = diagnostic.worldbook;
    var memory = diagnostic.memory;
    var checkHtml = lastConfigCheck
      ? '<article class="debug-card wide"><p class="eyebrow">CONFIG CHECK</p><h3>' +
        escapeHtml(lastConfigCheck.ok ? 'RP-Hub 配置可以直接继承' : '配置仍需补全') +
        '</h3><p class="muted">' + escapeHtml(lastConfigCheck.detail) + '</p></article>'
      : '';
    var capabilityCount = Object.keys(diagnostic.host).filter(function (key) {
      return diagnostic.host[key] === true;
    }).length;
    target.innerHTML = pageHead(
      '运行时总览',
      '这里显示卡内内核是否具备开始应用所需的基础能力。Debug 模式不会推进故事。',
      '<button type="button" class="secondary" id="refreshRuntimeConfig">检查 RP-Hub 配置</button>'
    ) +
      '<div class="card-grid">' +
        '<article class="debug-card"><p class="eyebrow">HOST</p><div class="metric"><span>增强能力</span><strong>' + capabilityCount + '</strong></div><p class="tiny">' + escapeHtml(diagnostic.host.host) + '</p></article>' +
        '<article class="debug-card"><p class="eyebrow">WORLDBOOK</p><div class="metric"><span>启用条目</span><strong>' + worldbook.enabled + '/' + worldbook.total + '</strong></div><p class="tiny">递归和预算由卡内引擎处理</p></article>' +
        '<article class="debug-card"><p class="eyebrow">MEMORY</p><div class="metric"><span>向量覆盖率</span><strong>' + memory.vectorCoverage + '%</strong></div><p class="tiny">' + memory.structured + ' 条结构化记忆</p></article>' +
        '<article class="debug-card wide"><p class="eyebrow">STARTUP GATE</p><h3>Debug 后台 → 选择应用 → Renderer 接管</h3><p class="muted">底层服务不会因切换表现层而重建。Galgame、电子书和战棋共用相同的世界书、状态、记忆、模型路由与插件生命周期。</p></article>' +
        '<article class="debug-card wide"><p class="eyebrow">PORTABLE SAVE</p><h3>完整存档</h3><p class="muted">导出或恢复人物、剧情、完整对话、记忆、向量与本地设置。</p><div class="control-line"><button type="button" class="secondary" data-overview-import-save>导入存档</button><button type="button" class="secondary" data-overview-export-save>导出存档</button></div></article>' +
        '<article class="debug-card wide"><p class="eyebrow">IN-GAME DEBUG</p><h3>游戏内调试浮球</h3><p class="muted">只控制调试浮球和监视面板的显示，不改变剧情、状态或模型请求。</p><div class="control-line"><button type="button" class="secondary" id="overviewDebugToggle">' +
          (window.RPStorage.debugEnabled && window.RPStorage.debugEnabled() ? '关闭调试浮球' : '开启调试浮球') + '</button></div></article>' +
        checkHtml +
      '</div>';
    target.querySelector('#refreshRuntimeConfig').onclick = async function () {
      this.disabled = true;
      await window.RPHost.refresh();
      await window.RPModels.refreshModels();
      await window.RPVectorMemory.init();
      var settings = window.RPHost.settings();
      var memorySettings = window.RPStorage.getPreferences().memoryModules || {};
      var missing = [];
      if (!settings) missing.push('API 配置');
      if (!window.RPHost.resolveModel('current')) missing.push('主模型');
      if (memorySettings.vectorEnabled && !window.RPHost.resolveModel('embedding', window.RPModels.routes().embedding.model)) missing.push('向量模型');
      if (memorySettings.summaryEnabled && !window.RPHost.resolveModel('summarize', window.RPModels.routes().summary.model)) missing.push('总结模型');
      lastConfigCheck = {
        ok: missing.length === 0 && window.RPModels.models().length > 0,
        detail: missing.length ? '缺少：' + missing.join('、') : 'API、模型列表和当前启用模块的模型继承均正常。'
      };
      this.disabled = false;
      renderAll();
    };
    target.querySelector('[data-overview-import-save]').onclick = function () {
      document.getElementById('importSaveButton').click();
    };
    target.querySelector('[data-overview-export-save]').onclick = function () {
      document.getElementById('exportSaveButton').click();
    };
    target.querySelector('#overviewDebugToggle').onclick = function () {
      var enabled = window.RPStorage.debugEnabled && window.RPStorage.debugEnabled();
      if (window.RPDebugOverlay && window.RPDebugOverlay.setEnabled) window.RPDebugOverlay.setEnabled(!enabled);
      else window.RPStorage.savePreferences({ debugEnabled: !enabled });
      renderOverview();
    };
  }

  function renderMonitor(actionOutput) {
    var target = page('monitor');
    if (!target) return;
    var monitor = window.RPGenerationMonitor ? window.RPGenerationMonitor.snapshot() : {};
    var prompt = window.RPPromptInspector ? window.RPPromptInspector.snapshot() : {};
    var mainTrace = window.RPConversation && window.RPConversation.debugTrace ? window.RPConversation.debugTrace() : null;
    var stateTrace = window.RPUIStateSync && window.RPUIStateSync.trace ? window.RPUIStateSync.trace() : null;
    var phaseLabels = { idle: '待机', starting: '请求已发送', thinking: '模型正在思考', writing: '模型正在输出正文', complete: '生成完成', stopped: '已停止', error: '生成错误' };
    var pluginRows = [
      ['提示词检查器', '悬浮球 / 诊断页', 'runtime.prompt-inspector'],
      ['引导行动建议', '本页“生成行动建议”', 'runtime.guided-generations'],
      ['角色长期记忆', '本页“提取角色记忆” / 记忆页', 'runtime.character-memory'],
      ['便签', '悬浮球', 'runtime.notebook'],
      ['动态世界书', '世界书页待审提案', 'runtime.dynamic-lore'],
      ['生图', '生图页', 'runtime.image-generation'],
      ['命令与骰子', '游戏输入框 / 工具页', 'runtime.command-registry']
    ].map(function (row) {
      var enabled = window.RPPlugins.isEnabled(row[2]);
      return '<div class="data-row"><div><strong>' + escapeHtml(row[0]) + '</strong><div class="tiny">' +
        escapeHtml(row[2]) + '</div></div><div class="muted">' + escapeHtml(row[1]) + '</div>' +
        badge(enabled ? '可用' : '关闭', enabled ? 'ok' : 'warn') + '</div>';
    }).join('');
    var canRetry = monitor.phase === 'error' && window.RPConversation &&
      window.RPConversation.canRetryLastGeneration && window.RPConversation.canRetryLastGeneration();
    var retryCard = canRetry
      ? '<article class="debug-card wide"><p class="eyebrow">RECOVERY</p><h3>本次主叙事请求可以安全重试</h3>' +
        '<p class="muted">复用同一条玩家输入与生成前历史，不会再追加一条玩家消息，也不会重复应用状态结算。</p>' +
        '<div class="control-line"><button type="button" class="primary" id="retryGenerationButton">重试 / 重roll 本次请求</button></div></article>'
      : '';
    target.innerHTML = pageHead(
      '实时生成与能力入口',
      '悬浮球提供轻量实时监视；这里保留完整模型状态、宿主返回的 reasoning/thinking、正文流、提示词来源和调试动作。'
    ) + '<div class="card-grid">' + retryCard +
      '<article class="debug-card"><p class="eyebrow">PHASE</p><h3>' + escapeHtml(phaseLabels[monitor.phase] || monitor.phase || '待机') + '</h3><p class="tiny">' + escapeHtml((monitor.route || '尚未请求') + (monitor.model ? ' · ' + monitor.model : '')) + '</p></article>' +
      '<article class="debug-card"><div class="metric"><span>思考内容</span><strong>' + Number(monitor.reasoningChars || 0) + '</strong></div><p class="tiny">宿主 reasoning/thinking 字符</p></article>' +
      '<article class="debug-card"><div class="metric"><span>正文输出</span><strong>' + Number(monitor.contentChars || 0) + '</strong></div><p class="tiny">当前请求累计字符</p></article>' +
      '<article class="debug-card"><div class="metric"><span>提示词</span><strong>' + Number(prompt.charCount || 0) + '</strong></div><p class="tiny">世界书 ' + (prompt.worldbookHits || []).length + ' · 记忆 ' + (prompt.memoryHits || []).length + '</p></article>' +
      '<article class="debug-card wide"><p class="eyebrow">MAIN MODEL REASONING</p><pre>' + escapeHtml(mainTrace && mainTrace.reasoning || monitor.reasoning || '当前模型尚未返回 reasoning/thinking 字段。') + '</pre></article>' +
      '<article class="debug-card wide"><p class="eyebrow">MAIN MODEL RESPONSE</p><pre>' + escapeHtml(mainTrace && mainTrace.response || monitor.content || '当前还没有正文流。') + '</pre></article>' +
      '<article class="debug-card wide"><p class="eyebrow">MAIN MODEL PROMPT</p><pre>' + escapeHtml(JSON.stringify(mainTrace && mainTrace.prompt || prompt || {}, null, 2)) + '</pre></article>' +
      '<article class="debug-card wide"><p class="eyebrow">PROMPT SOURCES</p><pre>' + escapeHtml(JSON.stringify(window.RPPromptInspector ? window.RPPromptInspector.sources() : [], null, 2)) + '</pre></article>' +
      '<article class="debug-card wide"><p class="eyebrow">WORLDBOOK HITS</p><pre>' + escapeHtml(JSON.stringify(prompt.worldbookHits || [], null, 2)) + '</pre></article>' +
      '<article class="debug-card wide"><p class="eyebrow">STATE MODEL PROMPT</p><pre>' + escapeHtml(JSON.stringify(stateTrace && stateTrace.prompt || [], null, 2)) + '</pre></article>' +
      '<article class="debug-card wide"><p class="eyebrow">STATE MODEL RESPONSE</p><pre>' + escapeHtml(stateTrace ? JSON.stringify(stateTrace, null, 2) : '状态副模型尚未运行。') + '</pre></article>' +
      '<article class="debug-card wide"><p class="eyebrow">CAPABILITY REACHABILITY</p><div class="row-list">' + pluginRows + '</div>' +
        '<div class="control-line" style="margin-top:10px"><button id="debugSuggestions">生成行动建议</button><button id="debugCharacterMemory">提取并保存角色记忆</button></div>' +
        '<pre id="debugCapabilityOutput">' + escapeHtml(actionOutput || '这里的按钮会实际调用对应插件，用于确认能力不是“只注册、无入口”。') + '</pre></article></div>';
    var retryButton = target.querySelector('#retryGenerationButton');
    if (retryButton) retryButton.onclick = async function () {
      this.disabled = true;
      this.textContent = '重试中…';
      try {
        await window.RPConversation.retryLastGeneration();
        renderMonitor('失败请求已重试完成。');
      } catch (error) {
        renderMonitor('重试失败：' + String(error && error.message || error));
      }
    };
    target.querySelector('#debugSuggestions').onclick = async function () {
      this.disabled = true;
      try { renderMonitor(JSON.stringify(await window.RPGuided.suggest(3), null, 2)); }
      catch (error) { renderMonitor('行动建议失败：' + String(error.message || error)); }
    };
    target.querySelector('#debugCharacterMemory').onclick = async function () {
      this.disabled = true;
      try {
        var rows = await window.RPCharMemory.extract();
        var saved = rows.filter(function (row) { return row && row.character && row.summary; }).map(function (row) {
          return window.RPCharMemory.add(row.character, row.summary, row.sourceIds, row.tags);
        });
        renderMonitor(JSON.stringify({ extracted: rows, saved: saved.length }, null, 2));
      } catch (error) { renderMonitor('角色记忆提取失败：' + String(error.message || error)); }
    };
  }

  function renderModels() {
    var target = page('models');
    var caps = window.RPHost.capabilities();
    var settings = window.RPHost.settings();
    var generation = settings && settings.generationParameters || {};
    var routes = window.RPModels.routes();
    var availableModels = window.RPModels.models();
    var rows = Object.keys(routes).map(function (id) {
      var route = routes[id];
      var available = id === 'embedding' ? caps.embeddings : caps.generation;
      var resolved = window.RPHost.resolveModel(route.inherit, route.model);
      var routeModels = id === 'embedding' && window.RPModels.embeddingModels
        ? window.RPModels.embeddingModels()
        : availableModels;
      var options = '<option value="">继承 RP-Hub' + (resolved ? '：' + escapeHtml(resolved) : '（未选择）') + '</option>' +
        routeModels.map(function (model) {
          var modelId = String(model.id || model.name || '');
          return '<option value="' + escapeHtml(modelId) + '" ' + (route.model === modelId ? 'selected' : '') + '>' + escapeHtml(modelId) + '</option>';
        }).join('');
      if (id === 'embedding' && route.model && !routeModels.some(function (model) { return String(model.id || model.name || '') === route.model; })) {
        options += '<option value="' + escapeHtml(route.model) + '" selected disabled>当前覆盖待验证：' + escapeHtml(route.model) + '</option>';
      }
      return '<div class="data-row"><div><strong>' + escapeHtml(route.label) + '</strong><div class="tiny">' + escapeHtml(id) + '</div></div>' +
        '<div><select data-model-route="' + escapeHtml(id) + '">' + options + '</select><div class="tiny">' + (route.model ? '卡内覆盖' : '继承 RP-Hub') + '</div></div>' +
        badge(available ? '直连可用' : '等待设置', available ? 'ok' : 'warn') + '</div>';
    }).join('');
    function inheritedValue(value) {
      if (value === undefined || value === null || value === '') return '未提供';
      return Array.isArray(value) || typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
    var generationRows = [
      ['top_p', generation.topP],
      ['max_tokens', generation.maxTokens],
      ['max_completion_tokens', generation.maxCompletionTokens],
      ['frequency_penalty', generation.frequencyPenalty],
      ['presence_penalty', generation.presencePenalty],
      ['stop', generation.stop],
      ['reasoning_effort', generation.reasoningEffort],
      ['provider parameters', generation.providerParameters && Object.keys(generation.providerParameters).length ? generation.providerParameters : null]
    ].map(function (entry) {
      return '<div class="data-row"><div><strong>' + escapeHtml(entry[0]) + '</strong></div><code>' + escapeHtml(inheritedValue(entry[1])) + '</code></div>';
    }).join('');
    target.innerHTML = pageHead(
      '模型路由',
      '运行时从同源 RP-Hub 设置读取当前端点、模型与生成参数；密钥只留在请求闭包，不进入诊断、存档或界面。',
      '<button type="button" class="secondary" id="refreshModels">刷新模型</button>'
    ) + '<div class="card-grid" style="margin-bottom:10px">' +
      '<article class="debug-card"><div class="metric"><span>配置状态</span><strong>' + (caps.sameOriginSettings ? 'READY' : 'WAIT') + '</strong></div></article>' +
      '<article class="debug-card"><div class="metric"><span>可见模型</span><strong>' + window.RPModels.models().length + '</strong></div></article>' +
      '<article class="debug-card"><div class="tiny">端点</div><code>' + escapeHtml(settings && settings.apiUrl || '未读取') + '</code></article>' +
      '</div><div class="debug-card"><div class="row-list">' + rows + '</div></div>' +
      '<div class="debug-card" style="margin-top:10px"><p class="eyebrow">INHERITED GENERATION PARAMETERS</p><div class="row-list">' + generationRows + '</div></div>';
    target.querySelector('#refreshModels').onclick = async function () {
      this.disabled = true;
      await window.RPHost.refresh();
      await window.RPModels.refreshModels();
      this.disabled = false;
      renderModels();
    };
    target.querySelectorAll('[data-model-route]').forEach(function (select) {
      select.onchange = async function () {
        var routeId = select.dataset.modelRoute;
        if (routeId !== 'embedding' || !select.value) {
          window.RPModels.setRoute(routeId, { model: select.value });
          renderModels();
          return;
        }
        select.disabled = true;
        try {
          await window.RPModels.testEmbeddingModel(select.value);
          window.RPModels.setRoute(routeId, { model: select.value });
          renderModels();
        } catch (error) {
          select.disabled = false;
          await window.RPDialog.alert('该模型未通过向量接口校验，不会保存：\n' + String(error.message || error));
          renderModels();
        }
      };
    });
  }

  function triggerSummary(entry) {
    var trigger = entry.trigger || {};
    if (trigger.type === 'constant') return '常驻';
    if (trigger.type === 'literal') return '字面：' + (trigger.keys || []).join(' / ');
    if (trigger.type === 'regex') return '正则：' + (trigger.patterns || []).join(' / ');
    if (trigger.type === 'state') return '状态：' + trigger.path;
    if (trigger.type === 'semantic') return '语义向量';
    return trigger.type || '无';
  }

  function renderWorldbook(result) {
    var target = page('worldbook');
    var entries = window.RPWorldbook.list();
    var knowledge = window.RPStorage.getCanonical().knowledge;
    var proposals = window.RPWorldbookPatches.proposals();
    var rows = entries.map(function (entry) {
      return '<div class="data-row"><div><strong>' + escapeHtml(entry.name) + '</strong><div class="tiny">' + escapeHtml(entry.id) + '</div></div>' +
        '<div><div>' + escapeHtml(triggerSummary(entry)) + '</div><div class="tiny">依赖 ' + escapeHtml((entry.dependencies || []).join(', ') || '无') + ' · ' + escapeHtml(entry.placement) + '</div></div>' +
        '<div><button type="button" class="toggle" data-worldbook-toggle="' + escapeHtml(entry.id) + '">' + (entry.runtimeEnabled ? '启用' : '关闭') + '</button><button type="button" class="toggle" data-worldbook-edit="' + escapeHtml(entry.id) + '">编辑</button>' + (entry.builtin && entry.edited ? '<button type="button" class="toggle" data-worldbook-restore="' + escapeHtml(entry.id) + '">恢复原文</button>' : '') + '</div></div>';
    }).join('');
    var resultHtml = result ? '<article class="debug-card wide"><p class="eyebrow">SCAN RESULT</p><h3>命中 ' + result.hits.length + ' 条 · ' + result.usedChars + ' 字符</h3><pre>' +
      escapeHtml(JSON.stringify({ hits: result.hits, diagnostics: result.diagnostics }, null, 2)) + '</pre></article>' : '';
    target.innerHTML = pageHead(
      '世界书与扫描规则',
      '兼容 RP-Hub 的历史扫描、概率与七类位置；显式依赖可递归展开，并受深度、去重和可选预算限制。',
      '<button type="button" class="secondary" id="importWorldbook">导入 RP-Hub</button>' +
      '<input id="worldbookImportFile" type="file" accept=".json,application/json" hidden>' +
      '<button type="button" class="secondary" id="exportWorldbook">导出全部</button><button type="button" class="secondary" id="newWorldbookEntry">新增本地条目</button>'
    ) +
      '<div class="card-grid" style="margin-bottom:10px"><article class="debug-card"><div class="metric"><span>知识库修订</span><strong>' + knowledge.revision + '</strong></div></article>' +
      '<article class="debug-card"><div class="metric"><span>运行时条目</span><strong>' + knowledge.entries.length + '</strong></div></article>' +
      '<article class="debug-card"><div class="metric"><span>待审提案</span><strong>' + proposals.filter(function (item) { return item.status === 'pending'; }).length + '</strong></div></article></div>' +
      '<div class="control-line"><input id="worldbookQuery" value="我想检查世界书递归扫描" aria-label="模拟扫描文本"><button id="scanWorldbook">模拟扫描</button></div>' +
      '<div class="debug-card"><div class="row-list">' + rows + '</div></div><div class="debug-card" id="worldbookEditor" hidden><div class="control-line"><input id="worldbookEditName" placeholder="条目名称"><input id="worldbookEditKeys" placeholder="关键词，用逗号分隔"></div><textarea id="worldbookEditContent" rows="8" style="width:100%" placeholder="条目内容"></textarea><div class="control-line"><button id="saveWorldbookEntry" class="primary">保存本地条目</button><button id="removeWorldbookEntry" class="secondary">删除</button></div></div><div class="card-grid">' + resultHtml + '</div>';
    target.querySelector('#importWorldbook').onclick = function () {
      target.querySelector('#worldbookImportFile').click();
    };
    target.querySelector('#worldbookImportFile').onchange = async function () {
      var file = this.files && this.files[0];
      if (!file) return;
      try {
        var imported = window.RPWorldbook.importRpHub(JSON.parse(await file.text()));
        if (!imported.ok) throw new Error(imported.errors.join('；') || '没有可导入条目');
        renderWorldbook();
      } catch (error) {
        await window.RPDialog.alert('世界书导入失败：' + error.message);
      }
    };
    target.querySelector('#exportWorldbook').onclick = function () {
      downloadJson('worldbook.json', { entries: window.RPWorldbook.exportRpHub() });
    };
    var editor = target.querySelector('#worldbookEditor');
    var editingId = '';
    function openEditor(entry) {
      editingId = entry && entry.id || '';
      editor.hidden = false;
      target.querySelector('#removeWorldbookEntry').hidden = Boolean(entry && !entry.local);
      target.querySelector('#worldbookEditName').value = entry ? entry.name : '';
      target.querySelector('#worldbookEditKeys').value = entry ? (entry.keys || []).join(', ') : '';
      target.querySelector('#worldbookEditContent').value = entry ? entry.content : '';
    }
    target.querySelector('#newWorldbookEntry').onclick = function () { openEditor(null); };
    target.querySelectorAll('[data-worldbook-edit]').forEach(function (button) { button.onclick = function () { openEditor(window.RPWorldbook.byId(button.dataset.worldbookEdit)); }; });
    target.querySelector('#saveWorldbookEntry').onclick = function () {
      var data = { name: target.querySelector('#worldbookEditName').value.trim(), content: target.querySelector('#worldbookEditContent').value.trim(), keys: target.querySelector('#worldbookEditKeys').value.split(/[,，]/).map(function (v) { return v.trim(); }).filter(Boolean), trigger: { type: 'literal', keys: target.querySelector('#worldbookEditKeys').value.split(/[,，]/).map(function (v) { return v.trim(); }).filter(Boolean) } };
      var result = editingId ? window.RPWorldbook.update(editingId, data) : window.RPWorldbook.createLocal(data);
      if (!result.ok) { window.RPDialog.alert('保存失败：' + String(result.error || (result.errors || []).join('；'))); return; }
      renderWorldbook();
    };
    target.querySelector('#removeWorldbookEntry').onclick = function () { if (!editingId) return; var result = window.RPWorldbook.removeLocal(editingId); if (!result.ok) window.RPDialog.alert((result.errors || [result.error]).join('；')); else renderWorldbook(); };
    target.querySelectorAll('[data-worldbook-restore]').forEach(function (button) { button.onclick = function () { window.RPWorldbook.restoreBuiltin(button.dataset.worldbookRestore); renderWorldbook(); }; });
    target.querySelectorAll('[data-worldbook-toggle]').forEach(function (button) {
      button.onclick = function () {
        var entry = window.RPWorldbook.byId(button.dataset.worldbookToggle);
        var runtimeEntry = window.RPWorldbook.list().find(function (item) { return item.id === entry.id; });
        window.RPWorldbook.setEnabled(entry.id, !runtimeEntry.runtimeEnabled);
        renderWorldbook(result);
      };
    });
    target.querySelector('#scanWorldbook').onclick = function () {
      renderWorldbook(window.RPWorldbook.retrieve(target.querySelector('#worldbookQuery').value));
    };
  }

  function renderState() {
    var target = page('state');
    var current = window.RPStorage.getCanonical();
    var validation = window.RPStateGuard.validate(current, window.RPTemplateData.stateSchema);
    target.innerHTML = pageHead(
      '变量与事务校验',
      '未知字段、错误类型、非法枚举、越界值和只读字段会在写入前被拒绝；数组更新采用显式整体替换。'
    ) +
      '<div class="card-grid"><article class="debug-card">' +
        '<p class="eyebrow">SCHEMA STATUS</p><h3>' + (validation.ok ? '当前状态合法' : '发现错误') + '</h3>' +
        badge(validation.ok ? 'PASS' : 'FAIL', validation.ok ? 'ok' : 'error') +
      '</article><article class="debug-card wide"><p class="eyebrow">CANONICAL STATE</p><pre>' +
        escapeHtml(JSON.stringify(current, null, 2)) + '</pre></article>' +
      '<article class="debug-card wide"><p class="eyebrow">PATCH TEST</p><textarea id="patchInput" rows="6" style="width:100%">{"runtime":{"mode":"game"}}</textarea><div class="control-line" style="margin-top:8px"><button id="validatePatch">只校验，不写入</button></div><pre id="patchResult"></pre></article></div>';
    target.querySelector('#validatePatch').onclick = function () {
      var output = target.querySelector('#patchResult');
      try {
        var patch = JSON.parse(target.querySelector('#patchInput').value);
        var result = window.RPStateGuard.applyPatch(current, patch, window.RPTemplateData.stateSchema);
        output.textContent = JSON.stringify(result, null, 2);
      } catch (error) {
        output.textContent = 'JSON 解析失败：' + error.message;
      }
    };
  }

  function renderPresets() {
    var target = page('presets');
    target.innerHTML = pageHead(
      '提示词预设',
      '像世界书一样搜索、翻阅、编辑与管理。导入和导出使用 RP-Hub 的直接数组格式；角色与启用状态可以双向互通。'
    ) + '<div id="presetManagerRoot"></div>';
    window.RPPresetManager.render(target.querySelector('#presetManagerRoot'));
  }

  function renderPlugins() {
    var target = page('plugins');
    var rows = window.RPPlugins.list().map(function (plugin) {
      return '<div class="data-row"><div><strong>' + escapeHtml(plugin.name) + '</strong><div class="tiny">' + escapeHtml(plugin.id + '@' + plugin.version) + '</div></div>' +
        '<div><div class="tiny">' + escapeHtml(plugin.capabilities.join(' · ')) + '</div><div class="tiny">' + escapeHtml(plugin.status) + ' · ' + (plugin.active ? '已激活' : '未激活') + ' · 调用 ' + plugin.calls + ' · 平均 ' + plugin.averageMs + 'ms</div></div>' +
        '<button type="button" data-plugin-toggle="' + escapeHtml(plugin.id) + '">' + (plugin.enabled ? '启用' : '关闭') + '</button></div>';
    }).join('');
    target.innerHTML = pageHead(
      '本地插件',
      '插件在构建期打包，声明依赖、权限与优先级；关闭时清理自己创建的监听器和资源。'
    ) + '<div class="debug-card"><div class="row-list">' + rows + '</div></div>';
    target.querySelectorAll('[data-plugin-toggle]').forEach(function (button) {
      button.onclick = async function () {
        var plugin = window.RPPlugins.list().find(function (item) { return item.id === button.dataset.pluginToggle; });
        await window.RPPlugins.setEnabled(plugin.id, !plugin.enabled);
        renderPlugins();
      };
    });
  }

  function renderMemory() {
    var target = page('memory');
    var stats = window.RPMemory.stats();
    var vectorStats = window.RPVectorMemory.stats();
    var preferences = window.RPStorage.getPreferences();
    var memorySettings = Object.assign({
      memoryMode: 'classic',
      vectorEnabled: false,
      summaryEnabled: false,
      inheritRpHub: true,
      autoIndex: true,
      patrolEnabled: false,
      patrolIntervalMs: 60000,
      retryEnabled: true,
      maxRetryAttempts: 6,
      summaryKeepFloors: 40,
      vectorKeepFloors: 40,
      maxHistoryFloors: 40,
      topK: 10,
      similarityThreshold: 0.4,
      vectorRecallMaxChars: 8000,
      summaryConcurrency: 5,
      maxVectors: 0
    }, preferences.memoryModules || {});
    var rows = window.RPMemory.listStructured().map(function (memory) {
      return '<div class="data-row stack"><div><strong>' + escapeHtml(memory.title) + '</strong> ' + badge(memory.kind) + '</div><p class="muted">' +
        escapeHtml(memory.summary) + '</p><div class="tiny">来源：' + escapeHtml((memory.sourceIds || []).join(', ')) + '</div></div>';
    }).join('');
    target.innerHTML = pageHead(
      '结构化记忆与向量索引',
      '向量和总结默认关闭；开启后继承 RP-Hub 当前已选择的 embedding/平衡模型，不另填 API。向量从首个完整回合开始入库；近期保留楼层不参与召回，超过窗口后才可能作为长期记忆注入 Prompt。'
    ) +
      '<div class="card-grid"><article class="debug-card"><div class="metric"><span>结构化</span><strong>' + stats.structured + '</strong></div></article>' +
      '<article class="debug-card"><div class="metric"><span>向量</span><strong>' + vectorStats.total + '</strong></div><p class="tiny">Int8 · 约 ' + vectorStats.estimatedBytes + ' bytes，未量化约 ' + vectorStats.float32EquivalentBytes + ' bytes</p></article>' +
      '<article class="debug-card"><div class="metric"><span>重试队列</span><strong>' + vectorStats.pending + '</strong></div><p class="tiny">失败 ' + vectorStats.failed + ' · ' + (vectorStats.patrolRunning ? '巡检中' : '待机') + '</p></article>' +
      '<article class="debug-card wide"><div class="card-grid">' +
        '<label class="field"><span>记忆模式</span><select id="memoryMode"><option value="classic" ' + (memorySettings.memoryMode !== 'vector' ? 'selected' : '') + '>classic 总结</option><option value="vector" ' + (memorySettings.memoryMode === 'vector' ? 'selected' : '') + '>vector 向量</option></select><small>两者互斥，只启用一种长期记忆</small></label>' +
        '<label class="field"><span>自动建立向量</span><input type="checkbox" id="autoIndex" ' + (memorySettings.autoIndex ? 'checked' : '') + '><small>回复完成后后台批量处理，不参与流式过程</small></label>' +
        '<label class="field"><span>后台巡检</span><input type="checkbox" id="patrolEnabled" ' + (memorySettings.patrolEnabled ? 'checked' : '') + '><small>默认关闭；需要定期检查历史缺口时再开启</small></label>' +
        '<label class="field"><span>失败自动重试</span><input type="checkbox" id="retryEnabled" ' + (memorySettings.retryEnabled ? 'checked' : '') + '><small>接口失败后使用指数退避，最多重试指定次数</small></label>' +
        '<label class="field"><span>巡检间隔（秒）</span><input id="patrolIntervalMs" type="number" min="15" max="3600" value="' + Math.round(Number(memorySettings.patrolIntervalMs || 60000) / 1000) + '"><small>默认60秒，最低15秒</small></label>' +
        '<label class="field"><span>最大重试次数</span><input id="maxRetryAttempts" type="number" min="1" max="12" value="' + Number(memorySettings.maxRetryAttempts || 6) + '"><small>超过后进入失败队列，可手动重试</small></label>' +
        '<label class="field"><span>总结保留楼层</span><input id="summaryKeepFloors" type="number" min="0" max="200" value="' + Number(memorySettings.summaryKeepFloors || 40) + '"><small>classic 模式使用</small></label>' +
        '<label class="field"><span>向量保留楼层</span><input id="vectorKeepFloors" type="number" min="0" max="200" value="' + Number(memorySettings.vectorKeepFloors || 40) + '"><small>vector 模式使用</small></label>' +
        '<label class="field"><span>召回分片数</span><input id="vectorTopK" type="number" min="1" max="50" value="' + Number(memorySettings.topK || 10) + '"><small>每轮最多注入的相关向量分片</small></label>' +
        '<label class="field"><span>最低相关度</span><input id="similarityThreshold" type="number" min="0.35" max="1" step="0.01" value="' + Number(memorySettings.similarityThreshold || 0.4) + '"><small>默认 0.40；过高会导致零召回</small></label>' +
        '<label class="field"><span>向量注入字符上限</span><input id="vectorRecallMaxChars" type="number" min="1000" max="30000" step="1000" value="' + Number(memorySettings.vectorRecallMaxChars || 8000) + '"><small>只限制每轮注入，不限制本地向量库存量</small></label>' +
        '<label class="field"><span>总结并发数</span><input id="summaryConcurrency" type="number" min="1" max="10" value="' + Number(memorySettings.summaryConcurrency || 5) + '"><small>与 RP-Hub 一致，后台补录缺失的逐轮总结</small></label>' +
      '</div><div class="control-line" style="margin-top:10px"><button id="saveMemorySettings" class="primary">保存记忆设置</button><button id="runVectorPatrol" class="secondary">立即巡检</button><button id="retryVectorQueue" class="secondary">重试失败队列</button><span class="tiny" id="memorySettingsStatus">当前默认继承 RP-Hub</span></div></article>' +
      '<article class="debug-card wide"><div class="row-list">' + rows + '</div></article></div>';
    target.querySelector('#saveMemorySettings').onclick = function () {
      var next = Object.assign({}, memorySettings, {
        memoryMode: target.querySelector('#memoryMode').value,
        vectorEnabled: target.querySelector('#memoryMode').value === 'vector',
        autoIndex: target.querySelector('#autoIndex').checked,
        summaryEnabled: target.querySelector('#memoryMode').value === 'classic',
        patrolEnabled: target.querySelector('#patrolEnabled').checked,
        retryEnabled: target.querySelector('#retryEnabled').checked,
        patrolIntervalMs: Math.max(15000, Math.min(3600000, (Number(target.querySelector('#patrolIntervalMs').value) || 60) * 1000)),
        maxRetryAttempts: Math.max(1, Math.min(12, Number(target.querySelector('#maxRetryAttempts').value) || 6)),
        summaryKeepFloors: Math.max(0, Math.min(200, Number(target.querySelector('#summaryKeepFloors').value) || 0)),
        vectorKeepFloors: Math.max(0, Math.min(200, Number(target.querySelector('#vectorKeepFloors').value) || 0)),
        topK: Math.max(1, Math.min(50, Number(target.querySelector('#vectorTopK').value) || 10)),
        similarityThreshold: Math.max(0.35, Math.min(1, Number(target.querySelector('#similarityThreshold').value) || 0.4)),
        vectorRecallMaxChars: Math.max(1000, Math.min(30000, Number(target.querySelector('#vectorRecallMaxChars').value) || 8000)),
        summaryConcurrency: Math.max(1, Math.min(10, Number(target.querySelector('#summaryConcurrency').value) || 5)),
        inheritRpHub: true
      });
      window.RPStorage.savePreferences({ memoryModules: next });
      window.RPVectorMemory.restartPatrol();
      target.querySelector('#memorySettingsStatus').textContent = '已保存；向量模型和总结模型继承 RP-Hub';
      renderMemory();
    };
    target.querySelector('#runVectorPatrol').onclick = async function () {
      this.disabled = true;
      await window.RPVectorMemory.patrol(true);
      this.disabled = false;
      renderMemory();
    };
    target.querySelector('#retryVectorQueue').onclick = async function () {
      this.disabled = true;
      await window.RPVectorMemory.retryQueue();
      this.disabled = false;
      renderMemory();
    };
  }

  function renderTools() {
    var target = page('tools');
    var rows = (window.RPTools ? window.RPTools.list() : []).map(function (tool) {
      var explanation = tool.type === 'vector_memory'
        ? '按语义召回卡内向量记忆；依赖向量模块和 RP-Hub embedding 配置。'
        : tool.type === 'keyword_dialogue'
          ? '按原文关键词找当前对话片段，不调用外部网络。'
          : '保留 RP-Hub 联网工具协议；当前卡内默认关闭，宿主未提供搜索桥时会安全返回不可用。';
      return '<div class="data-row stack"><div><strong>' + escapeHtml(tool.name) + '</strong> ' +
        badge(tool.enabled ? '已启用' : '已关闭', tool.enabled ? 'ok' : 'warn') +
        '</div><div class="tiny">' + escapeHtml(tool.callName) + ' · ' + escapeHtml(tool.type) + '</div>' +
        '<p class="muted">' + escapeHtml(explanation) + '</p><button type="button" data-tool-toggle="' +
        escapeHtml(tool.id) + '">' + (tool.enabled ? '关闭工具' : '启用工具') + '</button></div>';
    }).join('');
    target.innerHTML = pageHead(
      '卡内工具栏',
      '工具协议与 RP-Hub 对齐，但执行留在卡内：向量记忆、历史关键词检索和受控联网接口可以独立开关。模型只有在本页启用工具后才会收到对应标签说明。'
    ) + '<div class="debug-card"><div class="row-list">' + rows + '</div></div>' +
      '<article class="debug-card wide"><p class="eyebrow">TOOL FLOW</p><p class="muted">模型输出工具标签 → 卡内执行 → 结果以 active_tool_results 回填 → 最多自动续写 4 轮 → 最终正文再经过输出正则。</p></article>';
    target.querySelectorAll('[data-tool-toggle]').forEach(function (button) {
      button.onclick = function () {
        var tool = window.RPTools.list().find(function (item) { return item.id === button.dataset.toolToggle; });
        window.RPTools.setEnabled(tool.id, !tool.enabled);
        renderTools();
      };
    });
  }

  function renderImages() {
    var target = page('images');
    var caps = window.RPHost.capabilities();
    var settings = window.RPHost.imageSettings && window.RPHost.imageSettings();
    var service = window.RPImageGen && window.RPImageGen.serviceStatus
      ? window.RPImageGen.serviceStatus()
      : window.RPHost.imageServiceStatus();
    var recent = window.RPImageGen ? window.RPImageGen.recent() : [];
    var imageErrors = window.RPImageGen && window.RPImageGen.errors ? window.RPImageGen.errors() : {};
    var cards = recent.map(function (item) {
      return '<article class="debug-card"><img src="' + escapeHtml(item.url) + '" alt="生成图片" style="width:100%;border-radius:10px;display:block"><p class="tiny">' +
        escapeHtml(item.prompt) + '</p></article>';
    }).join('');
    var errorCards = Object.keys(imageErrors).map(function (id) {
      var message = String(imageErrors[id] || '生图失败');
      var prompt = window.RPImageGen.prompt ? window.RPImageGen.prompt(id) : '';
      return '<article class="debug-card image-error-card"><p class="eyebrow">生成失败</p><h3>' + escapeHtml(id) + '</h3>' +
        '<p class="muted">' + escapeHtml(message) + '</p><p class="tiny">' + escapeHtml(prompt) + '</p>' +
        '<button type="button" class="secondary" data-image-retry="' + escapeHtml(id) + '">重试这张图</button></article>';
    }).join('');
    target.innerHTML = pageHead(
      'RP-Hub 生图',
      '复用 RP-Hub 同源生图配置；密钥只在宿主适配器内部使用，图片按需生成，不写入 canonical state。',
      '<button type="button" class="secondary" id="refreshImageSettings">重新检测</button>'
    ) +
      '<div class="card-grid"><article class="debug-card"><div class="metric"><span>配置与服务</span><strong>' + (service.usable ? 'READY' : service.phase === 'checking' ? 'CHECK' : 'WAIT') + '</strong></div><p class="tiny">' +
      escapeHtml((service.phase === 'unknown' ? (settings && settings.configured ? '配置已读取，尚未检测服务' : '尚未检测') : service.message) +
        (service.connected && service.latency ? ' · ' + service.latency + 'ms' : '')) + '</p></article>' +
      '<article class="debug-card"><div class="metric"><span>插件状态</span><strong>' + (window.RPPlugins.isEnabled('runtime.image-generation') ? 'ON' : 'OFF') + '</strong></div><p class="tiny">' +
      escapeHtml(caps.imageGeneration ? '同源配置可用' : '等待 RP-Hub imageGenKey') + '</p><button type="button" class="secondary" id="toggleImagePlugin">' +
      (window.RPPlugins.isEnabled('runtime.image-generation') ? '关闭生图插件' : '启用生图插件') + '</button></article></div>' +
      '<article class="debug-card wide"><label class="field"><span>提示词</span><textarea id="imagePrompt" rows="5" style="width:100%" placeholder="例如：anime school library, warm afternoon light, ..."></textarea></label>' +
      '<div class="control-line"><select id="imageSize"><option>竖图</option><option>横图</option><option>方图</option><option>2K竖图</option><option>2K横图</option><option>2K方图</option></select><button type="button" class="primary" id="generateImage">生成图片</button><span class="tiny" id="imageStatus"></span></div></article>' +
      '<div class="card-grid">' + (errorCards + cards || '<article class="debug-card wide"><p class="muted">还没有生成记录。</p></article>') + '</div>';
    target.querySelector('#refreshImageSettings').onclick = async function () {
      this.disabled = true;
      this.textContent = '检测中…';
      await (window.RPImageGen && window.RPImageGen.redetectService
        ? window.RPImageGen.redetectService()
        : window.RPHost.redetectImageGeneration());
      renderImages();
    };
    target.querySelector('#toggleImagePlugin').onclick = async function () {
      await window.RPPlugins.setEnabled('runtime.image-generation', !window.RPPlugins.isEnabled('runtime.image-generation'));
      renderImages();
    };
    target.querySelector('#generateImage').onclick = async function () {
      var status = target.querySelector('#imageStatus');
      var prompt = target.querySelector('#imagePrompt').value.trim();
      if (!prompt) { status.textContent = '请先输入提示词'; return; }
      this.disabled = true; status.textContent = '正在生成……';
      try {
        await window.RPImageGen.generate(prompt, { size: target.querySelector('#imageSize').value });
        renderImages();
      } catch (error) {
        status.textContent = String(error.message || error);
      } finally {
        this.disabled = false;
      }
    };
    target.querySelectorAll('[data-image-retry]').forEach(function (button) {
      button.onclick = async function () {
        var id = button.dataset.imageRetry;
        var prompt = window.RPImageGen.prompt(id);
        button.disabled = true;
        button.textContent = '重试中……';
        try {
          await window.RPImageGen.retry(id, prompt, { size: target.querySelector('#imageSize').value });
        } catch (_error) {
          // The error is already retained by RPImageGen and rendered on refresh.
        }
        renderImages();
      };
    });
  }

  function renderDiagnostics() {
    var target = page('diagnostics');
    target.innerHTML = pageHead(
      '完整诊断快照',
      '记录宿主能力、模型调用、世界书命中、变量校验、插件状态、事件和最近一次提示词编译。'
    ) +
      '<div class="control-line"><input id="promptTestInput" value="检查后台小酒馆的世界书扫描规则" aria-label="提示词编译测试"><button id="compilePrompt">编译测试</button></div>' +
      '<article class="debug-card"><pre id="diagnosticOutput">' +
        escapeHtml(JSON.stringify(window.RPDiagnostics.snapshot(), null, 2)) + '</pre></article>';
    target.querySelector('#compilePrompt').onclick = async function () {
      await window.RPPrompt.compile(target.querySelector('#promptTestInput').value);
      target.querySelector('#diagnosticOutput').textContent = JSON.stringify(window.RPDiagnostics.snapshot(), null, 2);
    };
  }

  function renderAll() {
    renderOverview();
    renderMonitor();
    renderModels();
    renderWorldbook();
    renderState();
    renderPresets();
    renderPlugins();
    renderMemory();
    renderTools();
    renderImages();
    renderDiagnostics();
  }

  function renderPage(id) {
    var renderers = {
      overview: renderOverview,
      monitor: renderMonitor,
      models: renderModels,
      worldbook: renderWorldbook,
      state: renderState,
      presets: renderPresets,
      plugins: renderPlugins,
      memory: renderMemory,
      tools: renderTools,
      images: renderImages,
      diagnostics: renderDiagnostics
    };
    if (renderers[id]) renderers[id]();
  }

  function activate(id) {
    renderPage(id);
    document.querySelectorAll('[data-page]').forEach(function (button) {
      button.classList.toggle('active', button.dataset.page === id);
    });
    document.querySelectorAll('[data-debug-page]').forEach(function (target) {
      target.classList.toggle('active', target.dataset.debugPage === id);
    });
    window.RPStorage.savePreferences({ activeDebugPage: id });
  }

  window.RPDebugConsole = {
    renderAll: renderAll,
    renderPage: renderPage,
    activate: activate
  };

  if (window.RPGenerationMonitor) {
    window.RPGenerationMonitor.subscribe(function () {
      var active = document.querySelector('[data-debug-page="monitor"].active');
      if (active) renderMonitor();
    });
  }
  if (window.RPEvents) {
    window.RPEvents.on('conversation:changed', function () {
      var active = document.querySelector('[data-debug-page="monitor"].active');
      if (active) renderMonitor();
    }, { owner: 'debug-console.monitor-recovery' });
    ['image:requested', 'image:generating', 'image:generated', 'image:generation-error'].forEach(function (eventName) {
      window.RPEvents.on(eventName, function () {
        var active = document.querySelector('[data-debug-page="images"].active');
        if (active) renderImages();
      }, { owner: 'debug-console.image-page' });
    });
  }
})();
