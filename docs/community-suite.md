# 社区能力套件

本模板不直接安装 SillyTavern 社区扩展，而是把适合角色卡的能力重写成构建期打包、默认关闭、可审计的卡内插件。

| 插件 | 卡内接口 | 当前能力 |
|---|---|---|
| Prompt Inspector | `RPPromptInspector` | 查看本轮消息来源、世界书、记忆、字符量和 Regex 诊断 |
| Guided Generations | `RPGuided.suggest(count)` | 使用状态 route 生成差异化行动建议，失败时提供本地降级建议 |
| CharMemory | `RPCharMemory` | 新增、查看和提取结构化角色记忆 |
| Notebook | `RPNotebook` | 本地便签；只有标记 `inject` 的便签进入 Prompt |
| Quick Persona | `RPPersonas` | 保存和切换卡内玩家 Persona |
| Visual Novel Focus | `runtime.visual-novel` | 为单舞台添加视觉小说表现类，不另建聊天楼层 |
| Lightweight Diagrams | `RPDiagrams.render` | 按需生成轻量 SVG 关系/流程图，不默认加载 Mermaid |
| Parameter Randomizer | `RPParameterRandomizer` | 在限定范围内随机化 narrative temperature |
| Lore Copilot | `RPLoreCopilot.draft` | 根据最近历史生成世界书补丁草稿，不自动提交 |
| Lore Recommender | `RPLoreRecommender.inspect` | 查看命中诊断、重复键和过宽触发词 |
| Worldbook Tool | `<tool_worldbook:查询>` | 显式搜索世界书目录，可读取尚未自动触发的匹配条目 |
| Dynamic Audio / Live2D | `RPMedia` | 本地音频、视觉事件、Live2D 能力探测 |
| RP-Hub Image Generation | `RPImageGen` | 继承同源 `imageGenKey`，在独立 Debug 生图区按需生成图片 |

## 浮层

启用 `runtime.variable-overlay` 后，右下角出现卡内浮球。浮层按需展示当前状态、Prompt Inspector、Notebook、Timeline 和 Persona。

浮层位于 iframe 内，不向 RP-Hub 父页面注入 DOM，也不占主舞台正常布局空间。

## 安全规则

- 所有社区插件默认关闭；
- 插件只能使用 manifest 声明过的能力；
- 禁止远程 JavaScript 和任意代码执行；
- 世界书 Copilot 只能产生提案；
- 音频只允许卡内、本地、data 或 blob 资源；
- WebLLM、Live2D 和图表引擎按卡提供，不进入默认首屏；
- 插件禁用时清理事件监听器、CSS 状态和媒体。

## 卡作者接入

卡作者在 `ui/data/template-data.js` 或自己的派生数据包中设置默认启用状态。用户也可以在 Debug → 插件页面逐项启停。

```js
await RPPlugins.setEnabled('runtime.variable-overlay', true);
await RPPlugins.setEnabled('runtime.notebook', true);
RPNotebook.add('当前目标', '找到失踪的校准记录。', true);
```

模型主动世界书查询需要同时启用工具：

```js
RPTools.setEnabled('tool_worldbook', true);
```

自动检索和主动查询是两个入口。自动检索只注入常驻、关键词/正则/状态触发及其依赖；主动查询会按名称、触发词、标签和正文搜索完整的已启用目录，所以能找到当前对话尚未触发的条目。主动查询不会读取禁用条目，不会绕过作用域或状态条件；每次最多返回 6 条，并明确报告已返回数量与总命中数。

表现层应调用稳定的 `RP*` 接口，不直接读取插件的 localStorage 键。

## 生图

生图是单独的 `runtime.image-generation` 插件和 Debug → 生图分区，不会自动把图片注入每一轮正文。启用插件后，作者或 renderer 可以调用：

```js
const image = await RPImageGen.generate('anime library, warm afternoon light, two students');
```

生成 URL 只在运行时内存和图片元素中使用，不写入 canonical state。正式卡作者可根据电子书或 Galgame 需求，把返回图片保存到自己的展示层或本地资源缓存。
