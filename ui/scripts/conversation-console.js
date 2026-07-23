(function () {
  'use strict';

  var initialized = false;

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
    document.getElementById('sendConversationButton').hidden = generating;
    document.getElementById('stopGenerationButton').hidden = !generating;
    document.getElementById('gameStatus').textContent = generating ? '生成中' : '待机';
    document.getElementById('gameStatus').classList.toggle('ok', generating);
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
    target.textContent = String(error && error.message || error);
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
      window.RPConversation.regenerate().catch(showError);
    };
    document.getElementById('clearConversationButton').onclick = function () {
      clearError();
      if (confirm('清空卡内全部聊天历史？')) window.RPConversation.clear().catch(showError);
    };
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        document.getElementById('sendConversationButton').click();
      }
    });
    window.RPEvents.on('conversation:changed', render, { owner: 'conversation-console' });
    render();
  }

  window.RPConversationConsole = { init: init, render: render };
})();
