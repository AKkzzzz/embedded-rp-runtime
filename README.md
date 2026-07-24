# 内嵌 RP 运行时模板

这是一个面向 RP-Hub 的“单正则 + 插件功能”小卡底层，由 `AKkzzzz` 维护。它是源码可见、禁止商业使用的卡内运行时底座；正式卡包只分发压缩后的运行产物，不分发本仓库的开发源码、测试和构建工具。

这是一个面向 RP-Hub 角色卡的卡内应用底座。它把模型调用、聊天楼层、世界书检索、状态校验、记忆、插件生命周期和单舞台呈现放进一个可审计的本地运行时。

当前阶段是 Debug-first：

- 默认进入后台控制台，不直接开始故事；
- 可以检查宿主能力、模型路由、世界书、触发规则、变量、预设、插件、记忆和诊断；
- 世界书兼容 RP-Hub 的历史扫描、概率、作用域、顺位和七类注入位置，并额外支持可关闭的显式依赖递归；
- 内置与 RP-Hub 官方导出逐项一致的完整默认预设，支持搜索、翻阅、编辑、复制、角色、阶段、启停和排序；
- 预设可按 RP-Hub 的直接数组 JSON 格式双向导入导出；
- “开始游戏”只切换表现层，不改变底层状态；
- 从同源 `RPHubDB` 读取用户已经保存的 API 地址、模型与 Key，使用 RP-Hub 相同的 OpenAI 兼容请求形状；
- Key 只在请求适配器闭包中使用，不写入卡内存档、诊断或界面，不加载远程 JavaScript；
- 支持流式输出、停止、继续、重新生成、编辑、删除和清空卡内楼层。
- 可选开启卡内向量记忆和历史总结；默认继承 RP-Hub 的 embedding/平衡模型，向量只存卡自己的 IndexedDB。
- 向量记忆使用 `int8:maxabs:v1` 存储，后台会巡检已完成楼层；embedding 失败时进入卡内重试队列并采用退避重试，不阻塞正文流式输出。
- 可选的卡内能力插件已按 RP-Hub 体验重写：`runtime.rpg-companion` 提供 RPG 状态上下文，`runtime.command-registry` 提供白名单命令，`runtime.variable-overlay` 提供不占舞台空间的浮球变量面板，`runtime.dynamic-lore` 提供状态型动态 Lore，`runtime.webllm` 提供宿主本地模型适配，`runtime.media-stage` 提供音频、视觉效果和 Live2D 能力探测。
- 独立的 `生图` Debug 分区可以继承 RP-Hub 的 `imageGenKey`、比例、尺寸和数量设置，按需调用 RP-Hub 生图服务；密钥不会进入诊断、canonical state 或发布说明。
- 这些插件默认关闭，只有卡或用户显式启用才建立监听器和浮层；它们是本地安全适配器，不会原样执行 Tavern Helper、JS-Slash-Runner 或远程扩展脚本。

## 目标形态

同一个运行时可以承载不同 renderer：

- Galgame；
- 单舞台电子书；
- 聊天模拟器；
- 战棋；
- 其他卡内交互应用。

世界观、资产和玩法属于应用包；世界书引擎、状态、记忆、模型网关和插件运行时属于模板核心。

## 开发入口

```bash
python3 -m http.server 8774
```

打开：

```text
http://127.0.0.1:8774/cards/内嵌RP运行时模板/ui/
```

测试、构建、审计与 Git 收尾流程见 [docs/git-workflow.md](docs/git-workflow.md)，预设互通格式见 [docs/preset-interchange.md](docs/preset-interchange.md)，社区能力接入见 [docs/community-suite.md](docs/community-suite.md)，维护和单飞方案见 [docs/maintenance.md](docs/maintenance.md)。

## 安全边界

模板只接受构建期打包的插件。卡内脚本只读取 RP-Hub 的同源模型设置，不能安装远程扩展、扫描父页面 DOM 或直接改写宿主全局世界书。模型写入世界书必须提交结构化补丁，经过 schema、权限和冲突检查后才可落盘。

## 能力层说明

插件清单位于 `ui/data/template-data.js` 与 `single-stage.manifest.json`，实现位于
`ui/runtime/capability-plugins.js`。新卡只需要在自己的数据层启用相应插件；不要把外部插件的任意 JavaScript、网络请求或父页注入代码直接复制进卡。WebLLM、Live2D 和音频资源仍由卡自行提供本地资产或宿主桥接，未提供时只报告不可用，不影响纯文字玩法。
