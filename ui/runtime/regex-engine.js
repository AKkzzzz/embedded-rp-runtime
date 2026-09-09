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
      if (next.role === 'assistant') next.content = stripReasoning(next.content);
      next.content = applyText(next.content, 'prompt', next, index);
      return next;
    });
  }

  function reasoningSignal(text) {
    return /<\s*(?:cot|think|thinking|reasoning)\b/i.test(text) ||
      /(?:^|\n)\s*(?:\*{0,2})?\[?(?:模式与权威|现场账本|记忆整理|情景与意图解密|角色与世界设定分析|玩家行动与检定门|角色自主与信息边界|因果与路线预演|逻辑预演|模式专项检查|协议与界面自检|自我反驳|正文验收|文风整理|最终执行锁定)\]?(?:\*{0,2})?\s*$/im.test(text);
  }

  function stripLeadingReasoningSections(text) {
    var source = String(text || '');
    var firstHeading = /^\s*(?:\*{0,2})?\[?(?:模式与权威|现场账本|记忆整理|情景与意图解密|角色与世界设定分析|玩家行动与检定门|角色自主与信息边界|因果与路线预演|逻辑预演|模式专项检查|协议与界面自检|自我反驳|正文验收|文风整理)\]?(?:\*{0,2})?\s*$/im;
    var start = firstHeading.exec(source);
    if (!start || source.slice(0, start.index).trim()) return source;
    var headingPattern = /^(?:\s*)(?:\*{0,2})?\[?(模式与权威|现场账本|记忆整理|情景与意图解密|角色与世界设定分析|玩家行动与检定门|角色自主与信息边界|因果与路线预演|逻辑预演|模式专项检查|协议与界面自检|自我反驳|正文验收|文风整理|最终执行锁定)\]?(?:\*{0,2})?\s*$/gmi;
    var headings = [];
    var match;
    while ((match = headingPattern.exec(source))) headings.push({ name: match[1], index: match.index, end: headingPattern.lastIndex });
    if (headings.length < 3) return source;
    var lock = headings.slice().reverse().find(function (heading) { return heading.name === '最终执行锁定'; });
    if (!lock) return '';
    var tail = source.slice(lock.end);
    var boundary = tail.search(/\n\s*\n/);
    if (boundary < 0) return '';
    return tail.slice(boundary).replace(/^\s+/, '');
  }

  function stripReasoning(text) {
    var current = String(text == null ? '' : text);
    var sentinel = /\[COT_END\]/i.exec(current);
    if (sentinel && reasoningSignal(current.slice(0, sentinel.index))) {
      current = current.slice(sentinel.index + sentinel[0].length);
    }
    current = current
      .replace(/<\s*(cot|think|thinking|reasoning)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/^[\s\S]*?<\s*\/\s*(?:cot|think|thinking|reasoning)\s*>/i, '')
      .replace(/<\s*(?:cot|think|thinking|reasoning)\b[^>]*>[\s\S]*$/gi, '')
      .replace(/<\s*\/?\s*(?:cot|think|thinking|reasoning)\b[^>]*>/gi, '')
      .replace(/\[COT_END\]/gi, '');
    return stripLeadingReasoningSections(current);
  }

  function stripRuntimeBlocks(text) {
    return stripReasoning(text)
      .replace(/\[(ENCOUNTER_PENDING|ENCOUNTER_BRIEF|ENEMY_CARD|ATTACK_RESOLUTION|STATE_UPDATE|STATE_EVENT|PARTY_EVENT|CHECK_GATE|CHECK_TOOL_RESULT|CHECK_RESOLUTION_INPUT|ATTACK_INTENT|ITEM_INTENT|BATTLE_SETTLEMENT_REQUEST|BATTLE_ENEMY_CALIBRATION_REQUEST|BATTLE_FORCE_END_REQUEST|BATTLE_END)\](?:[\s\S]*?)\[\/\1\]/gi, '')
      .replace(/\[ENCOUNTER_PENDING(?:\|[^\]]*)?\][\s\S]*$/gi, '')
      .replace(/\[(?:BATTLE_START|BATTLE_END)(?:\|[^\]]*)?\]/gi, '');
  }

  function stripPromptTransport(text) {
    return stripRuntimeBlocks(text)
      .replace(/<\s*active_tool_results?(?:\s[^>]*)?>[\s\S]*?<\s*\/\s*active_tool_results?\s*>/gi, '')
      .replace(/<\s*\/?\s*active_tool_results?\b[^>]*>/gi, '')
      .replace(/^\s*<\s*\/?\s*tool_[^>]*>\s*$/gmi, '')
      .replace(/^\[(?:DICE_RESULT|CHECK_RESULT|CHECK_PENDING|CHECK_CONTEXT|CHECK_EVENT_COMMIT|CHECK_REQUEST|WILL_INTENT|IMAGE_PROMPT|IMAGE_PENDING|IMAGE_ERROR|IMAGE_RENDER|TURN_START|ROUND_START|DMG_OUT|HEAL_OUT|STATUS_APPLY|BREAK_GAIN|DETECTION_STATE|STORY_EVENT|WILL_SPEND|WILL_RESTORE|INJURY_WORSEN|FIRST_AID_STOP|TEMP_HP_SET|HEALTH_MAX_SET|SECOND_LIFE_CREATE|STAY_CONSCIOUS|NATURAL_RECOVERY)[^\]]*\].*$/gmi, '')
      .replace(/\[CHECK_GATE\][\s\S]*?\[\/CHECK_GATE\]/gi, '')
      .replace(/\[CHECK_CONTEXT(?:\|[^\]]*)?\][\s\S]*?\[\/CHECK_CONTEXT\]/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Embeddings need the story semantics rather than renderer protocols. The
  // recent narrative history still keeps its original format; only vector
  // input is projected to readable prose here.
  function cleanGalForEmbedding(text) {
    return stripPromptTransport(text)
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\[GAL_LINE\|([^\]]+)\]([\s\S]*?)\[\/GAL_LINE\]/gi, function (_all, fields, body) {
        var parts = String(fields || '').split('|');
        var speaker = String(parts[1] || parts[0] || '').trim();
        return '\n' + (speaker ? speaker + '：' : '') + String(body || '').trim() + '\n';
      })
      .replace(/\[GAL_NARRATION\]([\s\S]*?)\[\/GAL_NARRATION\]/gi, '\n$1\n')
      .replace(/\[PHONE_MSG\|([^\]]+)\]([\s\S]*?)\[\/PHONE_MSG\]/gi, function (_all, fields, body) {
        var parts = String(fields || '').split('|');
        var sender = String(parts[1] || parts[0] || '').trim();
        return '\n' + (sender ? sender + '：' : '') + String(body || '').trim() + '\n';
      })
      .replace(/\[CONTACT_REQUEST\|[^\]]+\]([\s\S]*?)\[\/CONTACT_REQUEST\]/gi, '\n$1\n')
      .replace(/\[GAL_EVENT\|[^\]]*\]/gi, '\n')
      .replace(/\[GAL_SCENE\|[^\]]*\]/gi, '\n')
      .replace(/\[\/?GAL_[A-Z_]+(?:\|[^\]]*)?\]/gi, '\n')
      .replace(/<\s*tool_[a-z0-9_]+\s*:[\s\S]*?>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  window.RPRegex = {
    list: function () { return JSON.parse(JSON.stringify(definitions)); },
    applyPrompt: function (messages) { return applyMessages(messages); },
    applyOutput: function (text, message, depth) { return applyText(text, 'output', message, depth || 0); },
    stripReasoning: stripReasoning,
    stripRuntimeBlocks: stripRuntimeBlocks,
    stripPromptTransport: stripPromptTransport,
    cleanGalForEmbedding: cleanGalForEmbedding,
    last: function () { return JSON.parse(JSON.stringify(last)); }
  };
})();
