(function () {
  'use strict';

  var authored = window.RPTemplateData.presets;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function preferences() {
    return window.RPStorage.getPreferences();
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
    return authored.slice().sort(function (a, b) {
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
    var target = authored.find(function (preset) { return preset.id === id; });
    if (!target || target.locked) return false;
    var overrides = Object.assign({}, preferences().presetEnabled || {});
    if (value && target.exclusiveGroup) {
      authored.forEach(function (preset) {
        if (preset.id !== id && preset.exclusiveGroup === target.exclusiveGroup) overrides[preset.id] = false;
      });
    }
    overrides[id] = Boolean(value);
    window.RPStorage.savePreferences({ presetEnabled: overrides });
    window.RPEvents.emit('presets:changed', { id: id, enabled: Boolean(value) });
    return true;
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
    window.RPStorage.savePreferences({ presetEnabled: {}, presetOrder: [] });
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
    move: move,
    reset: reset,
    compile: compile
  };
})();
