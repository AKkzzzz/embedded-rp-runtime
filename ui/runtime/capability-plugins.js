(function () {
  'use strict';

  var prefix = window.RPTemplateData.app.storagePrefix + ':';
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function save(key, value) {
    try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch (_error) {}
  }
  function load(key, fallback) {
    try {
      var value = JSON.parse(localStorage.getItem(prefix + key) || 'null');
      return value == null ? clone(fallback) : value;
    } catch (_error) { return clone(fallback); }
  }

  var rpgApi = {
    snapshot: function () { return clone(window.RPStorage.getCanonical().rpg); },
    propose: function (patch, reason) {
      var state = window.RPStorage.getCanonical();
      var next = clone(state.rpg);
      var result = window.RPStateGuard.applyPatch(next, patch, window.RPTemplateData.stateSchema.properties.rpg);
      if (!result.ok) return result;
      result.value.revision = next.revision + 1;
      state.rpg = result.value;
      window.RPStorage.saveCanonical(state);
      window.RPEvents.emit('rpg:changed', { reason: reason || 'plugin', state: clone(result.value) });
      return { ok: true, value: clone(result.value) };
    }
  };

  var commands = {};
  var mediaAssets = {};
  var activeAudio = null;
  var commandApi = {
    register: function (name, handler, description) {
      if (!/^\/[a-z][a-z0-9_-]{1,30}$/i.test(name) || typeof handler !== 'function') return false;
      commands[name.toLowerCase()] = { handler: handler, description: description || '' };
      return true;
    },
    list: function () { return Object.keys(commands).map(function (name) { return { name: name, description: commands[name].description }; }); },
    execute: async function (input) {
      var parts = String(input || '').trim().split(/\s+/);
      var command = commands[parts.shift().toLowerCase()];
      if (!command) return { handled: false };
      return { handled: true, value: await command.handler(parts.join(' '), parts) };
    }
  };

  function overlay() {
    if (document.getElementById('rpCapabilityBall')) return document.getElementById('rpCapabilityBall');
    var mount = document.getElementById('runtimeShell') || document.body;
    var ball = document.createElement('button');
    ball.id = 'rpCapabilityBall';
    ball.type = 'button';
    ball.textContent = '⌘';
    var ballArt = String(window.RPTemplateData && window.RPTemplateData.app && window.RPTemplateData.app.debugBallAsset || '');
    if (ballArt && /^(?:data:image\/|\.{0,2}\/|\/|assets\/)/.test(ballArt)) {
      var ballImage = new Image();
      ballImage.onload = function () {
        ball.classList.add('has-art');
        ball.style.backgroundImage = 'url(' + JSON.stringify(ballArt) + ')';
        ball.textContent = '';
        ball.dataset.assetState = 'ready';
      };
      ballImage.onerror = function () {
        ball.classList.remove('has-art');
        ball.style.backgroundImage = '';
        ball.textContent = '⌘';
        ball.dataset.assetState = 'fallback';
      };
      ballImage.src = ballArt;
      if (ballImage.complete && ballImage.naturalWidth > 0) ballImage.onload();
    }
    ball.title = '卡内运行时工具与模型生成监视';
    var panel = document.createElement('aside');
    panel.id = 'rpCapabilityPanel';
    panel.hidden = true;
    panel.dataset.expanded = 'false';
    var suppressBallClick = false;
    var activeView = 'live';
    var retryFeedback = '';
    var unsubscribe = null;
    var lastMonitor = window.RPGenerationMonitor ? window.RPGenerationMonitor.snapshot() : null;
    function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
    function positionElement(element, stored) {
      if (!stored || element.hidden) return;
      var maxLeft = Math.max(8, window.innerWidth - element.offsetWidth - 8);
      var maxTop = Math.max(8, window.innerHeight - element.offsetHeight - 8);
      element.style.right = 'auto';
      element.style.bottom = 'auto';
      element.style.left = clamp(Number(stored.x || 0) * maxLeft, 8, maxLeft) + 'px';
      element.style.top = clamp(Number(stored.y || 0) * maxTop, 8, maxTop) + 'px';
    }
    function rememberPosition(element, key) {
      var rect = element.getBoundingClientRect();
      var maxLeft = Math.max(1, window.innerWidth - rect.width - 8);
      var maxTop = Math.max(1, window.innerHeight - rect.height - 8);
      var stored = {
        x: clamp(rect.left, 8, maxLeft) / maxLeft,
        y: clamp(rect.top, 8, maxTop) / maxTop
      };
      save(key, stored);
      return stored;
    }
    function makeDraggable(element, key, handleSelector) {
      var stored = load(key, null);
      var drag = null;
      element.addEventListener('pointerdown', function (event) {
        var handle = handleSelector ? event.target.closest(handleSelector) : element;
        if (!handle || (handleSelector && event.target.closest('button, input, select, textarea, a'))) return;
        var rect = element.getBoundingClientRect();
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
        element.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      element.addEventListener('pointermove', function (event) {
        if (!drag || drag.id !== event.pointerId) return;
        var dx = event.clientX - drag.x;
        var dy = event.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
        var maxLeft = Math.max(8, window.innerWidth - element.offsetWidth - 8);
        var maxTop = Math.max(8, window.innerHeight - element.offsetHeight - 8);
        element.style.right = 'auto';
        element.style.bottom = 'auto';
        element.style.left = clamp(drag.left + dx, 8, maxLeft) + 'px';
        element.style.top = clamp(drag.top + dy, 8, maxTop) + 'px';
      });
      function finish(event) {
        if (!drag || drag.id !== event.pointerId) return;
        if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
        if (element === ball && drag.moved) suppressBallClick = true;
        stored = rememberPosition(element, key);
        drag = null;
      }
      element.addEventListener('pointerup', finish);
      element.addEventListener('pointercancel', finish);
      return {
        restore: function () { positionElement(element, stored); },
        reclamp: function () { stored = rememberPosition(element, key); positionElement(element, stored); }
      };
    }
    function formatPrompt(prompt) {
      if (!prompt || !prompt.messages || !prompt.messages.length) {
        return '本轮尚未编译提示词。提交一次行动后，这里会显示真正交给模型的消息顺序与全文。';
      }
      return prompt.messages.map(function (message, index) {
        return [
          '════ MESSAGE ' + (index + 1) + ' · ' + String(message.role || 'unknown').toUpperCase() + ' ════',
          'source: ' + (message.source || 'unknown') +
            (message.worldbookIds && message.worldbookIds.length ? '\nworldbook: ' + message.worldbookIds.join(', ') : ''),
          '',
          String(message.content || '')
        ].join('\n');
      }).join('\n\n');
    }
    function formatWorldbookHits(prompt) {
      var hits = prompt && Array.isArray(prompt.worldbookHits) ? prompt.worldbookHits : [];
      if (!hits.length) return '本轮没有命中世界书，或尚未提交行动。';
      return hits.map(function (hit, index) {
        return [
          '════ HIT ' + (index + 1) + ' · ' + (hit.name || hit.id || '未命名条目') + ' ════',
          'id: ' + (hit.id || ''),
          '位置: ' + (hit.placement || 'before_char') + ' · order ' + Number(hit.order || 0) + ' · 递归深度 ' + Number(hit.depth || 0),
          '原因: ' + (hit.reason || 'unknown'),
          '关键词: ' + ((hit.matchedKeys || []).join(', ') || '常驻/依赖命中'),
          '来源楼层: ' + ((hit.messageIndexes || []).join(', ') || '当前输入或常驻'),
          '注入字符: ' + Number(hit.chars || String(hit.content || '').length),
          '',
          String(hit.content || '')
        ].join('\n');
      }).join('\n\n');
    }
    function stateTrace() {
      if (window.RPStateSync && window.RPStateSync.trace) return window.RPStateSync.trace();
      return window.RPUIStateSync && window.RPUIStateSync.trace ? window.RPUIStateSync.trace() : null;
    }
    function hasStateTrace() {
      return Boolean(
        window.RPStateSync && window.RPStateSync.trace ||
        window.RPUIStateSync && window.RPUIStateSync.trace
      );
    }
    function vectorStatusLabel(search) {
      var labels = {
        idle: '尚未检索', disabled: '向量模式未启用', 'empty-index': '向量库为空',
        'query-empty': '检索词为空', 'embedding-error': '检索请求失败',
        'no-eligible-memory': '仅有最近保留楼层', 'below-threshold': '相关度未达阈值', recalled: '已召回'
      };
      return labels[search && search.status] || String(search && search.status || '未知');
    }
    function render() {
      var state = window.RPStorage.getCanonical();
      var monitor = lastMonitor || { phase: 'idle', reasoning: '', content: '', reasoningChars: 0, contentChars: 0, durationMs: 0 };
      var prompt = window.RPPromptInspector ? window.RPPromptInspector.snapshot() : null;
      var mainTrace = window.RPConversation && window.RPConversation.debugTrace ? window.RPConversation.debugTrace() : null;
      var secondaryTrace = stateTrace();
      var labels = { idle: '待机', starting: '请求中', thinking: '模型思考', writing: '生成正文', complete: '已完成', error: '出错', stopped: '已停止' };
      var canRetry = monitor.phase === 'error' && window.RPConversation &&
        window.RPConversation.canRetryLastGeneration && window.RPConversation.canRetryLastGeneration();
      var viewValue = activeView === 'thinking' ? monitor.reasoning :
        activeView === 'content' ? (mainTrace && mainTrace.response || monitor.content) :
        activeView === 'prompt' ? formatPrompt(prompt) :
        activeView === 'worldbook' ? formatWorldbookHits(prompt) :
        activeView === 'vector' ? (prompt ? {
          search: prompt.vectorSearch,
          recalledFragments: prompt.vectorMemoryHits || [],
          injectedChars: Number(prompt.diagnostics && prompt.diagnostics.vectorRecallChars || 0),
          note: '近期原文不参与向量召回；旧楼层只在达到相关度阈值时注入。'
        } : '本轮尚未编译提示词。') :
        activeView === 'state-prompt' ? formatPrompt(secondaryTrace && { messages: secondaryTrace.prompt }) :
        activeView === 'state-response' ? (secondaryTrace || '副模型尚未运行。正文完成后，状态副模型会在这里留下响应与变量更新。') :
        activeView === 'variables' ? state :
        activeView === 'notes' ? (window.RPNotebook ? window.RPNotebook.list() : []) :
        monitor;
      panel.innerHTML = '<header class="rp-capability-head"><div><strong>本轮调试监视</strong><span>' +
        escapeHtml(labels[monitor.phase] || monitor.phase) + '</span></div><div class="rp-capability-window-actions">' +
        (canRetry ? '<button type="button" data-cap-retry>重试 / 重roll</button>' : '') +
        '<button type="button" data-cap-expand>' + (panel.dataset.expanded === 'true' ? '还原' : '放大') + '</button>' +
        '<button type="button" data-cap-close aria-label="关闭调试监视">关闭</button></div></header>' +
        '<p style="opacity:.75;margin:4px 0 8px">调试窗只读取主叙事与状态副模型的真实请求快照，不改变模型请求。</p>' +
        (retryFeedback ? '<p class="rp-capability-retry-feedback">' + escapeHtml(retryFeedback) + '</p>' : '') +
        '<div class="rp-capability-metrics">' +
        '<div><small>思考</small><br><b>' + monitor.reasoningChars + '</b> 字</div>' +
        '<div><small>正文</small><br><b>' + monitor.contentChars + '</b> 字</div>' +
        '<div><small>耗时</small><br><b>' + (Math.round(Number(monitor.durationMs || 0) / 100) / 10) + '</b>s</div>' +
        '<div><small>提示词</small><br><b>' + (prompt ? prompt.charCount || 0 : '—') + '</b> 字</div></div>' +
        '<div class="rp-capability-summary">' + escapeHtml((monitor.route || '未请求') + (monitor.model ? ' · ' + monitor.model : '') +
          (prompt ? ' · 世界书命中 ' + (prompt.worldbookHits || []).length +
            ' · 向量命中 ' + (prompt.vectorMemoryHits || []).length +
            ' · 向量注入 ' + Number(prompt.diagnostics && prompt.diagnostics.vectorRecallChars || 0) + ' 字' +
            ' · 结构记忆 ' + (prompt.memoryHits || []).length +
            ' · ' + vectorStatusLabel(prompt.vectorSearch) : '')) + '</div>' +
        '<nav class="rp-capability-tabs">' +
        '<button data-cap-view="live">实时</button><button data-cap-view="thinking">主模型思考</button><button data-cap-view="content">主模型响应</button>' +
        (window.RPPromptInspector ? '<button data-cap-view="prompt">主模型提示词</button>' : '') +
        (window.RPPromptInspector ? '<button data-cap-view="worldbook">世界书命中</button>' : '') +
        (window.RPPromptInspector ? '<button data-cap-view="vector">向量诊断</button>' : '') +
        (hasStateTrace() ? '<button data-cap-view="state-prompt">副模型提示词</button><button data-cap-view="state-response">副模型响应</button>' : '') +
        '<button data-cap-view="variables">变量</button>' +
        (window.RPPlugins.isEnabled('runtime.notebook') ? '<button data-cap-view="notes">便签</button>' : '') +
        '</nav><pre id="rpCapabilityOutput">' +
        escapeHtml(typeof viewValue === 'string' ? viewValue : JSON.stringify(viewValue, null, 2)) + '</pre>';
      panel.querySelectorAll('[data-cap-view]').forEach(function (button) {
        button.classList.toggle('active', button.dataset.capView === activeView);
        button.addEventListener('click', function () {
          activeView = button.dataset.capView;
          render();
        });
      });
      var retryButton = panel.querySelector('[data-cap-retry]');
      if (retryButton) retryButton.addEventListener('click', async function () {
        retryFeedback = '';
        activeView = 'live';
        this.disabled = true;
        this.textContent = '重试中…';
        try {
          await window.RPConversation.retryLastGeneration();
        } catch (error) {
          retryFeedback = '重试失败：' + String(error && error.message || error);
          render();
        }
      });
      panel.querySelector('[data-cap-expand]').addEventListener('click', function () {
        panel.dataset.expanded = panel.dataset.expanded === 'true' ? 'false' : 'true';
        render();
        window.requestAnimationFrame(function () { panelDrag.reclamp(); });
      });
      panel.querySelector('[data-cap-close]').addEventListener('click', function () { panel.hidden = true; });
    }
    function escapeHtml(value) { return String(value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
    function updateBall(monitor) {
      lastMonitor = monitor;
      var labels = { idle: '⌘', starting: '请求中', thinking: '思 ' + monitor.reasoningChars, writing: '写 ' + monitor.contentChars, complete: '✓ ' + monitor.contentChars, error: '!' };
      if (ball.classList.contains('has-art')) ball.dataset.statusLabel = monitor.phase === 'idle' ? '' : (labels[monitor.phase] || '');
      else ball.textContent = labels[monitor.phase] || '⌘';
      ball.dataset.phase = monitor.phase;
      ball.title = '运行监视：' + (monitor.phase || 'idle');
      if (!panel.hidden) render();
    }
    function debugIsEnabled() {
      return window.RPStorage && typeof window.RPStorage.debugEnabled === 'function'
        ? window.RPStorage.debugEnabled()
        : false;
    }
    function applyDebugVisibility() {
      var enabled = debugIsEnabled();
      ball.hidden = !enabled;
      if (!enabled) panel.hidden = true;
      ball.setAttribute('aria-hidden', enabled ? 'false' : 'true');
    }
    function setDebugEnabled(enabled) {
      if (!window.RPStorage || typeof window.RPStorage.savePreferences !== 'function') return false;
      window.RPStorage.savePreferences({ debugEnabled: Boolean(enabled) });
      applyDebugVisibility();
      return true;
    }
    window.RPDebugOverlay = {
      enabled: debugIsEnabled,
      setEnabled: setDebugEnabled,
      refresh: applyDebugVisibility
    };
    if (window.RPGenerationMonitor) unsubscribe = window.RPGenerationMonitor.subscribe(updateBall);
    if (window.RPEvents) {
      window.RPEvents.on('prompt:compiled', function () { if (!panel.hidden) render(); }, { owner: 'runtime.variable-overlay' });
      window.RPEvents.on('state:sync', function () { if (!panel.hidden) render(); }, { owner: 'runtime.variable-overlay' });
      window.RPEvents.on('ui-template:sync', function () { if (!panel.hidden) render(); }, { owner: 'runtime.variable-overlay' });
      window.RPEvents.on('conversation:changed', function () { if (!panel.hidden) render(); }, { owner: 'runtime.variable-overlay' });
      window.RPEvents.on('storage:preferences:changed', applyDebugVisibility, { owner: 'runtime.variable-overlay' });
    }
    mount.appendChild(ball);
    mount.appendChild(panel);
    var ballDrag = makeDraggable(ball, 'capability-ball-position', null);
    var panelDrag = makeDraggable(panel, 'capability-panel-position', '.rp-capability-head');
    ballDrag.restore();
    applyDebugVisibility();
    ball.addEventListener('click', function () {
      if (suppressBallClick) { suppressBallClick = false; return; }
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        render();
        window.requestAnimationFrame(function () { panelDrag.restore(); });
      }
    });
    function onResize() {
      ballDrag.reclamp();
      if (!panel.hidden) panelDrag.reclamp();
    }
    window.addEventListener('resize', onResize);
    ball._rpOverlayDispose = function () {
      if (typeof unsubscribe === 'function') unsubscribe();
      window.removeEventListener('resize', onResize);
    };
    return ball;
  }

  var mediaApi = {
    registerAsset: function (id, source, kind) {
      var url = String(source || '');
      if (!/^(data:|blob:|\.{0,2}\/|\/)/.test(url)) return { ok: false, error: '只允许卡内、本地或 blob 资产' };
      mediaAssets[String(id)] = { source: url, kind: String(kind || 'audio') };
      return { ok: true };
    },
    playAudio: function (assetId, options) {
      if (!window.RPPlugins.isEnabled('runtime.media-stage')) return { ok: false, error: 'media plugin disabled' };
      var asset = mediaAssets[String(assetId)];
      if (!asset || asset.kind !== 'audio' || typeof Audio === 'undefined') return { ok: false, error: '本地音频资产不存在或浏览器不支持' };
      if (activeAudio) { activeAudio.pause(); activeAudio = null; }
      activeAudio = new Audio(asset.source);
      activeAudio.loop = Boolean(options && options.loop);
      var volume = options && options.volume != null ? Number(options.volume) : 1;
      activeAudio.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
      activeAudio.play().catch(function (error) { window.RPEvents.emit('media:error', { message: String(error.message || error) }); });
      var event = { assetId: String(assetId), options: clone(options || {}) };
      window.RPEvents.emit('media:audio', event);
      return { ok: true, event: event };
    },
    stopAudio: function () {
      if (activeAudio) { activeAudio.pause(); activeAudio.currentTime = 0; activeAudio = null; }
    },
    effect: function (name, payload) {
      var event = { name: String(name), payload: clone(payload || {}) };
      window.RPEvents.emit('media:effect', event);
      return { ok: true, event: event };
    },
    capabilities: function () {
      return { audio: typeof Audio !== 'undefined', live2d: Boolean(window.Live2D || window.live2d), visual: true, localAssetsOnly: true };
    }
  };

  window.RPRPG = rpgApi;
  window.RPCommands = commandApi;
  window.RPMedia = mediaApi;
  window.RPDynamicLore = {
    entries: function () { return window.RPWorldbookPatches ? window.RPWorldbookPatches.entries() : []; },
    proposals: function () { return window.RPWorldbookPatches ? window.RPWorldbookPatches.proposals() : []; },
    propose: function (proposal) {
      if (!window.RPPlugins.isEnabled('runtime.dynamic-lore')) return { ok: false, errors: ['dynamic lore plugin is disabled'] };
      return window.RPWorldbookPatches.propose(proposal);
    }
  };
  window.RPWebLLM = {
    available: function () { return Boolean(window.WebLLM || (window.parent && window.parent !== window && window.parent.WebLLM)); },
    generate: function (messages, options) {
      var bridge = window.WebLLM || (window.parent && window.parent !== window && window.parent.WebLLM);
      if (!bridge || typeof bridge.generate !== 'function') return Promise.reject(new Error('WebLLM 宿主适配未提供'));
      return bridge.generate(messages, options || {});
    }
  };

  window.RPPlugins.attach('runtime.rpg-companion', {
    beforePromptCompile: function (context) {
      var state = window.RPStorage.getCanonical().rpg;
      if (!state || !Object.keys(state.player || {}).length && !state.quests.length && !state.inventory.length) return context;
      context.messages = context.messages.concat([{ role: 'system', content: '【RPG Companion 状态】\n' + JSON.stringify(state), source: 'plugin:rpg-companion' }]);
      return context;
    }
  });
  window.RPPlugins.attach('runtime.command-registry', {
    activate: function () {
      commandApi.register('/status', function () { return window.RPStorage.getCanonical(); }, '查看当前状态');
      commandApi.register('/rpg', function () { return rpgApi.snapshot(); }, '查看 RPG 状态');
      commandApi.register('/roll', async function (expression) {
        var result = await window.RPTools.run('<tool_dice:' + (expression || 'd20') + '>');
        return result.calls[0] && result.calls[0].content || '骰子工具不可用';
      }, '投掷骰子，例如 /roll 2d6+3');
    }
  });
  window.RPPlugins.attach('runtime.variable-overlay', {
    activate: overlay,
    dispose: function () {
      var ball = document.getElementById('rpCapabilityBall');
      var panel = document.getElementById('rpCapabilityPanel');
      if (ball && ball._rpOverlayDispose) ball._rpOverlayDispose();
      if (ball) ball.remove();
      if (panel) panel.remove();
    }
  });
  window.RPPlugins.attach('runtime.dynamic-lore', {});
  window.RPPlugins.attach('runtime.webllm', {});
  window.RPPlugins.attach('runtime.media-stage', {
    playAudio: mediaApi.playAudio,
    effect: mediaApi.effect,
    dispose: mediaApi.stopAudio
  });
})();
