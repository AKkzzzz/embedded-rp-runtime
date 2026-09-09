(function () {
  'use strict';

  var initialized = false;
  var imageState = { phase: 'idle', id: '', message: '' };
  var generationState = { phase: 'idle', error: '', content: '' };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function render() {
    var log = document.getElementById('conversationLog');
    if (!log) return;
    var messages = window.RPConversation.list();
    log.innerHTML = messages.length ? messages.map(function (message) {
      var reasoning = message.reasoning ? '<details><summary>推理内容</summary><pre>' +
        escapeHtml(message.reasoning) + '</pre></details>' : '';
      return '<article class="conversation-message ' + escapeHtml(message.role) + '" data-message-id="' +
        escapeHtml(message.id) + '"><header><strong>' + (message.role === 'user' ? '玩家' : '叙事') +
        '</strong><span>' + escapeHtml(message.status) + '</span></header><div class="message-content">' +
        escapeHtml(message.content).replace(/\n/g, '<br>') + '</div>' + reasoning +
        '<div class="message-tools"><button type="button" data-edit-message="' + escapeHtml(message.id) +
        '">编辑</button><button type="button" data-remove-message="' + escapeHtml(message.id) +
        '">删除</button></div></article>';
    }).join('') : '<div class="conversation-empty"><p class="eyebrow">READY</p><h3>单舞台运行时已就绪</h3><p>发送第一条内容后，预设、世界书、状态和历史会在卡内编译，再使用 RP-Hub 当前模型流式生成。</p></div>';
    var generating = window.RPConversation.isGenerating();
    var lastAssistant = messages.slice().reverse().find(function (message) { return message.role === 'assistant'; });
    var hasVisibleResponse = Boolean(lastAssistant && String(lastAssistant.content || '').trim());
    document.getElementById('sendConversationButton').hidden = generating;
    document.getElementById('stopGenerationButton').hidden = !generating;
    var retryable = window.RPConversation.canRetryLastGeneration && window.RPConversation.canRetryLastGeneration();
    var regenerateButton = document.getElementById('regenerateButton');
    regenerateButton.textContent = retryable ? '重试 / 重roll' : '重生成';
    regenerateButton.title = retryable
      ? '重放刚才失败的请求，不重复追加玩家输入'
      : '重新生成最近一条助手回复';
    var hasAction = Boolean(window.RPConversation.lastAction && window.RPConversation.lastAction());
    var retryActionButton = document.getElementById('retryActionButton');
    var reviseActionButton = document.getElementById('reviseActionButton');
    retryActionButton.disabled = generating || !hasAction;
    reviseActionButton.disabled = generating || !hasAction;
    var gameStatus = document.getElementById('gameStatus');
    var generationText = generating || generationState.phase === 'starting' || generationState.phase === 'thinking' || generationState.phase === 'writing'
      ? '响应中'
      : generationState.phase === 'error'
        ? '生成失败'
        : generationState.phase === 'stopped'
          ? '已停止'
          : generationState.phase === 'complete'
            ? (hasVisibleResponse ? '已完成' : '未生成正文')
            : '待机';
    gameStatus.textContent = generationText;
    gameStatus.classList.toggle('ok', generating || generationState.phase === 'starting' || generationState.phase === 'thinking' || generationState.phase === 'writing' || generationState.phase === 'complete' && hasVisibleResponse);
    gameStatus.classList.toggle('error', generationState.phase === 'error');
    gameStatus.classList.toggle('degraded', generationState.phase === 'stopped' || generationState.phase === 'idle');
    gameStatus.title = generationState.phase === 'error'
      ? generationState.error || '主模型生成失败'
      : generationState.phase === 'complete' && !hasVisibleResponse
        ? '模型请求完成，但没有得到可显示的正文。'
        : '';
    var generationError = document.getElementById('conversationError');
    if (generationError && generationState.phase === 'error') {
      generationError.textContent = '主模型生成失败：' + (generationState.error || '未知原因');
      generationError.hidden = false;
    } else if (generationError && generationState.phase === 'complete' && !hasVisibleResponse) {
      generationError.textContent = '模型请求已完成，但没有生成可显示的正文。可以点击“重试 / 重roll”重新请求。';
      generationError.hidden = false;
    }
    var imageStatus = document.getElementById('imageGenerationStatus');
    if (imageStatus) {
      var imageText = imageState.phase === 'starting' || imageState.phase === 'generating'
        ? '生图中……'
        : imageState.phase === 'error'
          ? '生成失败：' + (imageState.message || '未知原因')
          : imageState.phase === 'complete'
            ? '图片已生成'
            : '';
      imageStatus.textContent = imageText;
      imageStatus.hidden = !imageText;
      imageStatus.dataset.phase = imageState.phase;
      imageStatus.title = imageState.phase === 'error' ? imageState.message : '';
    }
    log.querySelectorAll('[data-edit-message]').forEach(function (button) {
      button.onclick = async function () {
        var message = window.RPConversation.list().find(function (item) { return item.id === button.dataset.editMessage; });
        var next = prompt('编辑消息；保存后会截断它后面的历史。', message && message.content || '');
        if (next == null) return;
        try {
          await window.RPConversation.edit(button.dataset.editMessage, next);
        } catch (error) {
          showError(error);
        }
      };
    });
    log.querySelectorAll('[data-remove-message]').forEach(function (button) {
      button.onclick = function () {
        window.RPConversation.remove(button.dataset.removeMessage).catch(showError);
      };
    });
    requestAnimationFrame(function () { log.scrollTop = log.scrollHeight; });
  }

  function showError(error) {
    var target = document.getElementById('conversationError');
    var message = String(error && error.message || error || '未知错误');
    target.textContent = generationState.phase === 'error' ? '主模型生成失败：' + message : message;
    target.hidden = false;
  }

  function clearError() {
    document.getElementById('conversationError').hidden = true;
  }

  function init() {
    if (initialized) return;
    initialized = true;
    var input = document.getElementById('conversationInput');
    document.getElementById('sendConversationButton').onclick = function () {
      clearError();
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      if (text.charAt(0) === '/' && window.RPCommands && window.RPPlugins.isEnabled('runtime.command-registry')) {
        window.RPCommands.execute(text).then(function (result) {
          if (result.handled) {
            var output = typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2);
            var target = document.getElementById('conversationError');
            target.textContent = output;
            target.hidden = false;
            return;
          }
          window.RPConversation.send(text).catch(showError);
        }).catch(showError);
        return;
      }
      window.RPConversation.send(text).catch(showError);
    };
    document.getElementById('stopGenerationButton').onclick = function () {
      window.RPConversation.stop();
    };
    document.getElementById('continueButton').onclick = function () {
      clearError();
      window.RPConversation.continueLast().catch(showError);
    };
    document.getElementById('regenerateButton').onclick = function () {
      clearError();
      var retryable = window.RPConversation.canRetryLastGeneration && window.RPConversation.canRetryLastGeneration();
      var operation = retryable
        ? window.RPConversation.retryLastGeneration()
        : window.RPConversation.regenerate();
      operation.catch(showError);
    };
    document.getElementById('retryActionButton').onclick = function () {
      clearError();
      window.RPConversation.retryLastAction().catch(showError);
    };
    document.getElementById('reviseActionButton').onclick = function () {
      clearError();
      var current = window.RPConversation.lastAction();
      var revised = prompt('改写最近一次玩家行动；原回复和其状态结算会被替换。', current);
      if (revised == null || !revised.trim() || revised.trim() === current.trim()) return;
      window.RPConversation.reviseLastAction(revised).catch(showError);
    };
    document.getElementById('clearConversationButton').onclick = async function () {
      clearError();
      if (await window.RPDialog.confirm('清空卡内全部聊天历史？')) window.RPConversation.clear().catch(showError);
    };
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        document.getElementById('sendConversationButton').click();
      }
    });
    window.RPEvents.on('conversation:changed', render, { owner: 'conversation-console' });
    if (window.RPGenerationMonitor) {
      window.RPGenerationMonitor.subscribe(function (snapshot) {
        generationState = snapshot || generationState;
        render();
      });
    }
    function syncImageState(payload, phase) {
      payload = payload || {};
      imageState = {
        phase: phase || payload.phase || 'idle',
        id: String(payload.id || ''),
        message: String(payload.message || '')
      };
      render();
    }
    window.RPEvents.on('image:requested', function (payload) { syncImageState(payload, 'starting'); }, { owner: 'conversation-console.image-status' });
    window.RPEvents.on('image:generating', function (payload) { syncImageState(payload, 'generating'); }, { owner: 'conversation-console.image-status' });
    window.RPEvents.on('image:generated', function (payload) { syncImageState(payload, 'complete'); }, { owner: 'conversation-console.image-status' });
    window.RPEvents.on('image:generation-error', function (payload) { syncImageState(payload, 'error'); }, { owner: 'conversation-console.image-status' });
    if (window.RPImageGen && window.RPImageGen.latestStatus) {
      var latestImage = window.RPImageGen.latestStatus();
      if (latestImage && latestImage.phase && latestImage.phase !== 'idle') imageState = latestImage;
    }
    render();
  }

  window.RPConversationConsole = { init: init, render: render };
})();
