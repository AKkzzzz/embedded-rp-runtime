# 卡内 RP 运行时架构

## 设计判断

原始十模块方向成立，但还不足以支撑一个可复用的小型 RP 前端。正式内核采用五层：

```text
宿主层
  RP-Hub Same-origin Settings Adapter
  Preview / Future Host adapters

服务层
  Model Gateway
  Storage Engine
  Task Queue
  Import / Export

叙事内核层
  Prompt Compiler
  Worldbook Engine
  State Guard
  Conversation Engine
  Structured Memory
  Vector Index

扩展层
  Event Bus
  Plugin Runtime
  Command Registry
  Diagnostics

表现层
  Debug Console
  Galgame Renderer
  Ebook Renderer
  Tactical Renderer
```

## 为什么要补四项底层能力

### Host Capability Bridge

卡内 iframe 使用 RP-Hub 官方当前的同源存储键读取用户已保存的模型设置。适配层只向上暴露脱敏设置与受控请求方法：

- `capabilities`
- `models.list`
- `generation.create`
- `embeddings.create`（继承 RP-Hub embedding 配置，失败进入卡内重试队列）
- `intent.submit`
- `records.read`

Key 只存在于设置适配器闭包；公共设置、诊断和存档都只能看到 `hasApiKey`。

### Model Gateway

模型不是一个全局字符串。每个职责拥有独立 route：

- `narrative`：主要叙事；
- `state`：结构化状态补丁；
- `summarize`：记忆压缩；
- `embedding`：向量嵌入。

route 只保存模型 ID 和参数，不保存 Key。配置可继承 RP-Hub 当前、质量、平衡、快速或变量模型，也可以在模板内覆盖模型 ID。

主叙事和 UI Template 状态副模型分别保留最近一次只读调试轨迹：请求消息、真实响应、解析结果、工具调用与耗时。renderer 通过 `RPConversation.debugTrace()` 和 `RPUIStateSync.trace()` 读取；调试轨迹不进入下一轮提示词，也不参与状态裁定。

Prompt Compiler 不把整份 canonical state 暴露给主模型。它只注入叙事需要的紧凑变量视图：玩家、场景、RPG 角色、在场人物、任务、背包、属性、影片和战斗状态。运行时模式、完整对话、知识库内部结构与 UI Template 配置继续由各自服务持有，避免提示词膨胀和实现细节污染正文。

骰子工具返回结构化结果。Conversation Engine 将真实工具结果写成
`[DICE_RESULT|类型|骰式|骰点|结果|加骰次数|初始骰数]`，再继续同一轮生成。该事件由运行时拥有，模型不得自行伪造；具体卡的 renderer 可把它显示为骰面、跑团日志或战斗播报。

每次主模型生成都持有一个 `generationEpoch`。清档会递增世代并中止当前请求；属于旧世代的流式增量、工具续写、完成回调和错误回调全部失去提交资格，因此延迟到达的宿主响应不能恢复已经清除的楼层。状态模型与 UI Template 更新共用串行队列，renderer 可通过 `RPConversation.whenStateSettled()` 等待收敛。

Conversation Engine 为每轮工具续写维护调用键集合。相同工具名与规范化参数在同一轮只执行一次，后续重复调用只返回第一次结果；骰子不会因为模型重复输出工具标签而重新投掷。

### Storage Engine

需要区分三类状态：

- canonical：会影响故事，必须导出、校验和迁移；
- authored：世界书、预设、schema 和插件清单；
- local：当前标签、主题、调试过滤器等纯显示偏好。

localStorage 只保存小型偏好。长历史、向量和版本日志进入 IndexedDB。任何 canonical 修改使用事务和版本号。

当前 Debug 模板先用 localStorage 验证聊天闭环；流式草稿只驻留内存，完成、停止或失败后才落盘，避免每个 token 都写存储。生产应用在长历史阶段迁移到 IndexedDB。

### Task Queue

向量化、摘要、索引重建和迁移不能阻塞对话。任务队列负责：

- 去重；
- 可取消；
- 失败重试上限；
- 页面关闭后的安全恢复；
- 不得在后台自主推进剧情。

