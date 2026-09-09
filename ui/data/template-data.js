(function () {
  'use strict';

  window.RPTemplateData = {
    app: {
      debugBallAsset: '',
      id: 'nanami-embedded-rp-runtime-template',
      name: '内嵌 RP 运行时模板',
      version: '0.2.0-debug',
      storagePrefix: 'nanami_embedded_rp_runtime_v1'
    },
    modelRoutes: {
      narrative: { label: '主叙事', inherit: 'current', model: '', temperature: 0.82 },
      state: { label: '状态整理', inherit: 'variable', model: '', temperature: 0.2 },
      embedding: { label: '向量嵌入', inherit: 'embedding', model: '', dimensions: null },
      summary: { label: '历史总结', inherit: 'summarize', model: '', temperature: 0.2 }
    },
    regexScripts: [
      {
        id: 'runtime.style-priority',
        name: 'Style Priority',
        enabled: true,
        scope: 'character',
        promptOnly: true,
        placement: [1],
        regex: '^$',
        replacement: '',
        description: '系统风格优先级由预设决定，开场白和历史只提供事实，不复制其文风。'
      }
    ],
    tools: [
      {
        id: 'tool_memory',
        name: '向量记忆',
        type: 'vector_memory',
        callName: 'tool_memory',
        enabled: false,
        resultCount: 5
      },
      {
        id: 'tool_grep',
        name: '关键词检索',
        type: 'keyword_dialogue',
        callName: 'tool_grep',
        enabled: false,
        resultCount: 5
      },
      {
        id: 'tool_web',
        name: '联网搜索',
        type: 'web_search',
        callName: 'tool_web',
        enabled: false,
        resultCount: 5
      },
      {
        id: 'tool_dice',
        name: '随机骰子',
        type: 'dice',
        callName: 'tool_dice',
        enabled: false,
        resultCount: 1
      },
      {
        id: 'tool_worldbook',
        name: '主动世界书查询',
        type: 'worldbook',
        callName: 'tool_worldbook',
        enabled: false,
        resultCount: 6
      }
    ],
    presets: [],
    worldbookSettings: {
      scanDepth: 2,
      maxScanDepth: 0,
      maxDependencyDepth: 3
    },
    narrativePolicy: [
      '[Narrative Agency And Ensemble Policy]',
      '把玩家角色视为场景中的一名行动者，不因其玩家身份默认正确、全知、值得崇拜或拥有指挥权。NPC只能依据亲眼所见、可靠报告、既有关系和公开身份评价玩家；角色卡数值、隐藏能力、内心计划与未展示的经历不能成为NPC的已知事实。超常表现应先改变具体现场，再按人物立场产生有限的惊讶、警惕、尊重、嫉妒或质疑，不自动使所有人赞美、服从、交权或围绕玩家行动。',
      'NPC同样受其人物卡、知识、职责、资源、伤势和关系边界约束，不为压过玩家临时升级，也不为抬高玩家突然失去能力。人物可以独立判断、行动、犯错、争执、拒绝、撤退和承担后果。存在领队、主持人、主管或专业负责人时，普通路线、队形、警戒、工作分配与低风险事务由职责所有者形成判断并推进；玩家可插话、反对、服从或另行行动，但NPC不能把每项常规决定退回给玩家。',
      '多人场景使用移动焦点，每次由一至两名最相关人物承担行动，其余人物只在反应会改变现场时进入镜头。回复先完成当前因果链，再选择自然落点：已经发生的行动结果、另一人物的决定或反应、环境或威胁的新变化、一个尚未解释的可观察画面，或确实离不开玩家决定的关键分支。前四类落点不需要问句；关键分支也可以开放地停在现场。只有决定直接属于玩家、会改变显著风险/资源/关系/路线或产生不可逆后果时，NPC才提出必要问题。不要连续两轮用“你觉得呢”“你决定”“接下来怎么办”“要不要继续”收尾，也不要用询问代替NPC应承担的判断。'
    ].join('\n\n'),
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
        id: 'runtime-image-generation-contract',
        name: '剧情生图协议',
        enabled: true,
        locked: true,
        constant: true,
        trigger: { type: 'constant' },
        order: 1100,
        placement: 'assistant_top',
        dependencies: ['runtime-contract'],
        tags: ['runtime', 'image', 'protocol'],
        content: [
          '剧情生图由卡内运行时负责执行，模型只负责在正文后提交图片协议，不直接调用图片 API，也不输出 URL。',
          '只有出现具有明确视觉价值的地点、线索、异常现象、敌人首次显形、关键现场或重要状态变化时才请求图片；普通对白、重复回合和无新画面的回复不要生图。',
          '每次回复最多提交一张图。协议必须使用一行：[IMAGE_PROMPT|稳定场景ID|英文逗号标签]。稳定场景 ID 要能在后续同一地点复用；提示词只写主体、地点、关键物件、光线天气、构图和画面风格等可视名词，不粘贴正文、对白、玩家姓名、规则分析或 UI。',
          '图片协议放在完整正文之后。若生图插件未启用、宿主未配置或请求失败，正文仍必须完整成立，不要编造图片已生成。'
        ].join('\n')
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
        content: '递归检索必须受最大深度、去重、启用状态和循环保护约束；所有已经命中的条目按稳定源顺序完整注入。'
      },
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
        totalMessages: 0,
        archivedMessages: 0,
        status: 'idle'
      },
      knowledge: {
        revision: 1,
        entries: [],
        pendingProposals: []
      },
      flags: {}
      ,
      rpg: {
        revision: 1,
        player: {},
        presentCharacters: [],
        quests: [],
        inventory: [],
        stats: {},
        scene: {}
      },
      uiTemplates: []
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
            totalMessages: { type: 'integer', minimum: 0, readOnly: true },
            archivedMessages: { type: 'integer', minimum: 0, readOnly: true },
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
        flags: { type: 'object', additionalProperties: true },
        rpg: {
          type: 'object', additionalProperties: false,
          properties: {
            revision: { type: 'integer', minimum: 1, readOnly: true },
            player: { type: 'object', additionalProperties: true },
            presentCharacters: { type: 'array', items: { type: 'object', additionalProperties: true } },
            quests: { type: 'array', items: { type: 'object', additionalProperties: true } },
            inventory: { type: 'array', items: { type: 'object', additionalProperties: true } },
            stats: { type: 'object', additionalProperties: true },
            scene: { type: 'object', additionalProperties: true },
          },
          required: ['revision', 'player', 'presentCharacters', 'quests', 'inventory', 'stats', 'scene']
        },
        uiTemplates: {
          type: 'array',
          items: { type: 'object', additionalProperties: true }
        }
      },
      required: ['runtime', 'player', 'scene', 'conversation', 'knowledge', 'flags', 'rpg', 'uiTemplates']
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
      },
      {
        id: 'runtime.rpg-companion',
        name: 'RPG Companion 状态层',
        version: '0.1.0',
        priority: 90,
        enabled: false,
        capabilities: ['state:read', 'state:patch:propose', 'prompt:modify', 'ui:overlay', 'storage:local']
      },
      {
        id: 'runtime.command-registry',
        name: 'Tavern Helper 安全命令',
        version: '0.1.0',
        priority: 100,
        enabled: false,
        capabilities: ['commands:register', 'events:listen', 'state:read', 'ui:overlay']
      },
      {
        id: 'runtime.variable-overlay',
        name: 'Variable Viewer 浮层',
        version: '0.1.0',
        priority: 110,
        enabled: true,
        capabilities: ['ui:overlay', 'state:read', 'events:listen']
      },
      {
        id: 'runtime.dynamic-lore',
        name: 'Dynamic Lore 动态世界书',
        version: '0.1.0',
        priority: 120,
        enabled: false,
        capabilities: ['worldbook:read', 'retrieval:extend', 'prompt:modify']
      },
      {
        id: 'runtime.webllm',
        name: 'WebLLM 本地模型适配',
        version: '0.1.0',
        priority: 130,
        enabled: false,
        capabilities: ['webllm:local', 'storage:local']
      },
      {
        id: 'runtime.media-stage',
        name: 'Media Stage 音频与视觉',
        version: '0.1.0',
        priority: 140,
        enabled: false,
        capabilities: ['audio:play', 'visual:effect', 'assets:read', 'ui:overlay']
      },
      {
        id: 'runtime.image-generation',
        name: 'RP-Hub 生图',
        version: '0.1.0',
        priority: 145,
        enabled: false,
        capabilities: ['image:generate', 'assets:read', 'ui:overlay']
      },
      {
        id: 'runtime.prompt-inspector', name: 'Prompt Inspector', version: '0.1.0', priority: 150, enabled: false,
        capabilities: ['prompt:inspect', 'conversation:read', 'worldbook:read', 'memory:read', 'state:read', 'ui:overlay']
      },
      {
        id: 'runtime.guided-generations', name: 'Guided Generations', version: '0.1.0', priority: 160, enabled: false,
        capabilities: ['suggestions:generate', 'prompt:modify', 'state:read', 'ui:overlay']
      },
      {
        id: 'runtime.character-memory', name: 'CharMemory', version: '0.1.0', priority: 170, enabled: false,
        capabilities: ['memory:read', 'memory:write', 'memory:curate', 'conversation:read', 'ui:overlay']
      },
      {
        id: 'runtime.notebook', name: 'Notebook', version: '0.1.0', priority: 180, enabled: false,
        capabilities: ['notes:write', 'prompt:modify', 'storage:local', 'ui:overlay']
      },
      {
        id: 'runtime.persona-switcher', name: 'Quick Persona', version: '0.1.0', priority: 190, enabled: false,
        capabilities: ['persona:switch', 'state:patch:propose', 'storage:local', 'ui:overlay']
      },
      {
        id: 'runtime.visual-novel', name: 'Visual Novel Focus', version: '0.1.0', priority: 200, enabled: false,
        capabilities: ['visual:effect', 'ui:overlay', 'assets:read']
      },
      {
        id: 'runtime.diagram', name: 'Lightweight Diagrams', version: '0.1.0', priority: 210, enabled: false,
        capabilities: ['diagrams:render', 'ui:overlay']
      },
      {
        id: 'runtime.parameter-randomizer', name: 'Parameter Randomizer', version: '0.1.0', priority: 220, enabled: false,
        capabilities: ['parameters:modify', 'storage:local']
      },
      {
        id: 'runtime.lore-copilot', name: 'Lore Copilot', version: '0.1.0', priority: 230, enabled: false,
        capabilities: ['worldbook:read', 'worldbook:patch:propose', 'conversation:read', 'prompt:inspect', 'ui:overlay']
      },
      {
        id: 'runtime.lore-recommender', name: 'Lore Recommender', version: '0.1.0', priority: 240, enabled: false,
        capabilities: ['worldbook:read', 'lore:diagnose', 'prompt:inspect', 'ui:overlay']
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
