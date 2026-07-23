# 宿主能力矩阵

| 能力 | 标准 RP-Hub | 增强 RP-Hub 桥 | 独立预览 |
|---|---|---|---|
| 提交主对话意图 | `triggerSlash` | bridge | mock |
| 读取可用模型列表 | 不保证 | 支持 | mock |
| 指定叙事模型 | 使用宿主当前模型 | 支持 route | mock |
| 指定状态模型 | 使用 RP-Hub 原生变量更新器或合并回复 | 支持 route | mock |
| 指定摘要模型 | 不保证 | 支持 route | mock |
| 向量嵌入 | 宿主自身记忆可用，但卡内不能调用 | 支持 | 可关闭或 mock |
| 读取 API Key | 禁止 | 禁止 | 无 |
| 修改宿主世界书 | 不支持 | 默认不支持 | 无 |
| 卡内世界书编辑 | 支持 | 支持 | 支持 |
| 卡内 IndexedDB | 支持 | 支持 | 支持 |

## 降级原则

增强桥不存在时：

- Debug 控制台明确显示缺失能力；
- 不能假装模型 route 已生效；
- 主叙事退回 `triggerSlash`；
- 向量功能保持关闭，关键词和结构化记忆仍可使用；
- 世界书编辑继续作用于卡内知识库；
- 不扫描 RP-Hub IndexedDB 获取凭据。

## 建议的增强桥消息

```text
RPHUB_CAPABILITIES_REQUEST / RESPONSE
RPHUB_MODELS_REQUEST / RESPONSE
RPHUB_GENERATE_REQUEST / RESPONSE
RPHUB_EMBED_REQUEST / RESPONSE
RPHUB_RECORDS_REQUEST / RESPONSE
```

宿主必须验证消息源来自当前可执行卡 iframe，并对单卡并发、请求大小、超时和模型 route 做限制。
