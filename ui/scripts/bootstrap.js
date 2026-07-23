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
    await window.RPVectorMemory.init();
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
        alert('启动状态未通过校验：\n' + result.errors.join('\n'));
        return;
      }
      window.RPStorage.saveCanonical(result.value);
      document.querySelector('.runtime-topbar').hidden = true;
      document.querySelector('.runtime-layout').hidden = true;
      document.getElementById('gameSurface').hidden = false;
      window.RPConversationConsole.render();
      await window.RPEvents.emit('runtime:start', { renderer: 'none' });
    };

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
