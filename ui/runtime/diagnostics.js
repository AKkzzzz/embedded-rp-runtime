(function () {
  'use strict';

  function snapshot() {
    var schemaValidation = window.RPStateGuard.validate(
      window.RPStorage.getCanonical(),
      window.RPTemplateData.stateSchema
    );
    return {
      app: Object.assign({}, window.RPTemplateData.app),
      host: window.RPHost.capabilities(),
      schema: schemaValidation,
      worldbook: {
        total: window.RPWorldbook.list().length,
        enabled: window.RPWorldbook.list().filter(function (entry) { return entry.runtimeEnabled; }).length,
        last: window.RPWorldbook.last()
      },
      models: {
        routes: window.RPModels.routes(),
        available: window.RPModels.models(),
        calls: window.RPModels.diagnostics()
      },
      conversation: window.RPConversation.diagnostics(),
      generation: window.RPGenerationMonitor ? {
        current: window.RPGenerationMonitor.snapshot(),
        recent: window.RPGenerationMonitor.recent()
      } : null,
      presets: window.RPPresets.list(),
      plugins: window.RPPlugins.list(),
      memory: window.RPMemory.stats(),
      vectors: window.RPVectorMemory.stats(),
      events: window.RPEvents.inspect(),
      prompt: window.RPPrompt.last()
    };
  }

  window.RPDiagnostics = { snapshot: snapshot };
})();
