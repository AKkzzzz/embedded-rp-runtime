(function () {
  'use strict';

  var activeFinish = null;

  function open(message, options) {
    options = options || {};
    if (activeFinish) activeFinish(false);
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      var previousFocus = document.activeElement;
      overlay.className = 'rp-dialog-overlay';
      overlay.innerHTML = '<div class="rp-dialog" role="alertdialog" aria-modal="true">' +
        '<p class="rp-dialog-message"></p><div class="rp-dialog-actions">' +
        '<button type="button" class="secondary" data-rp-dialog-cancel hidden>取消</button>' +
        '<button type="button" class="primary" data-rp-dialog-ok></button></div></div>';
      overlay.querySelector('.rp-dialog-message').textContent = String(message == null ? '' : message);
      var ok = overlay.querySelector('[data-rp-dialog-ok]');
      var cancel = overlay.querySelector('[data-rp-dialog-cancel]');
      ok.textContent = options.okText || '确定';
      if (options.danger) ok.classList.add('danger');
      if (options.mode === 'confirm') {
        cancel.hidden = false;
        cancel.textContent = options.cancelText || '取消';
      }
      function finish(value) {
        activeFinish = null;
        document.removeEventListener('keydown', onKeydown, true);
        overlay.remove();
        if (previousFocus && previousFocus.focus) try { previousFocus.focus(); } catch (_error) {}
        resolve(value);
      }
      function onKeydown(event) {
        if (event.key === 'Escape') { event.preventDefault(); finish(false); }
        else if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      }
      ok.onclick = function () { finish(true); };
      cancel.onclick = function () { finish(false); };
      overlay.addEventListener('mousedown', function (event) { if (event.target === overlay) finish(false); });
      document.addEventListener('keydown', onKeydown, true);
      activeFinish = finish;
      // Fullscreen promotes only the fullscreen element into the top layer.
      // Keep dialogs inside it so alerts remain visible and clickable.
      var dialogRoot = document.fullscreenElement || document.getElementById('runtimeShell') || document.body;
      dialogRoot.appendChild(overlay);
      ok.focus();
    });
  }

  window.RPDialog = {
    confirm: function (message, options) { return open(message, Object.assign({ mode: 'confirm' }, options)); },
    alert: function (message, options) { return open(message, Object.assign({ mode: 'alert' }, options)).then(function () {}); }
  };
})();
