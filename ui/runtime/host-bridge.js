(function () {
  'use strict';

  var SETTINGS_DB = 'RPHubDB';
  var SETTINGS_KEY = 'rp_hub_settings';
  var MEMORY_SETTINGS_KEY = 'rp_hub_memory_settings';
  var cachedSettings = null;
  var cachedMemorySettings = null;
  var lastError = '';
  var detected = false;
  var IMAGE_GEN_BASE_URL = 'https://nai.sta1n.cn';

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function firstDefined(source, keys) {
    source = source && typeof source === 'object' ? source : {};
    for (var index = 0; index < keys.length; index += 1) {
      if (source[keys[index]] !== undefined && source[keys[index]] !== null && source[keys[index]] !== '') {
        return source[keys[index]];
      }
    }
    return undefined;
  }

  function optionalNumber(source, keys) {
    var value = firstDefined(source, keys);
    if (value === undefined) return null;
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function safeProviderValue(value, depth) {
    if (depth > 6 || value === undefined || typeof value === 'function') return undefined;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (Array.isArray(value)) {
      return value.map(function (item) { return safeProviderValue(item, depth + 1); }).filter(function (item) {
        return item !== undefined;
      });
    }
    if (!value || typeof value !== 'object') return undefined;
    var output = {};
    Object.keys(value).forEach(function (key) {
      if (/api.?key|token|secret|authorization|password|credential/i.test(key)) return;
      if (/^(?:model|messages|temperature|stream|stream_options)$/i.test(key)) return;
      var next = safeProviderValue(value[key], depth + 1);
      if (next !== undefined) output[key] = next;
    });
    return output;
  }

  function generationParameters(value) {
    var nested = firstDefined(value, ['generationParameters', 'generation_parameters']);
    nested = nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : {};
    var sources = [value, nested];
    function from(keys, parser) {
      for (var index = 0; index < sources.length; index += 1) {
        var result = parser ? parser(sources[index], keys) : firstDefined(sources[index], keys);
        if (result !== undefined && result !== null) return result;
      }
      return null;
    }
    var stop = from(['stop', 'stopSequences', 'stop_sequences']);
    if (stop != null && !Array.isArray(stop) && typeof stop !== 'string') stop = null;
    if (Array.isArray(stop)) stop = stop.map(String).filter(Boolean).slice(0, 16);
    var provider = {};
    [
      nested.providerParameters, nested.provider_parameters,
      value.providerParameters, value.provider_parameters,
      value.customParameters, value.custom_parameters,
      value.extraBody, value.extra_body
    ].forEach(function (candidate) {
      var safe = safeProviderValue(candidate, 0);
      if (safe && typeof safe === 'object' && !Array.isArray(safe)) Object.assign(provider, safe);
    });
    return {
      topP: from(['topP', 'top_p'], optionalNumber),
      maxTokens: from(['maxTokens', 'max_tokens'], optionalNumber),
      maxCompletionTokens: from(['maxCompletionTokens', 'max_completion_tokens'], optionalNumber),
      frequencyPenalty: from(['frequencyPenalty', 'frequency_penalty'], optionalNumber),
      presencePenalty: from(['presencePenalty', 'presence_penalty'], optionalNumber),
      stop: clone(stop),
      reasoningEffort: from(['reasoningEffort', 'reasoning_effort']) || null,
      providerParameters: provider
    };
  }

  function readIndexedDbKey(databaseName, key) {
    return new Promise(function (resolve) {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      var settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        resolve(value == null ? null : value);
      }
      function openExisting() {
        try {
        var request = indexedDB.open(databaseName);
        request.onerror = function () { finish(null); };
        request.onblocked = function () { finish(null); };
        request.onsuccess = function () {
          var database = request.result;
          var names = Array.from(database.objectStoreNames || []);
          if (!names.length) {
            database.close();
            finish(null);
            return;
          }
          var stores = names.includes('store') ? ['store'] : names;
          function next(index) {
            if (index >= stores.length) {
              database.close();
              finish(null);
              return;
            }
            try {
              var transaction = database.transaction(stores[index], 'readonly');
              var get = transaction.objectStore(stores[index]).get(key);
              get.onsuccess = function () {
                if (get.result != null) {
                  database.close();
                  finish(get.result);
                } else {
                  next(index + 1);
                }
              };
              get.onerror = function () { next(index + 1); };
            } catch (_error) {
              next(index + 1);
            }
          }
          next(0);
        };
        } catch (_error) {
          finish(null);
        }
      }
      if (typeof indexedDB.databases === 'function') {
        indexedDB.databases().then(function (databases) {
          var exists = (databases || []).some(function (database) { return database && database.name === databaseName; });
          if (exists) openExisting();
          else finish(null);
        }).catch(openExisting);
      } else {
        openExisting();
      }
    });
  }

  function readLocalSettings() {
    var scopes = [window];
    try {
      if (window.parent && window.parent !== window) scopes.push(window.parent);
    } catch (_error) {}
    for (var index = 0; index < scopes.length; index += 1) {
      try {
        var raw = scopes[index].localStorage.getItem(SETTINGS_KEY);
        if (raw) return JSON.parse(raw);
      } catch (_error) {}
    }
    return null;
  }

  function normalizeSettings(value, memoryValue) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var apiUrl = String(value.apiUrl || '').trim().replace(/\/+$/, '');
    var apiKey = String(value.apiKey || '').trim();
    if (!apiUrl || !apiKey) return null;
    return Object.assign({}, clone(value), {
      apiUrl: apiUrl,
      apiKey: apiKey,
      model: String(value.model || '').trim(),
      qualityModel: String(value.qualityModel || '').trim(),
      balancedModel: String(value.balancedModel || '').trim(),
      fastModel: String(value.fastModel || '').trim(),
      uiTemplateModel: String(value.uiTemplateModel || '').trim(),
      embeddingModel: String(memoryValue && memoryValue.embeddingModel || value.embeddingModel || '').trim(),
      summaryModel: String(memoryValue && memoryValue.classicModel || value.summaryModel || value.summarizeModel || '').trim(),
      imageGenKey: String(value.imageGenKey || '').trim(),
      imageStyle: String(value.imageStyle || 'vertical'),
      imageSize: String(value.imageSize || '竖图'),
      imageGenCount: Math.max(1, Math.min(6, Number(value.imageGenCount) || 2)),
      temperature: Number.isFinite(Number(value.temperature)) ? Number(value.temperature) : 1,
      stream: value.stream !== false,
      generationParameters: generationParameters(value)
    });
  }

  function publicSettings() {
    if (!cachedSettings) return null;
    return {
      apiUrl: cachedSettings.apiUrl,
      providerId: String(cachedSettings.apiProviderId || ''),
      model: cachedSettings.model,
      qualityModel: cachedSettings.qualityModel,
      balancedModel: cachedSettings.balancedModel,
      fastModel: cachedSettings.fastModel,
      uiTemplateModel: cachedSettings.uiTemplateModel,
      embeddingModel: cachedSettings.embeddingModel,
      summaryModel: cachedSettings.summaryModel,
      temperature: cachedSettings.temperature,
      stream: cachedSettings.stream,
      generationParameters: clone(cachedSettings.generationParameters),
      hasApiKey: Boolean(cachedSettings.apiKey)
      ,memoryMode: String(cachedMemorySettings && cachedMemorySettings.mode || '')
      ,imageStyle: cachedSettings.imageStyle,
      imageSize: cachedSettings.imageSize,
      imageGenCount: cachedSettings.imageGenCount,
      hasImageGenKey: Boolean(cachedSettings.imageGenKey)
    };
  }

  function capabilities() {
    var configured = Boolean(cachedSettings);
    return {
      host: window.parent !== window ? 'rp-hub-same-origin' : 'standalone-preview',
      enhancedBridge: false,
      sameOriginSettings: configured,
      intentSubmit: typeof window.triggerSlash === 'function',
      modelsList: configured && typeof fetch === 'function',
      generation: configured && typeof fetch === 'function',
      embeddings: configured && typeof fetch === 'function',
      imageGeneration: configured && Boolean(cachedSettings.imageGenKey),
      recordsRead: typeof window.rpHubGetCardRecords === 'function',
      settingsDetected: detected,
      lastError: lastError
    };
  }

  async function detect() {
    lastError = '';
    var value = null;
    try {
      var stored = await Promise.all([
        readIndexedDbKey(SETTINGS_DB, SETTINGS_KEY),
        readIndexedDbKey(SETTINGS_DB, MEMORY_SETTINGS_KEY)
      ]);
      value = stored[0];
      cachedMemorySettings = stored[1] && typeof stored[1] === 'object' ? clone(stored[1]) : null;
      if (!value) value = readLocalSettings();
      cachedSettings = normalizeSettings(value, cachedMemorySettings);
      if (!cachedSettings) lastError = 'RP-Hub API 设置不存在或不完整';
    } catch (error) {
      cachedSettings = null;
      lastError = String(error && error.message || error);
    }
    detected = true;
    await window.RPEvents.emit('host:capabilities', capabilities());
    return capabilities();
  }

  function endpoint(path) {
    if (!cachedSettings) throw new Error('RP-Hub API 设置尚未载入');
    var base = cachedSettings.apiUrl.replace(/\/+$/, '');
    var suffix = String(path || '').replace(/^\/+/, '');
    if (/\/v1$/i.test(base)) return base + '/' + suffix.replace(/^v1\//i, '');
    return base + '/v1/' + suffix.replace(/^v1\//i, '');
  }

  async function apiFetch(path, options) {
    if (!cachedSettings) throw new Error('没有读取到 RP-Hub API 设置');
    var request = Object.assign({}, options || {});
    request.headers = Object.assign({}, request.headers || {}, {
      Authorization: 'Bearer ' + cachedSettings.apiKey
    });
    return fetch(endpoint(path), request);
  }

  function resolveModel(inherit, explicit) {
    if (explicit) return String(explicit);
    if (!cachedSettings) return '';
    var aliases = {
      current: cachedSettings.model,
      quality: cachedSettings.qualityModel || cachedSettings.model,
      balanced: cachedSettings.balancedModel || cachedSettings.model,
      fast: cachedSettings.fastModel || cachedSettings.model,
      variable: cachedSettings.uiTemplateModel || cachedSettings.balancedModel || cachedSettings.model
      ,embedding: cachedSettings.embeddingModel
      ,summarize: cachedSettings.summaryModel
    };
    return aliases[inherit] || cachedSettings.model || '';
  }

  function inheritedGenerationParameters() {
    return clone(cachedSettings && cachedSettings.generationParameters || {
      topP: null,
      maxTokens: null,
      maxCompletionTokens: null,
      frequencyPenalty: null,
      presencePenalty: null,
      stop: null,
      reasoningEffort: null,
      providerParameters: {}
    });
  }

  function submitIntent(text) {
    var command = String(text || '').trim();
    if (!command) return false;
    if (typeof window.triggerSlash === 'function') {
      window.triggerSlash(command);
      return true;
    }
    if (window.parent === window) {
      window.RPEvents.emit('preview:intent', { text: command });
      return true;
    }
    return false;
  }

  function imageSettings() {
    if (!cachedSettings) return null;
    return {
      style: cachedSettings.imageStyle,
      size: cachedSettings.imageSize,
      count: cachedSettings.imageGenCount,
      configured: Boolean(cachedSettings.imageGenKey),
      baseUrl: IMAGE_GEN_BASE_URL
    };
  }

  function generateImage(prompt, options) {
    if (!cachedSettings || !cachedSettings.imageGenKey) {
      return Promise.reject(new Error('RP-Hub 生图密钥未配置'));
    }
    options = options || {};
    var params = new URLSearchParams({
      tag: String(prompt || '').trim(),
      token: cachedSettings.imageGenKey,
      model: String(options.model || 'nai-diffusion-4-5-full'),
      artist: String(options.artist || ''),
      size: String(options.size || cachedSettings.imageSize || '竖图'),
      steps: String(options.steps || 40),
      scale: String(options.scale || 6),
      cfg: String(options.cfg || 0),
      sampler: String(options.sampler || 'k_dpmpp_2m_sde'),
      negative: String(options.negative || 'bad anatomy,bad hands,bad proportions,blurry,low quality,missing fingers,text,watermark'),
      nocache: '0',
      noise_schedule: 'karras'
    });
    return Promise.resolve({
      url: IMAGE_GEN_BASE_URL + '/generate?' + params.toString(),
      prompt: String(prompt || ''),
      size: params.get('size'),
      model: params.get('model')
    });
  }

  window.RPHost = {
    detect: detect,
    refresh: detect,
    capabilities: capabilities,
    settings: publicSettings,
    endpoint: endpoint,
    apiFetch: apiFetch,
    resolveModel: resolveModel,
    generationParameters: inheritedGenerationParameters,
    submitIntent: submitIntent,
    imageSettings: imageSettings,
    generateImage: generateImage
  };
})();
