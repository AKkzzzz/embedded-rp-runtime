(function () {
  'use strict';

  window.RPTemplateData = {
    app: {
      id: 'nanami-embedded-rp-runtime-template',
      name: '内嵌 RP 运行时模板',
      version: '0.1.0-debug',
      storagePrefix: 'nanami_embedded_rp_runtime_v1'
    },
    modelRoutes: {
      narrative: { label: '主叙事', inherit: 'current', model: '', temperature: 0.82 },
      state: { label: '状态整理', inherit: 'variable', model: '', temperature: 0.2 },
      summarize: { label: '记忆摘要', inherit: 'balanced', model: '', temperature: 0.3 },
      embedding: { label: '向量嵌入', inherit: 'embedding', model: '', dimensions: null }
    },
    presets: [],
    worldbookSettings: {
      scanDepth: 2,
      maxScanDepth: 0,
      charBudget: 0,
      maxDependencyDepth: 3
    },
    worldbook: [
      {
        id: 'runtime-contract',
        name: '卡内运行时契约',
        enabled: true,
        locked: true,
        constant: true,
        trigger: { type: 'constant' },
        order: 1000,
        placement: 'system_top',
        dependencies: [],
        tags: ['runtime', 'locked'],
        content: '卡内 canonical state 是当前应用的权威状态。世界书补丁必须通过校验后提交。'
      },
      {
        id: 'debug-console',
        name: 'Debug 控制台',
        enabled: true,
        locked: false,
        constant: false,
        trigger: {
          type: 'literal',
          keys: ['Debug 控制台', '后台小酒馆', '运行时诊断'],
          caseSensitive: false
        },
        order: 500,
        placement: 'before_character',
        dependencies: ['runtime-contract'],
        tags: ['debug'],
        content: 'Debug 控制台用于检查模型路由、世界书、变量、插件、记忆和提示词编译，不推进剧情。'
      },
      {
        id: 'example-regex-trigger',
        name: '正则触发示例',
        enabled: true,
        locked: false,
        constant: false,
        trigger: {
          type: 'regex',
          patterns: ['/世界书.{0,8}(递归|扫描)/i']
        },
        order: 400,
        placement: 'before_character',
        dependencies: ['runtime-contract'],
        tags: ['example', 'regex'],
        content: '递归检索必须受最大深度、去重、启用状态和总字符预算约束。'
      }
    ],
    initialState: {
      runtime: {
        revision: 1,
        mode: 'debug',
        renderer: 'none',
        started: false
      },
      player: {
        name: '待创建',
        profileComplete: false
      },
      scene: {
        title: '模板后台',
        location: 'Runtime Console',
        time: '未开始'
      },
      conversation: {
        revision: 1,
        messages: [],
        status: 'idle'
      },
      knowledge: {
        revision: 1,
        entries: [],
        pendingProposals: []
      },
      flags: {}
    },
    stateSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        runtime: {
          type: 'object',
          additionalProperties: false,
          properties: {
            revision: { type: 'integer', minimum: 1, readOnly: true },
            mode: { type: 'string', enum: ['debug', 'game'] },
            renderer: { type: 'string', enum: ['none', 'galgame', 'ebook', 'tactical'] },
            started: { type: 'boolean' }
          },
          required: ['revision', 'mode', 'renderer', 'started']
        },
        player: {
          type: 'object',
          additionalProperties: true,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 80 },
            profileComplete: { type: 'boolean' }
          },
          required: ['name', 'profileComplete']
        },
        scene: {
          type: 'object',
          additionalProperties: true,
          properties: {
            title: { type: 'string', maxLength: 120 },
            location: { type: 'string', maxLength: 180 },
            time: { type: 'string', maxLength: 80 }
          },
          required: ['title', 'location', 'time']
        },
        conversation: {
          type: 'object',
          additionalProperties: false,
          properties: {
            revision: { type: 'integer', minimum: 1, readOnly: true },
            status: { type: 'string', enum: ['idle', 'generating'] },
            messages: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', minLength: 3, maxLength: 120 },
                  role: { type: 'string', enum: ['user', 'assistant'] },
                  content: { type: 'string', maxLength: 200000 },
                  reasoning: { type: 'string', maxLength: 200000 },
                  createdAt: { type: 'string', minLength: 1, maxLength: 80 },
                  status: { type: 'string', enum: ['complete', 'interrupted', 'error'] }
                },
                required: ['id', 'role', 'content', 'createdAt', 'status']
              }
            }
          },
          required: ['revision', 'messages', 'status']
        },
        knowledge: {
          type: 'object',
          additionalProperties: false,
          properties: {
            revision: { type: 'integer', minimum: 1, readOnly: true },
            entries: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  id: { type: 'string', minLength: 3, maxLength: 120 },
                  name: { type: 'string', minLength: 1, maxLength: 160 },
                  content: { type: 'string', minLength: 1, maxLength: 30000 },
                  enabled: { type: 'boolean' },
                  locked: { type: 'boolean' },
                  source: { type: 'string', enum: ['user', 'memory-derived', 'imported'] }
                },
                required: ['id', 'name', 'content', 'enabled', 'locked', 'source']
              }
            },
            pendingProposals: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  id: { type: 'string', minLength: 3, maxLength: 120 },
                  status: { type: 'string', enum: ['pending', 'accepted', 'rejected'] },
                  baseRevision: { type: 'integer', minimum: 1 },
                  reason: { type: 'string', maxLength: 1000 }
                },
                required: ['id', 'status', 'baseRevision', 'reason']
              }
            }
          },
          required: ['revision', 'entries', 'pendingProposals']
        },
        flags: { type: 'object', additionalProperties: true }
      },
      required: ['runtime', 'player', 'scene', 'conversation', 'knowledge', 'flags']
    },
    plugins: [
      {
        id: 'runtime.worldbook.recursion',
        name: 'Worldbook Recursion',
        version: '1.0.0',
        priority: 40,
        enabled: true,
        requires: [],
        optional: [],
        capabilities: ['worldbook:read', 'retrieval:extend']
      },
      {
        id: 'runtime.patch.guard',
        name: 'Model Patch Guard',
        version: '1.0.0',
        priority: 60,
        enabled: true,
        requires: [],
        optional: [],
        capabilities: ['worldbook:patch:validate']
      }
    ],
    memory: {
      structured: [
        {
          id: 'memory-template-created',
          kind: 'fact',
          title: '模板处于 Debug 阶段',
          summary: '运行时先展示后台控制台，开始游戏后才切换 renderer。',
          sourceIds: ['bootstrap'],
          createdAt: '2026-07-23T00:00:00+08:00',
          stale: false
        }
      ],
      vectors: []
    }
  };
})();
