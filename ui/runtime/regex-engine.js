(function () {
  'use strict';

  var definitions = (window.RPTemplateData && window.RPTemplateData.regexScripts) || [];
  var last = { prompt: [], output: [] };

  function flags(value) {
    return String(value || '').replace(/[^dgimsuvy]/g, '');
  }

  function compile(pattern, flagValue) {
    var source = String(pattern || '');
    var match = source.match(/^\/([\s\S]*)\/([a-z]*)$/i);
    if (match) {
      source = match[1];
      flagValue = match[2] || flagValue;
    }
    try { return new RegExp(source, flags(flagValue)); } catch (_error) { return null; }
  }

  function applies(script, channel, message, depth) {
    if (!script || script.enabled === false || script.disabled === true) return false;
    if (script.promptOnly === true && channel !== 'prompt') return false;
    if (script.markdownOnly === true && channel !== 'output') return false;
    var placement = script.placement;
    if (Array.isArray(placement) && placement.length && !placement.includes(channel === 'prompt' ? 1 : 2)) return false;
    if (script.scope && script.scope !== 'character' && script.scope !== 'global') return false;
    if (script.minDepth != null && depth < Number(script.minDepth)) return false;
    if (script.maxDepth != null && depth > Number(script.maxDepth)) return false;
    return !message || message.role === 'user' || message.role === 'assistant';
  }

  function applyText(text, channel, message, depth) {
    var current = String(text == null ? '' : text);
    var applied = [];
    definitions.slice().forEach(function (script) {
      if (!applies(script, channel, message, depth)) return;
      var regex = compile(script.regex || script.findRegex, script.flags || script.regexFlags);
      if (!regex) return;
      var before = current;
      current = current.replace(regex, script.replacement != null ? String(script.replacement) : String(script.replaceString || ''));
      if (before !== current) applied.push(script.id || script.name || 'regex');
    });
    last[channel] = applied;
    return current;
  }

  function applyMessages(messages) {
    return (messages || []).map(function (message, index) {
      var next = Object.assign({}, message);
      next.content = applyText(next.content, 'prompt', next, index);
      return next;
    });
  }

  window.RPRegex = {
    list: function () { return JSON.parse(JSON.stringify(definitions)); },
    applyPrompt: function (messages) { return applyMessages(messages); },
    applyOutput: function (text, message, depth) { return applyText(text, 'output', message, depth || 0); },
    last: function () { return JSON.parse(JSON.stringify(last)); }
  };
})();
