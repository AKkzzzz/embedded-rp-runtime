(function () {
  'use strict';

  var view = {
    query: '',
    role: 'all',
    status: 'all',
    selectedId: null,
    notice: ''
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function visiblePresets() {
    var query = view.query.trim().toLowerCase();
    return window.RPPresets.list().filter(function (preset) {
      var matchesQuery = !query || [
        preset.name,
        preset.id,
        preset.content,
        preset.source && preset.source.project
      ].join(' ').toLowerCase().includes(query);
      var matchesRole = view.role === 'all' || preset.role === view.role;
      var matchesStatus = view.status === 'all' ||
        (view.status === 'enabled' && preset.runtimeEnabled) ||
        (view.status === 'disabled' && !preset.runtimeEnabled) ||
        (view.status === 'custom' && !preset.builtin);
      return matchesQuery && matchesRole && matchesStatus;
    });
  }

  function selectedPreset(items) {
    var selected = items.find(function (preset) { return preset.id === view.selectedId; });
    if (!selected && items.length) {
      view.selectedId = items[0].id;
      selected = items[0];
    }
    return selected || null;
  }

  function option(value, label, selected) {
    return '<option value="' + value + '"' + (selected === value ? ' selected' : '') + '>' + label + '</option>';
  }

  function listItem(preset) {
    var classes = 'preset-list-item' + (preset.id === view.selectedId ? ' active' : '');
    var state = preset.runtimeEnabled ? '启用' : '关闭';
    return '<button type="button" class="' + classes + '" data-preset-select="' + escapeHtml(preset.id) + '">' +
      '<span class="preset-list-main"><strong>' + escapeHtml(preset.name) + '</strong>' +
      '<small>' + escapeHtml(preset.role + ' · ' + preset.phase) + '</small></span>' +
      '<span class="preset-list-side"><em class="' + (preset.runtimeEnabled ? 'is-on' : '') + '">' + state + '</em>' +
      '<small>' + (preset.builtin ? '内置' : '自定义') + '</small></span></button>';
  }

  function editor(preset, position, total) {
    if (!preset) {
      return '<section class="preset-empty"><h3>没有匹配的预设</h3><p>调整筛选条件，或新建、导入一组 RP-Hub 预设。</p></section>';
    }
    var source = preset.source || {};
    var locked = preset.locked;
    var readonly = locked ? ' readonly' : '';
    var disabled = locked ? ' disabled' : '';
    return '<section class="preset-editor">' +
      '<header class="preset-editor-head"><div><p class="eyebrow">PRESET ' + (position + 1) + ' / ' + total + '</p>' +
      '<h3>' + escapeHtml(preset.name) + '</h3><p class="tiny">' + escapeHtml(preset.id) + '</p></div>' +
      '<div class="preset-page-actions"><button type="button" data-preset-prev aria-label="上一条">←</button>' +
      '<button type="button" data-preset-next aria-label="下一条">→</button></div></header>' +
      '<div class="preset-form-grid">' +
      '<label class="field wide"><span>名称</span><input id="presetName" value="' + escapeHtml(preset.name) + '"' + readonly + '></label>' +
      '<label class="field"><span>角色</span><select id="presetRole"' + disabled + '>' +
      option('system', 'system', preset.role) + option('user', 'user', preset.role) + option('assistant', 'assistant', preset.role) + '</select></label>' +
      '<label class="field"><span>注入阶段</span><select id="presetPhase"' + disabled + '>' +
      option('system-root', 'system-root', preset.phase) + option('system-support', 'system-support', preset.phase) +
      option('prelude', 'prelude', preset.phase) + '</select></label>' +
      '<label class="field"><span>顺位</span><input id="presetOrder" type="number" value="' + Number(preset.order || 0) + '"' + readonly + '></label>' +
      '<label class="field check-field"><span>运行状态</span><input id="presetEnabled" type="checkbox"' +
      (preset.runtimeEnabled ? ' checked' : '') + disabled + '></label>' +
      '<label class="field wide"><span>提示词内容 · ' + String(preset.content || '').length + ' 字符</span>' +
      '<textarea id="presetContent" rows="15"' + readonly + '>' + escapeHtml(preset.content) + '</textarea></label></div>' +
      '<div class="preset-source"><span>来源：' + escapeHtml(source.project || 'unknown') + '</span>' +
      '<span>许可：' + escapeHtml(source.license || '未声明') + '</span>' +
      '<span>' + (preset.builtin ? '模板内置' : '用户管理') + '</span>' +
      (locked ? '<span>内核锁定</span>' : '') + '</div>' +
      '<footer class="preset-editor-actions">' +
      '<button type="button" class="primary" data-preset-save' + disabled + '>保存修改</button>' +
      '<button type="button" data-preset-duplicate>复制为新预设</button>' +
      (preset.builtin && !locked ? '<button type="button" data-preset-restore>恢复此内置项</button>' : '') +
      (!preset.builtin ? '<button type="button" class="danger" data-preset-delete>删除</button>' : '') +
      '</footer></section>';
  }

  function downloadJson(filename, payload) {
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function render(target) {
    var items = visiblePresets();
    var selected = selectedPreset(items);
    var position = selected ? items.findIndex(function (preset) { return preset.id === selected.id; }) : -1;
    target.innerHTML =
      '<div class="preset-toolbar">' +
      '<input id="presetSearch" type="search" placeholder="搜索名称、ID、来源或内容" value="' + escapeHtml(view.query) + '">' +
      '<select id="presetRoleFilter" aria-label="角色筛选">' +
      option('all', '全部角色', view.role) + option('system', 'system', view.role) +
      option('user', 'user', view.role) + option('assistant', 'assistant', view.role) + '</select>' +
      '<select id="presetStatusFilter" aria-label="状态筛选">' +
      option('all', '全部状态', view.status) + option('enabled', '仅启用', view.status) +
      option('disabled', '仅关闭', view.status) + option('custom', '仅自定义', view.status) + '</select>' +
      '<button type="button" data-preset-new>新建</button>' +
      '<button type="button" data-preset-import>导入 RP-Hub</button>' +
      '<input id="presetImportFile" type="file" accept=".json,application/json" hidden>' +
      '<button type="button" data-preset-export-current' + (selected ? '' : ' disabled') + '>导出当前</button>' +
      '<button type="button" data-preset-export-all>导出全部</button>' +
      '<button type="button" data-preset-reset>恢复默认</button></div>' +
      (view.notice ? '<div class="preset-notice">' + escapeHtml(view.notice) + '</div>' : '') +
      '<div class="preset-manager">' +
      '<aside class="preset-browser"><header><strong>' + items.length + ' 条结果</strong><span class="tiny">点击条目查看</span></header>' +
      '<div class="preset-list">' + (items.map(listItem).join('') || '<p class="muted">没有匹配项</p>') + '</div></aside>' +
      editor(selected, position, items.length) + '</div>';

    bind(target, items, selected, position);
  }

  function bind(target, items, selected, position) {
    target.querySelector('#presetSearch').oninput = function () {
      view.query = this.value;
      render(target);
      var input = target.querySelector('#presetSearch');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    };
    target.querySelector('#presetRoleFilter').onchange = function () {
      view.role = this.value;
      render(target);
    };
    target.querySelector('#presetStatusFilter').onchange = function () {
      view.status = this.value;
      render(target);
    };
    target.querySelectorAll('[data-preset-select]').forEach(function (button) {
      button.onclick = function () {
        view.selectedId = button.dataset.presetSelect;
        view.notice = '';
        render(target);
      };
    });
    target.querySelector('[data-preset-new]').onclick = function () {
      var created = window.RPPresets.create({
        name: '新预设',
        role: 'system',
        phase: 'system-support',
        content: '在这里填写提示词内容。'
      });
      view.selectedId = created.id;
      view.query = '';
      view.role = 'all';
      view.status = 'all';
      view.notice = '已创建自定义预设。';
      render(target);
    };
    target.querySelector('[data-preset-import]').onclick = function () {
      target.querySelector('#presetImportFile').click();
    };
    target.querySelector('#presetImportFile').onchange = function () {
      var input = this;
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var result = window.RPPresets.importRpHub(JSON.parse(reader.result));
          if (result.imported.length) view.selectedId = result.imported[0].id;
          view.query = '';
          view.role = 'all';
          view.status = 'all';
          view.notice = '导入 ' + result.imported.length + ' 条' +
            (result.errors.length ? '，跳过 ' + result.errors.length + ' 条：' + result.errors.join('；') : '，格式与 RP-Hub 兼容。');
        } catch (error) {
          view.notice = '导入失败：' + error.message;
        }
        input.value = '';
        render(target);
      };
      reader.readAsText(file);
    };
    target.querySelector('[data-preset-export-all]').onclick = function () {
      downloadJson('presets.json', window.RPPresets.exportRpHub());
      view.notice = '已按 RP-Hub 直接数组格式导出全部预设。';
      render(target);
    };
    var currentExport = target.querySelector('[data-preset-export-current]');
    if (currentExport) currentExport.onclick = function () {
      downloadJson('presets-' + selected.id + '.json', window.RPPresets.exportRpHub([selected.id]));
      view.notice = '已按 RP-Hub 直接数组格式导出当前预设。';
      render(target);
    };
    target.querySelector('[data-preset-reset]').onclick = function () {
      if (!window.confirm('恢复默认会删除全部自定义预设和本地修改，继续吗？')) return;
      window.RPPresets.reset();
      view.selectedId = null;
      view.query = '';
      view.role = 'all';
      view.status = 'all';
      view.notice = '预设库已恢复为模板默认状态。';
      render(target);
    };

    if (!selected) return;
    target.querySelector('[data-preset-prev]').onclick = function () {
      view.selectedId = items[(position - 1 + items.length) % items.length].id;
      render(target);
    };
    target.querySelector('[data-preset-next]').onclick = function () {
      view.selectedId = items[(position + 1) % items.length].id;
      render(target);
    };
    target.querySelector('[data-preset-duplicate]').onclick = function () {
      var copy = window.RPPresets.duplicate(selected.id);
      view.selectedId = copy.id;
      view.query = '';
      view.role = 'all';
      view.status = 'all';
      view.notice = '已复制为可编辑的自定义预设。';
      render(target);
    };
    var save = target.querySelector('[data-preset-save]');
    if (save) save.onclick = function () {
      var result = window.RPPresets.update(selected.id, {
        name: target.querySelector('#presetName').value,
        role: target.querySelector('#presetRole').value,
        phase: target.querySelector('#presetPhase').value,
        order: Number(target.querySelector('#presetOrder').value),
        enabled: target.querySelector('#presetEnabled').checked,
        content: target.querySelector('#presetContent').value
      });
      view.notice = result.ok ? '修改已保存到本机。' : '保存失败：提示词内容不能为空。';
      render(target);
    };
    var restore = target.querySelector('[data-preset-restore]');
    if (restore) restore.onclick = function () {
      window.RPPresets.restoreBuiltin(selected.id);
      view.notice = '此内置预设已恢复。';
      render(target);
    };
    var remove = target.querySelector('[data-preset-delete]');
    if (remove) remove.onclick = function () {
      if (!window.confirm('删除自定义预设“' + selected.name + '”吗？')) return;
      window.RPPresets.remove(selected.id);
      view.selectedId = null;
      view.notice = '自定义预设已删除。';
      render(target);
    };
  }

  window.RPPresetManager = {
    render: render
  };
})();
