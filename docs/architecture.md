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
