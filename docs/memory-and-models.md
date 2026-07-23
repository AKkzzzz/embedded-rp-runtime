# 模型路由与记忆设计

## 模型路由

运行时不把所有任务交给同一模型配置。

| Route | 输入 | 输出 | 默认继承 |
|---|---|---|---|
| narrative | 当前输入、历史、世界书、记忆、状态 | 可见叙事与应用信封 | RP-Hub 当前模型 |
| state | 当前状态、叙事结果、schema | 结构化补丁 | RP-Hub 变量模型 |
| summarize | 一段已完成历史与来源 ID | 结构化记忆候选 | 平衡模型 |
| embedding | 文本数组 | 向量数组 | RP-Hub 向量模型 |

应用可以把 `narrative` 与 `state` 合并为一次回复，也可以拆成两步。无论采用哪种方式，State Guard 都在最终提交前运行。

## 向量流水线

```text
对话或确认事实
  → 清除代码、状态块和隐藏协议
  → 按语义段落切分
  → 记录 sourceId / turn / revision
  → 后台 embedding 批处理
  → 校验维度与模型版本
  → 量化或压缩后写入 IndexedDB
```

每条向量索引至少保存：

```text
id
sourceId
sourceRevision
embeddingModel
dimensions
embedding
summary
characters
entities
timeRange
stale
```

切换 embedding 模型或维度后，旧索引不能与新索引混算。运行时标记为待重建，并继续使用关键词与结构化记忆。

## 混合检索

最终记忆分数不是纯余弦相似度：

```text
score =
  semanticSimilarity
  + entityMatchBoost
  + unresolvedThreadBoost
  + recentContextBoost
  - stalePenalty
```

同一事件的多个分片先按 `sourceId` 合并，避免一个旧场景占满 Top K。结果必须显示来源和时间，模型不能把旧记忆误认为当前现场。

## 世界书与向量的组合顺序

1. 常驻世界规则；
2. 精确名称与正则触发世界书；
3. 状态触发世界书；
4. 世界书递归依赖；
5. 结构化记忆；
6. 向量召回；
7. 当前权威状态；
8. 最近对话与玩家输入。

精确规则高于语义相似结果。向量不能覆盖作者锁定规则或最新 canonical state。

## 性能边界

- 首屏 Debug 不建立向量索引；
- 只有打开 Memory 页面或产生待索引内容时才加载相关模块；
- embedding 批次可取消；
- 手机模式限制并发与批次大小；
- 不在每次按键时重新向量化；
- 长期向量存 IndexedDB，不内联进角色卡 JSON；
- 导出存档时允许选择是否包含向量，默认可只导出文本记忆并在新设备重建。
