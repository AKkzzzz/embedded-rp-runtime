(function () {
  'use strict';

  var prefix = 'nanami_embedded_rp_runtime_v1:';
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

  var timeline = load('timeline', { revision: 1, current: null, nodes: [] });
  function snapshot(reason) {
    var messages = window.RPConversation ? window.RPConversation.list().filter(function (m) { return m.role === 'user' || m.role === 'assistant'; }) : [];
    var last = messages[messages.length - 1];
    if (!last) return;
    var node = {
      id: 'floor-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      parentId: timeline.current,
      reason: reason || 'conversation',
      label: '',
      createdAt: new Date().toISOString(),
      messages: clone(messages)
    };
    timeline.nodes = timeline.nodes.concat(node).slice(-120);
    timeline.current = node.id;
    timeline.revision += 1;
    save('timeline', timeline);
  }
  var timelineApi = {
    list: function () { return clone(timeline.nodes); },
    current: function () { return timeline.current; },
    checkpoint: function (label) {
      snapshot('checkpoint');
      var node = timeline.nodes[timeline.nodes.length - 1];
      if (node) { node.label = String(label || 'checkpoint'); save('timeline', timeline); }
      return clone(node);
    },
    branch: function (nodeId) {
      var node = timeline.nodes.find(function (item) { return item.id === nodeId; });
      if (!node) return { ok: false, error: 'timeline node not found' };
      timeline.current = node.id;
      save('timeline', timeline);
      return { ok: true, node: clone(node) };
    },
    restore: async function (nodeId) {
      var node = timeline.nodes.find(function (item) { return item.id === nodeId; });
      if (!node) return { ok: false, error: 'timeline node not found' };
      var state = window.RPStorage.getCanonical();
      state.conversation.messages = clone(node.messages);
      state.conversation.revision += 1;
      window.RPStorage.saveCanonical(state);
      timeline.current = node.id;
      save('timeline', timeline);
      await window.RPEvents.emit('conversation:changed', { reason: 'timeline-restore', messages: clone(node.messages) });
      return { ok: true, node: clone(node) };
    }
  };

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
    var ball = document.createElement('button');
    ball.id = 'rpCapabilityBall';
    ball.type = 'button';
    ball.textContent = '⌘';
    ball.title = '卡内运行时工具';
    ball.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483000;width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:#18253b;color:#dce8ff;box-shadow:0 8px 28px rgba(0,0,0,.28);cursor:pointer;';
    var panel = document.createElement('aside');
    panel.id = 'rpCapabilityPanel';
    panel.hidden = true;
    panel.style.cssText = 'position:fixed;right:14px;bottom:64px;z-index:2147482999;width:min(340px,calc(100vw - 28px));max-height:min(60vh,520px);overflow:auto;padding:14px;border:1px solid rgba(160,190,230,.35);border-radius:14px;background:rgba(12,20,34,.96);color:#e9f1ff;font:13px/1.5 system-ui;box-shadow:0 16px 40px rgba(0,0,0,.4);';
    function render() {
      var state = window.RPStorage.getCanonical();
      panel.innerHTML = '<strong>运行时浮层</strong><p style="opacity:.75">不占主舞台空间，按需打开。</p>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">' +
        (window.RPPlugins.isEnabled('runtime.prompt-inspector') ? '<button data-cap-view="prompt">本轮提示词</button>' : '') +
        (window.RPPlugins.isEnabled('runtime.notebook') ? '<button data-cap-view="notes">便签</button>' : '') +
        (window.RPPlugins.isEnabled('runtime.timeline') ? '<button data-cap-view="timeline">时间线</button>' : '') +
        (window.RPPlugins.isEnabled('runtime.persona-switcher') ? '<button data-cap-view="persona">Persona</button>' : '') +
        '</div><pre id="rpCapabilityOutput" style="white-space:pre-wrap;word-break:break-word">' +
        escapeHtml(JSON.stringify({ player: state.player, scene: state.scene, rpg: state.rpg }, null, 2)) + '</pre>';
      panel.querySelectorAll('[data-cap-view]').forEach(function (button) {
        button.addEventListener('click', function () {
          var value = {};
          if (button.dataset.capView === 'prompt') value = window.RPPromptInspector.snapshot();
          if (button.dataset.capView === 'notes') value = window.RPNotebook.list();
          if (button.dataset.capView === 'timeline') value = window.RPTimeline.list();
          if (button.dataset.capView === 'persona') value = window.RPPersonas.list();
          panel.querySelector('#rpCapabilityOutput').textContent = JSON.stringify(value, null, 2);
        });
      });
    }
    function escapeHtml(value) { return String(value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
    ball.addEventListener('click', function () { panel.hidden = !panel.hidden; if (!panel.hidden) render(); });
    document.body.appendChild(ball); document.body.appendChild(panel);
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

  window.RPTimeline = timelineApi;
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

  window.RPPlugins.attach('runtime.timeline', {
    activate: function () { window.RPEvents.on('conversation:changed', function (payload) { if (payload.reason === 'generation-complete' || payload.reason === 'user-message') snapshot(payload.reason); }, { owner: 'runtime.timeline' }); }
  });
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
      commandApi.register('/checkpoint', function (label) { return timelineApi.checkpoint(label); }, '创建时间线检查点');
      commandApi.register('/timeline', function () { return timelineApi.list(); }, '查看时间线节点');
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
