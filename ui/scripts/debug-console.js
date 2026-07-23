(function () {
  'use strict';

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
    var capabilityCount = Object.keys(diagnostic.host).filter(function (key) {
      return diagnostic.host[key] === true;
    }).length;
    target.innerHTML = pageHead(
      '运行时总览',
      '这里显示卡内内核是否具备开始应用所需的基础能力。Debug 模式不会推进故事。'
    ) +
      '<div class="card-grid">' +
        '<article class="debug-card"><p class="eyebrow">HOST</p><div class="metric"><span>增强能力</span><strong>' + capabilityCount + '</strong></div><p class="tiny">' + escapeHtml(diagnostic.host.host) + '</p></article>' +
        '<article class="debug-card"><p class="eyebrow">WORLDBOOK</p><div class="metric"><span>启用条目</span><strong>' + worldbook.enabled + '/' + worldbook.total + '</strong></div><p class="tiny">递归和预算由卡内引擎处理</p></article>' +
        '<article class="debug-card"><p class="eyebrow">MEMORY</p><div class="metric"><span>向量覆盖率</span><strong>' + memory.vectorCoverage + '%</strong></div><p class="tiny">' + memory.structured + ' 条结构化记忆</p></article>' +
        '<article class="debug-card wide"><p class="eyebrow">STARTUP GATE</p><h3>Debug 后台 → 选择应用 → Renderer 接管</h3><p class="muted">底层服务不会因切换表现层而重建。Galgame、电子书和战棋共用相同的世界书、状态、记忆、模型路由与插件生命周期。</p></article>' +
      '</div>';
  }

  function renderModels() {
    var target = page('models');
    var caps = window.RPHost.capabilities();
    var settings = window.RPHost.settings();
    var routes = window.RPModels.routes();
    var rows = Object.keys(routes).map(function (id) {
      var route = routes[id];
      var available = id === 'embedding' ? caps.embeddings : caps.generation;
      return '<div class="data-row"><div><strong>' + escapeHtml(route.label) + '</strong><div class="tiny">' + escapeHtml(id) + '</div></div>' +
        '<div><code>' + escapeHtml(route.model || '继承宿主：' + route.inherit) + '</code></div>' +
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
    var rows = window.RPMemory.listStructured().map(function (memory) {
      return '<div class="data-row stack"><div><strong>' + escapeHtml(memory.title) + '</strong> ' + badge(memory.kind) + '</div><p class="muted">' +
        escapeHtml(memory.summary) + '</p><div class="tiny">来源：' + escapeHtml((memory.sourceIds || []).join(', ')) + '</div></div>';
    }).join('');
    target.innerHTML = pageHead(
      '结构化记忆与向量索引',
      '结构化记忆保存已发生事实；向量只是带来源的检索索引。宿主未提供 embedding 桥时不会静默读取凭据。'
    ) +
      '<div class="card-grid"><article class="debug-card"><div class="metric"><span>结构化</span><strong>' + stats.structured + '</strong></div></article>' +
      '<article class="debug-card"><div class="metric"><span>向量</span><strong>' + stats.vector + '</strong></div></article>' +
      '<article class="debug-card"><div class="metric"><span>队列</span><strong>' + stats.queuePending + '</strong></div></article>' +
      '<article class="debug-card wide"><div class="row-list">' + rows + '</div></article></div>';
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
