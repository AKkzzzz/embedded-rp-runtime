# 内嵌 RP 运行时模板

这是一个由 `AKkzzzz` 维护、面向 RP-Hub 角色卡的“单正则 + 常驻 iframe”源码模板。它把模型调用、完整聊天楼层、世界书、状态、总结/向量记忆、插件生命周期和单舞台呈现放进卡内，适合继续派生 Galgame、聊天模拟器、电子书、战棋或其他长线卡。

仓库地址：[AKkzzzz/embedded-rp-runtime](https://github.com/AKkzzzz/embedded-rp-runtime)。源码按仓库内的非商业许可开放；构建出来的角色卡只含压缩后的运行产物。

## 快速开始

```bash
git clone https://github.com/AKkzzzz/embedded-rp-runtime.git
cd embedded-rp-runtime
node tools/test-runtime.mjs
node tools/test-model-runtime.mjs
node tools/test-summary-runtime.mjs
node tools/test-vector-memory.mjs
node tools/test-generation-monitor-isolation.mjs
node tools/test-branch-memory-reconciliation.mjs
node tools/build-template.mjs
node tools/audit-template.mjs
```

默认构建产物是 `release/内嵌RP运行时模板-v0.2-debug.json`，可直接导入 RP-Hub 检查运行时。这个 Debug 卡是开发底座，不是可直接换皮发布的成品角色卡。

## 派生一张新卡

1. 复制整个源码目录，但不要复制 `.git`、`release/`、`qa/` 和 `.DS_Store`。
2. 修改 `single-stage.manifest.json` 中的 `appId`、`marker`、`storagePrefix`；三者必须是新卡独有值。
3. 同步修改 `ui/data/template-data.js` 的应用身份、初始状态、变量 schema、世界书、插件和模型路线。
4. 修改 `card_src/core.json` 的名称、介绍、人物行为与场景；把题材内容放进模块，不要写进通用运行时。
5. 替换 `ui/index.html`、样式和 renderer，让玩家第一眼看到新卡自己的开场，而不是 Debug 控制台。
6. 只开启玩法真正使用的插件。总结、向量、工具、生图和媒体默认都不是每张卡必需。
7. 运行上面的测试、构建和审计命令，再把生成 JSON 打包进自己的卡面 PNG。

完整派生约束见 [维护与派生指南](docs/maintenance.md)，架构边界见 [架构说明](docs/architecture.md)，本次从春物 GAL 回灌的通用修复见 [同步记录](docs/spring-gal-sync-2026-09-10.md)。

当前阶段是 Debug-first：

- 默认进入后台控制台，不直接开始故事；
- 可以检查宿主能力、模型路由、世界书、触发规则、变量、预设、插件、记忆和诊断；
- 世界书兼容 RP-Hub 的历史扫描、概率、作用域、顺位和七类注入位置，并额外支持可关闭的显式依赖递归；
- 内置与 RP-Hub 官方导出逐项一致的完整默认预设，支持搜索、翻阅、编辑、复制、角色、阶段、启停和排序；
- 预设可按 RP-Hub 的直接数组 JSON 格式双向导入导出；
- “开始游戏”只切换表现层，不改变底层状态；
- 从同源 `RPHubDB` 读取用户已经保存的 API 地址、模型与 Key，使用 RP-Hub 相同的 OpenAI 兼容请求形状；
- Key 只在请求适配器闭包中使用，不写入卡内存档、诊断或界面，不加载远程 JavaScript；
- 支持流式输出、停止、继续、重新生成、编辑、删除和清空卡内楼层；重 Roll、改写和删除只清理被替换分支的总结与向量。
- 可选开启卡内向量记忆和历史总结；默认继承 RP-Hub 的 embedding/平衡模型，向量只存卡自己的 IndexedDB。
- 向量记忆使用 `int8:maxabs:v1` 存储；正文会先去除 GAL/工具/状态传输标签再向量化，原始聊天格式仍完整保留给主模型。自动索引按最新完整回合执行，巡检默认关闭，embedding 失败时进入退避重试队列。
- 主叙事监视与总结、状态、生图等后台请求隔离，后台 100–250 字总结不会覆盖主模型的思考和正文计数。
- 内置世界书可以由玩家覆盖、启停并恢复卡内原文，也可以新增和删除本地条目；这些改动只保存在当前卡的本地存储中。
- 可选的卡内能力插件已按 RP-Hub 体验重写：`runtime.rpg-companion` 提供 RPG 状态上下文，`runtime.command-registry` 提供白名单命令，`runtime.variable-overlay` 提供不占舞台空间的浮球变量面板，`runtime.dynamic-lore` 提供状态型动态 Lore，`runtime.webllm` 提供宿主本地模型适配，`runtime.media-stage` 提供音频、视觉效果和 Live2D 能力探测。
- 独立的 `生图` Debug 分区可以继承 RP-Hub 的 `imageGenKey`、比例、尺寸和数量设置，按需调用 RP-Hub 生图服务；密钥不会进入诊断、canonical state 或发布说明。
- 游戏页的“调试：开/关”只控制卡内调试浮球与监视面板，不改变剧情状态或模型请求；选择会保存在本地设置中。
- 剧情生图会发出 `image:requested`、`image:generating`、`image:generated` 和 `image:generation-error` 事件。游戏页会显示“生图中”及失败原因，失败记录保留在生图页可重试。
- 这些插件默认关闭，只有卡或用户显式启用才建立监听器和浮层；它们是本地安全适配器，不会原样执行 Tavern Helper、JS-Slash-Runner 或远程扩展脚本。

## 目标形态

同一个运行时可以承载不同 renderer：

- Galgame；
- 单舞台电子书；
- 聊天模拟器；
- 战棋；
- 其他卡内交互应用。

世界观、资产和玩法属于应用包；世界书引擎、状态、记忆、模型网关和插件运行时属于模板核心。

## 浏览器预览

在仓库根目录运行 `python3 -m http.server 8774`。

打开：

```text
http://127.0.0.1:8774/ui/
```

测试、构建、审计与 Git 收尾流程见 [Git 工作流](docs/git-workflow.md)，预设互通格式见 [预设导入导出](docs/preset-interchange.md)，社区能力接入见 [社区能力](docs/community-suite.md)。

## 安全边界

模板只接受构建期打包的插件。卡内脚本只读取 RP-Hub 的同源模型设置，不能安装远程扩展、扫描父页面 DOM 或直接改写宿主全局世界书。模型写入世界书必须提交结构化补丁，经过 schema、权限和冲突检查后才可落盘。

## 能力层说明

插件清单位于 `ui/data/template-data.js` 与 `single-stage.manifest.json`，实现位于
`ui/runtime/capability-plugins.js`。新卡只需要在自己的数据层启用相应插件；不要把外部插件的任意 JavaScript、网络请求或父页注入代码直接复制进卡。WebLLM、Live2D 和音频资源仍由卡自行提供本地资产或宿主桥接，未提供时只报告不可用，不影响纯文字玩法。
