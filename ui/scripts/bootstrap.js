(function () {
  'use strict';

  function downloadJson(name, value) {
    var blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  async function initialize() {
    document.querySelectorAll('[data-page]').forEach(function (button) {
      button.onclick = function () { window.RPDebugConsole.activate(button.dataset.page); };
    });

    var caps = await window.RPHost.detect();
    if (window.RPStorage.syncMemoryFromHost && window.RPHost.memorySettings) {
      window.RPStorage.syncMemoryFromHost(window.RPHost.memorySettings());
    }
    await window.RPPlugins.activateAll();
    await window.RPConversation.init();
    await window.RPMemory.init();
    await window.RPVectorMemory.init();
    setTimeout(function () {
      var memoryModules = window.RPStorage.getPreferences().memoryModules || {};
      if (memoryModules.memoryMode !== 'vector' && window.RPSummary && window.RPConversation) {
        window.RPSummary.patrol(window.RPConversation.list()).catch(function () {});
      }
    }, 0);
    var hostChip = document.getElementById('hostChip');
    hostChip.textContent = caps.sameOriginSettings ? 'RP-Hub 配置已接入' : '等待 RP-Hub API 设置';
    hostChip.classList.add(caps.sameOriginSettings ? 'ok' : 'degraded');

    window.RPConversationConsole.init();
    window.RPDebugConsole.renderAll();
    var initialPage = window.RPStorage.getPreferences().activeDebugPage || 'overview';
    window.RPDebugConsole.activate(initialPage);

    document.getElementById('startButton').onclick = async function () {
      var state = window.RPStorage.getCanonical();
      var result = window.RPStateGuard.applyPatch(state, {
        runtime: {
          mode: 'game',
        renderer: 'none',
          started: true
        }
      }, window.RPTemplateData.stateSchema);
      if (!result.ok) {
        await window.RPDialog.alert('启动状态未通过校验：\n' + result.errors.join('\n'));
        return;
      }
      window.RPStorage.saveCanonical(result.value);
      document.querySelector('.runtime-topbar').hidden = true;
      document.querySelector('.runtime-layout').hidden = true;
      document.getElementById('gameSurface').hidden = false;
      window.RPConversationConsole.render();
      await window.RPEvents.emit('runtime:start', { renderer: 'none' });
    };

    var gameDebugToggle = document.getElementById('gameDebugToggle');
    function syncGameDebugToggle() {
      if (!gameDebugToggle) return;
      var enabled = window.RPDebugOverlay && window.RPDebugOverlay.enabled
        ? window.RPDebugOverlay.enabled()
        : Boolean(window.RPStorage.getPreferences().debugEnabled);
      gameDebugToggle.textContent = enabled ? '调试：开' : '调试：关';
      gameDebugToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      gameDebugToggle.title = enabled ? '关闭卡内调试浮球' : '开启卡内调试浮球';
    }
    if (gameDebugToggle) {
      gameDebugToggle.onclick = function () {
        var current = window.RPDebugOverlay && window.RPDebugOverlay.enabled
          ? window.RPDebugOverlay.enabled()
          : Boolean(window.RPStorage.getPreferences().debugEnabled);
        if (window.RPDebugOverlay && window.RPDebugOverlay.setEnabled) {
          window.RPDebugOverlay.setEnabled(!current);
        } else {
          window.RPStorage.savePreferences({ debugEnabled: !current });
        }
        syncGameDebugToggle();
      };
      syncGameDebugToggle();
      window.RPEvents.on('storage:preferences:changed', syncGameDebugToggle, { owner: 'runtime.game-debug-toggle' });
    }

    document.getElementById('backToDebug').onclick = function () {
      document.getElementById('gameSurface').hidden = true;
      document.querySelector('.runtime-layout').hidden = false;
      document.querySelector('.runtime-topbar').hidden = false;
      window.RPDebugConsole.renderAll();
    };

    document.getElementById('exportButton').onclick = function () {
      downloadJson('embedded-rp-runtime-diagnostic.json', {
        diagnostics: window.RPDiagnostics.snapshot(),
        save: window.RPStorage.exportBundle()
      });
    };

    document.getElementById('exportSaveButton').onclick = async function () {
      try {
        var bundle = await window.RPStorage.exportFullBundle();
        downloadJson(window.RPTemplateData.app.id + '-save.json', bundle);
      } catch (error) {
        await window.RPDialog.alert('导出存档失败：' + String(error && error.message || error));
      }
    };

    var importInput = document.getElementById('importSaveFile');
    document.getElementById('importSaveButton').onclick = function () {
      importInput.value = '';
      importInput.click();
    };
    importInput.onchange = async function () {
      var file = importInput.files && importInput.files[0];
      if (!file) return;
      try {
        var bundle = JSON.parse(await file.text());
        var inspection = window.RPStorage.inspectBundle(bundle);
        if (!inspection.ok) throw new Error(inspection.errors.join('；'));
        var confirmed = await window.RPDialog.confirm(
          '导入后会替换当前人物、剧情、对话、记忆和本地设置。\n' +
          '对话 ' + inspection.messageCount + ' 条 · 结构化记忆 ' + inspection.structuredMemoryCount +
          ' 条 · 向量 ' + inspection.vectorCount + ' 条',
          { okText: '确认导入', danger: true }
        );
        if (!confirmed) return;
        await window.RPStorage.importBundle(bundle);
        await window.RPDialog.alert('存档已导入，运行时将重新载入。');
        window.location.reload();
      } catch (error) {
        await window.RPDialog.alert('导入存档失败：' + String(error && error.message || error));
      }
    };

    var fullscreenButton = document.getElementById('debugFullscreenButton');
    var shell = document.getElementById('runtimeShell');
    function setFullscreenState(active) {
      shell.classList.toggle('debug-fullscreen', active);
      document.body.classList.toggle('debug-fullscreen-body', active);
      fullscreenButton.textContent = active ? '退出全屏' : '全屏';
      fullscreenButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    async function toggleDebugFullscreen() {
      var active = Boolean(document.fullscreenElement) || shell.classList.contains('debug-fullscreen');
      if (active) {
        if (document.fullscreenElement && document.exitFullscreen) {
          try { await document.exitFullscreen(); } catch (_error) {}
        }
        setFullscreenState(false);
        return;
      }
      if (shell.requestFullscreen) {
        try {
          await shell.requestFullscreen();
          setFullscreenState(true);
          return;
        } catch (_error) {}
      }
      // iOS/Sandbox fallback: fill the iframe viewport without using the browser chrome.
      setFullscreenState(true);
    }
    fullscreenButton.onclick = toggleDebugFullscreen;
    document.addEventListener('fullscreenchange', function () {
      setFullscreenState(Boolean(document.fullscreenElement));
    });

    window.RPEvents.emit('runtime:ready', {
      app: window.RPTemplateData.app,
      capabilities: caps
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
