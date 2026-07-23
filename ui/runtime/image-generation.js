(function () {
  'use strict';
  var recent = [];
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  window.RPImageGen = {
    settings: function () { return window.RPHost.imageSettings(); },
    recent: function () { return clone(recent); },
    generate: async function (prompt, options) {
      if (!window.RPPlugins.isEnabled('runtime.image-generation')) {
        throw new Error('生图插件未启用');
      }
      var result = await window.RPHost.generateImage(prompt, options || {});
      recent.unshift(Object.assign({ createdAt: new Date().toISOString() }, result));
      recent = recent.slice(0, 12);
      await window.RPEvents.emit('image:generated', clone(result));
      return result;
    }
  };
  window.RPPlugins.attach('runtime.image-generation', {
    generate: function (context) { return window.RPImageGen.generate(context.prompt, context.options); }
  });
})();
