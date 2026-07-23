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
  }

  function renderModels() {
    var target = page('models');
    var caps = window.RPHost.capabilities();
    var settings = window.RPHost.settings();
    var routes = window.RPModels.routes();
    var availableModels = window.RPModels.models();
    var rows = Object.keys(routes).map(function (id) {
      var route = routes[id];
      var available = id === 'embedding' ? caps.embeddings : caps.generation;
      var resolved = window.RPHost.resolveModel(route.inherit, route.model);
      var options = '<option value="">继承 RP-Hub' + (resolved ? '：' + escapeHtml(resolved) : '（未选择）') + '</option>' +
        availableModels.map(function (model) {
          var modelId = String(model.id || model.name || '');
          return '<option value="' + escapeHtml(modelId) + '" ' + (route.model === modelId ? 'selected' : '') + '>' + escapeHtml(modelId) + '</option>';
        }).join('');
      return '<div class="data-row"><div><strong>' + escapeHtml(route.label) + '</strong><div class="tiny">' + escapeHtml(id) + '</div></div>' +
        '<div><select data-model-route="' + escapeHtml(id) + '">' + options + '</select><div class="tiny">' + (route.model ? '卡内覆盖' : '继承 RP-Hub') + '</div></div>' +
        badge(available ? '直连可用' : '等待设置', available ? 'ok' : 'warn') + '</div>';
    }).join('');
    target.innerHTML = pageHead(
      '模型路由',
      '运行时从同源 RP-Hub 设置读取当前端点与模型；密钥只留在请求闭包，不进入诊断、存档或界面。',
      '<button type="button" class="secondary" id="refreshModels">刷新模型</button>'
    ) + '<div class="card-grid" style="margin-bottom:10px">' +
      '<article class="debug-card"><div class="metric"><span>配置状态</span><strong>' + (caps.sameOriginSettings ? 'READY' : 'WAIT') + '</strong></div></article>' +
      '<article class="debug-card"><div class="metric"><span>可见模型</span><strong>' + window.RPModels.models().length + '</strong></div></article>' +
      '<article class="debug-card"><div class="tiny">端点</div><code>' + escapeHtml(settings && settings.apiUrl || '未读取') + '</code></article>' +
      '</div><div class="debug-card"><div class="row-list">' + rows + '</div></div>';
    target.querySelector('#refreshModels').onclick = async function () {
      this.disabled = true;
      await window.RPHost.refresh();
      await window.RPModels.refreshModels();
      this.disabled = false;
      renderModels();
    };
    target.querySelectorAll('[data-model-route]').forEach(function (select) {
      select.onchange = function () {
        window.RPModels.setRoute(select.dataset.modelRoute, { model: select.value });
        renderModels();
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
        '<button type="button" class="toggle" data-worldbook-toggle="' + escapeHtml(entry.id) + '">' + (entry.runtimeEnabled ? '启用' : '关闭') + '</button></div>';
    }).join('');
    var resultHtml = result ? '<article class="debug-card wide"><p class="eyebrow">SCAN RESULT</p><h3>命中 ' + result.hits.length + ' 条 · ' + result.usedChars + ' 字符</h3><pre>' +
      escapeHtml(JSON.stringify({ hits: result.hits, diagnostics: result.diagnostics }, null, 2)) + '</pre></article>' : '';
    target.innerHTML = pageHead(
      '世界书与扫描规则',
      '兼容 RP-Hub 的历史扫描、概率与七类位置；显式依赖可递归展开，并受深度、去重和可选预算限制。',
      '<button type="button" class="secondary" id="importWorldbook">导入 RP-Hub</button>' +
      '<input id="worldbookImportFile" type="file" accept=".json,application/json" hidden>' +
      '<button type="button" class="secondary" id="exportWorldbook">导出全部</button>'
    ) +
      '<div class="card-grid" style="margin-bottom:10px"><article class="debug-card"><div class="metric"><span>知识库修订</span><strong>' + knowledge.revision + '</strong></div></article>' +
      '<article class="debug-card"><div class="metric"><span>运行时条目</span><strong>' + knowledge.entries.length + '</strong></div></article>' +
      '<article class="debug-card"><div class="metric"><span>待审提案</span><strong>' + proposals.filter(function (item) { return item.status === 'pending'; }).length + '</strong></div></article></div>' +
      '<div class="control-line"><input id="worldbookQuery" value="我想检查世界书递归扫描" aria-label="模拟扫描文本"><button id="scanWorldbook">模拟扫描</button></div>' +
      '<div class="debug-card"><div class="row-list">' + rows + '</div></div><div class="card-grid">' + resultHtml + '</div>';
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
        alert('世界书导入失败：' + error.message);
      }
    };
    target.querySelector('#exportWorldbook').onclick = function () {
      downloadJson('worldbook.json', { entries: window.RPWorldbook.exportRpHub() });
    };
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
        '<div><div class="tiny">' + escapeHtml(plugin.capabilities.join(' · ')) + '</div><div class="tiny">' + escapeHtml(plugin.status) + ' · 调用 ' + plugin.calls + ' · 平均 ' + plugin.averageMs + 'ms</div></div>' +
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
      vectorEnabled: false,
      summaryEnabled: false,
      inheritRpHub: true,
      autoIndex: true,
      maxHistoryFloors: 40,
      topK: 10,
      similarityThreshold: 0.5,
      summaryEveryFloors: 10,
      maxVectors: 2000
    }, preferences.memoryModules || {});
    var rows = window.RPMemory.listStructured().map(function (memory) {
      return '<div class="data-row stack"><div><strong>' + escapeHtml(memory.title) + '</strong> ' + badge(memory.kind) + '</div><p class="muted">' +
        escapeHtml(memory.summary) + '</p><div class="tiny">来源：' + escapeHtml((memory.sourceIds || []).join(', ')) + '</div></div>';
    }).join('');
    target.innerHTML = pageHead(
      '结构化记忆与向量索引',
      '向量和总结默认关闭；开启后继承 RP-Hub 当前已选择的 embedding/平衡模型，不另填 API。历史超过保留楼层后，Prompt 只带最近楼层，旧内容通过向量和总结召回。'
    ) +
      '<div class="card-grid"><article class="debug-card"><div class="metric"><span>结构化</span><strong>' + stats.structured + '</strong></div></article>' +
      '<article class="debug-card"><div class="metric"><span>向量</span><strong>' + vectorStats.total + '</strong></div></article>' +
      '<article class="debug-card"><div class="metric"><span>队列</span><strong>' + stats.queuePending + '</strong></div></article>' +
      '<article class="debug-card wide"><div class="card-grid">' +
        '<label class="field"><span>向量召回</span><input type="checkbox" id="vectorEnabled" ' + (memorySettings.vectorEnabled ? 'checked' : '') + '><small>使用 RP-Hub embedding 模型建立卡内向量库</small></label>' +
        '<label class="field"><span>自动建立向量</span><input type="checkbox" id="autoIndex" ' + (memorySettings.autoIndex ? 'checked' : '') + '><small>回复完成后后台批量处理，不参与流式过程</small></label>' +
        '<label class="field"><span>历史保留楼层</span><input id="maxHistoryFloors" type="number" min="0" max="200" value="' + Number(memorySettings.maxHistoryFloors) + '"><small>0 表示不裁剪；默认 50</small></label>' +
        '<label class="field"><span>总结模块</span><input type="checkbox" id="summaryEnabled" ' + (memorySettings.summaryEnabled ? 'checked' : '') + '><small>使用总结 route 压缩旧历史，默认继承平衡模型</small></label>' +
        '<label class="field"><span>每隔多少楼总结</span><input id="summaryEveryFloors" type="number" min="2" max="100" value="' + Number(memorySettings.summaryEveryFloors) + '"><small>总结只在超过保留楼层后触发</small></label>' +
      '</div><div class="control-line" style="margin-top:10px"><button id="saveMemorySettings" class="primary">保存记忆设置</button><span class="tiny" id="memorySettingsStatus">当前默认继承 RP-Hub</span></div></article>' +
      '<article class="debug-card wide"><div class="row-list">' + rows + '</div></article></div>';
    target.querySelector('#saveMemorySettings').onclick = function () {
      var next = Object.assign({}, memorySettings, {
        vectorEnabled: target.querySelector('#vectorEnabled').checked,
        autoIndex: target.querySelector('#autoIndex').checked,
        summaryEnabled: target.querySelector('#summaryEnabled').checked,
        maxHistoryFloors: Math.max(0, Math.min(200, Number(target.querySelector('#maxHistoryFloors').value) || 0)),
        summaryEveryFloors: Math.max(2, Math.min(100, Number(target.querySelector('#summaryEveryFloors').value) || 10)),
        inheritRpHub: true
      });
      window.RPStorage.savePreferences({ memoryModules: next });
      target.querySelector('#memorySettingsStatus').textContent = '已保存；向量模型和总结模型继承 RP-Hub';
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
    renderModels();
    renderWorldbook();
    renderState();
    renderPresets();
    renderPlugins();
    renderMemory();
    renderTools();
    renderDiagnostics();
  }

  function renderPage(id) {
    var renderers = {
      overview: renderOverview,
      models: renderModels,
      worldbook: renderWorldbook,
      state: renderState,
      presets: renderPresets,
      plugins: renderPlugins,
      memory: renderMemory,
      tools: renderTools,
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
})();