向量索引按卡的 `storagePrefix` 使用独立 IndexedDB，派生卡之间不共享向量数据。索引从第一个完整用户/助手回合开始建立，与 RP-Hub 一致；`maxHistoryFloors` 只控制近期原文保留窗口及召回排除范围，近期回合虽已入库但不参与向量召回，避免同一内容以原文和向量重复注入。重置当前卡时同时清除本卡前缀下的偏好、队列、结构化记忆和向量库。

## 世界书与记忆不是同一系统

### Worldbook

作者或玩家确认过的知识库。它回答“这个世界当前有哪些可用规则和事实”。

### Structured Memory

从实际剧情沉淀的事件、人物、关系、承诺、物品状态和未解决线索。它回答“过去发生过什么”。

### Vector Index

结构化记忆与历史文本的检索索引。它回答“哪些旧内容与本轮输入语义相关”。向量条目不是权威事实；命中结果必须携带来源、时间和版本。

三者可以共同进入 Prompt Compiler，但拥有不同优先级、预算和失效规则。

## 模型写世界书

模型不能直接执行写操作。只接受：

```json
{
  "type": "worldbook.patch.proposal",
  "baseRevision": 12,
  "operations": [
    {
      "op": "add",
      "entry": {}
    }
  ],
  "reason": "本轮发现了需要长期保存的新事实",
  "evidenceMessageIds": [
    "turn-42"
  ]
}
```

处理顺序：

1. 解析为数据；
2. 检查操作权限；
3. schema 校验；
4. 检查 ID、触发词、递归依赖和秘密泄露；
5. 与 `baseRevision` 比较；
6. 生成差异预览；
7. 按策略自动接受安全操作，或等待用户确认；
8. 事务提交并保留撤销日志。

默认策略只允许模型新增 `memory-derived` 区条目；核心规则、角色底线、系统协议和作者锁定条目只能人工修改。

## Debug-first 启动

模板第一次载入停在控制台：

- Runtime：版本、存储和宿主能力；
- Models：四条模型 route 与可用性；
- Worldbook：条目、触发类型、递归、预算和模拟扫描；
- State：当前值、schema、补丁预演和迁移；
- Presets：系统提示词与编译顺序；
- Plugins：依赖、权限、状态、耗时和错误；
- Memory：结构化记忆、向量覆盖率和队列；
- Diagnostics：最近一次完整编译轨迹。

“开始游戏”只选择 renderer 并发出 `runtime:start`。所有底层服务保持同一实例。

## 生成参数继承

`RPHost.generationParameters()` 是唯一的宿主生成参数边界。`RPModels.generate()` 按“单次调用 > 模型 route > RP-Hub 宿主”的优先级合并参数；`max_completion_tokens` 与 `max_tokens` 同时存在时优先前者。显式 provider 扩展参数会过滤凭证类键与 `model/messages/temperature/stream` 等运行时保留键；设置界面只展示过滤后的公开快照。

Prompt Compiler 使用 canonical `player.name` 解析 `{{user}}`，使用当前角色名解析 `{{char}}`。派生卡不读取宿主用户档案时，应在自身开局流程中写入 `player.name`。

embedding 路由默认继承 RP-Hub 的记忆设置。卡内覆盖选择器只列出具有 embedding/向量特征的模型；保存覆盖前必须对 `/embeddings` 做一次小型能力探测并取得合法向量。模型名称筛选只负责减少误选，接口探测才是最终能力判断。

RP-Hub UI Template 状态副模型由 `RPUIStateSync` 对齐：只读取已完成对话、只返回变量更新 JSON，并保留最近一次请求、响应、解析结果和变更列表作为只读调试轨迹。派生卡若实现更具体的 `RPStateSync.trace()`，悬浮 Debug 优先显示该轨迹，否则显示 `RPUIStateSync.trace()`。

副模型调度遵循单请求原则：派生卡提供 `RPStateSync` 时，由它在同一次响应中完成 canonical patch、UI Template 变量和行动建议，Conversation Engine 不再额外调用 `RPUIStateSync`。只有未提供卡级状态模型的通用模板才单独使用 `RPUIStateSync`。所有异步状态提交必须合并到返回当刻的最新 canonical state，不能用请求开始前的快照整包覆盖。
