(function () {
  'use strict';

  var authored = window.RPTemplateData.presets;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function preferences() {
    return window.RPStorage.getPreferences();
  }

  function normalizeRole(value) {
    var role = String(value || 'system').toLowerCase();
    return ['system', 'user', 'assistant'].includes(role) ? role : 'system';
  }

  function defaultPhase(role) {
    return role === 'system' ? 'system-support' : 'prelude';
  }

  function normalizePhase(value, role) {
    if (role !== 'system') return 'prelude';
    return ['system-root', 'system-support'].includes(value) ? value : 'system-support';
  }

  function safeId(value) {
    var slug = String(value || 'preset')
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 42) || 'preset';
    var existing = new Set(allRaw().map(function (preset) { return preset.id; }));
    var candidate = 'custom-' + slug;
    var suffix = 2;
    while (existing.has(candidate)) {
      candidate = 'custom-' + slug + '-' + suffix;
      suffix += 1;
    }
    return candidate;
  }

  function customPresets() {
    var custom = preferences().presetCustom;
    return Array.isArray(custom) ? custom : [];
  }

  function edits() {
    var value = preferences().presetEdits;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function allRaw() {
    var overrides = edits();
    var builtins = authored.map(function (preset) {
      var allowed = preset.locked ? {} : (overrides[preset.id] || {});
      return Object.assign(clone(preset), clone(allowed), {
        id: preset.id,
        locked: Boolean(preset.locked),
        builtin: true
      });
    });
    return builtins.concat(customPresets().map(function (preset) {
      return Object.assign(clone(preset), {
        locked: false,
        builtin: false
      });
    }));
  }

  function enabled(preset) {
    if (preset.locked) return true;
    var overrides = preferences().presetEnabled || {};
    return Object.prototype.hasOwnProperty.call(overrides, preset.id)
      ? overrides[preset.id] !== false
      : preset.enabled !== false;
  }

  function ordered() {
    var order = preferences().presetOrder || [];
    var positions = new Map(order.map(function (id, index) { return [id, index]; }));
    return allRaw().sort(function (a, b) {
      var aPosition = positions.has(a.id) ? positions.get(a.id) : Number.MAX_SAFE_INTEGER;
      var bPosition = positions.has(b.id) ? positions.get(b.id) : Number.MAX_SAFE_INTEGER;
      return aPosition - bPosition || Number(b.order || 0) - Number(a.order || 0) || a.id.localeCompare(b.id);
    });
  }

  function list() {
    return ordered().map(function (preset, index) {
      return Object.assign(clone(preset), {
        runtimeEnabled: enabled(preset),
        runtimeIndex: index
      });
    });
  }

  function byId(id) {
    return list().find(function (preset) { return preset.id === id; }) || null;
  }

  function setEnabled(id, value) {
    var source = allRaw();
    var target = source.find(function (preset) { return preset.id === id; });
    if (!target || target.locked) return false;
    var overrides = Object.assign({}, preferences().presetEnabled || {});
    if (value && target.exclusiveGroup) {
      source.forEach(function (preset) {
        if (preset.id !== id && preset.exclusiveGroup === target.exclusiveGroup) overrides[preset.id] = false;
      });
    }
    overrides[id] = Boolean(value);
    window.RPStorage.savePreferences({ presetEnabled: overrides });
    window.RPEvents.emit('presets:changed', { id: id, enabled: Boolean(value) });
    return true;
  }

  function saveCustom(items) {
    window.RPStorage.savePreferences({ presetCustom: items });
  }

  function create(input) {
    var role = normalizeRole(input && (input.role || input.presetRole || input.type));
    var name = String(input && input.name || '未命名预设').trim() || '未命名预设';
    var preset = {
      id: safeId(name),
      name: name,
      role: role,
      phase: normalizePhase(input && input.phase, role),
      order: Number.isFinite(Number(input && input.order)) ? Number(input.order) : 500,
      enabled: input && input.enabled !== undefined ? input.enabled !== false : true,
      locked: false,
      builtin: false,
      source: clone(input && input.source || {
        project: '用户预设',
        license: 'user-provided'
      }),
      content: String(input && input.content || '')
    };
    var items = customPresets();
    items.push(preset);
    saveCustom(items);
    setEnabled(preset.id, preset.enabled);
    window.RPEvents.emit('presets:changed', { id: preset.id, created: true });
    return byId(preset.id);
  }

  function update(id, patch) {
    var target = allRaw().find(function (preset) { return preset.id === id; });
    if (!target || target.locked) return { ok: false, error: 'locked-or-missing' };
    var role = normalizeRole(patch && patch.role !== undefined ? patch.role : target.role);
    var next = {
      name: String(patch && patch.name !== undefined ? patch.name : target.name).trim() || target.name,
      role: role,
      phase: normalizePhase(patch && patch.phase !== undefined ? patch.phase : target.phase, role),
      content: String(patch && patch.content !== undefined ? patch.content : target.content),
      order: Number.isFinite(Number(patch && patch.order)) ? Number(patch.order) : Number(target.order || 0)
    };
    if (!next.content.trim()) return { ok: false, error: 'empty-content' };

    if (target.builtin) {
      var overrideMap = Object.assign({}, edits());
      overrideMap[id] = next;
      window.RPStorage.savePreferences({ presetEdits: overrideMap });
    } else {
      var items = customPresets().map(function (preset) {
        return preset.id === id ? Object.assign({}, preset, next) : preset;
      });
      saveCustom(items);
    }
    if (patch && patch.enabled !== undefined) setEnabled(id, patch.enabled);
    window.RPEvents.emit('presets:changed', { id: id, updated: true });
    return { ok: true, preset: byId(id) };
  }

  function duplicate(id) {
    var target = byId(id);
    if (!target) return null;
    return create({
      name: target.name + ' · 副本',
      role: target.role,
      phase: target.phase,
      order: target.order,
      enabled: target.runtimeEnabled,
      content: target.content,
      source: { project: '卡内复制', license: 'user-provided', derivedFrom: target.id }
    });
  }

  function remove(id) {
    var target = allRaw().find(function (preset) { return preset.id === id; });
    if (!target || target.locked || target.builtin) return false;
    saveCustom(customPresets().filter(function (preset) { return preset.id !== id; }));
    var enabledMap = Object.assign({}, preferences().presetEnabled || {});
    delete enabledMap[id];
    var order = (preferences().presetOrder || []).filter(function (presetId) { return presetId !== id; });
    window.RPStorage.savePreferences({ presetEnabled: enabledMap, presetOrder: order });
    window.RPEvents.emit('presets:changed', { id: id, removed: true });
    return true;
  }

  function restoreBuiltin(id) {
    var target = authored.find(function (preset) { return preset.id === id; });
    if (!target || target.locked) return false;
    var overrideMap = Object.assign({}, edits());
    delete overrideMap[id];
    var enabledMap = Object.assign({}, preferences().presetEnabled || {});
    delete enabledMap[id];
    window.RPStorage.savePreferences({ presetEdits: overrideMap, presetEnabled: enabledMap });
    window.RPEvents.emit('presets:changed', { id: id, restored: true });
    return true;
  }

  function importRpHub(payload) {
    var input = payload && Array.isArray(payload.presets) ? payload.presets : payload;
    var items = Array.isArray(input) ? input : [input];
    var imported = [];
    var errors = [];
    items.forEach(function (item, index) {
      if (!item || typeof item !== 'object') {
        errors.push('第 ' + (index + 1) + ' 项不是对象');
        return;
      }
      var name = String(item.name || '').trim();
      var content = String(item.content || '');
      if (!name || !content.trim()) {
        errors.push('第 ' + (index + 1) + ' 项缺少 name 或 content');
        return;
      }
      var role = normalizeRole(item.role || item.presetRole || item.type);
      imported.push(create({
        name: name,
        content: content,
        enabled: item.enabled !== false,
        role: role,
        phase: defaultPhase(role),
        source: {
          project: 'RP-Hub JSON 导入',
          license: 'user-provided',
          importedAt: new Date().toISOString()
        }
      }));
    });
    return { ok: imported.length > 0, imported: imported, errors: errors };
  }

  function toRpHub(preset) {
    return {
      name: preset.name,
      content: preset.content,
      enabled: preset.runtimeEnabled,
      role: preset.role
    };
  }

  function exportRpHub(ids) {
    var selected = Array.isArray(ids) && ids.length
      ? new Set(ids)
      : null;
    return list()
      .filter(function (preset) { return !selected || selected.has(preset.id); })
      .map(toRpHub);
  }

  function move(id, direction) {
    var ids = ordered().map(function (preset) { return preset.id; });
    var index = ids.indexOf(id);
    var nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return false;
    var swap = ids[nextIndex];
    ids[nextIndex] = ids[index];
    ids[index] = swap;
    window.RPStorage.savePreferences({ presetOrder: ids });
    window.RPEvents.emit('presets:changed', { id: id, order: nextIndex });
    return true;
  }

  function reset() {
    window.RPStorage.savePreferences({
      presetEnabled: {},
      presetOrder: [],
      presetCustom: [],
      presetEdits: {}
    });
    window.RPEvents.emit('presets:changed', { reset: true });
  }

  function compile() {
    var active = list().filter(function (preset) {
      return preset.runtimeEnabled && String(preset.content || '').trim();
    });
    return {
      systemRoot: active.filter(function (preset) { return preset.role === 'system' && preset.phase === 'system-root'; }),
      systemSupport: active.filter(function (preset) { return preset.role === 'system' && preset.phase !== 'system-root'; }),
      prelude: active.filter(function (preset) { return preset.role === 'user' || preset.role === 'assistant'; })
    };
  }

  window.RPPresets = {
    list: list,
    byId: byId,
    setEnabled: setEnabled,
    create: create,
    update: update,
    duplicate: duplicate,
    remove: remove,
    restoreBuiltin: restoreBuiltin,
    importRpHub: importRpHub,
    exportRpHub: exportRpHub,
    move: move,
    reset: reset,
    compile: compile
  };
})();
