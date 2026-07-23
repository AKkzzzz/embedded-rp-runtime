# 内嵌 RP 运行时维护与单飞路线

当前版本是一个“以 RP-Hub 为宿主、以卡内运行时为产品底座”的稳定 base。卡内运行时负责把模型输入到输出之间的过程固定下来；RP-Hub 只负责提供用户已有的模型配置、请求凭据和宿主环境。

## 当前版本边界

已经具备：

- RP-Hub 官方预设快照与 Prompt Compiler；
- RP-Hub 世界书字段、扫描深度、概率、七类注入位置和卡内递归；
- 流式模型调用、停止、继续、重生成、编辑、删除、清空楼层；
- 40 楼默认历史保留策略、结构化总结和 Int8 向量记忆；
- 后台向量巡检、失败重试队列和本地 IndexedDB 存储；
- 状态 schema、世界书补丁审批和版本冲突检查；
- 插件生命周期、能力声明、依赖排序、启停和错误隔离；
- 时间线、RPG 状态、白名单命令、变量浮层、动态 Lore、WebLLM 和媒体能力适配器；
- `d20`、`NdM`、修正值骰子工具与 `/roll` 命令；
- Debug 控制台、单舞台 renderer 入口和静态 JSON 构建出口。

刻意没有做成宿主替代品的部分：

- 不加载任意远程 JavaScript；
- 不扫描或写入 RP-Hub 父页面 DOM；
- 不直接改写 RP-Hub 全局世界书、全局向量库或全局聊天楼层；
- WebLLM、Live2D 和外部搜索只提供受控适配接口，资源和运行时由卡自行提供；
- 插件默认关闭，卡只启用自己真正使用的能力。

## 主要接入口

### 模型与宿主

入口文件：[host-bridge.js](/Users/nanami/Documents/ecnu/mygame/cards/内嵌RP运行时模板/ui/runtime/host-bridge.js)

公开能力包括：

- `RPHost.detect()`
- `RPHost.capabilities()`
- `RPModels.generate(route, messages, options)`
- `RPModels.embed(texts, options)`

RP-Hub 模式从同源 `RPHubDB` 读取配置；Key 只留在请求适配器闭包中。独立预览可以注入 mock provider。

### 对话与楼层

入口文件：[conversation-engine.js](/Users/nanami/Documents/ecnu/mygame/cards/内嵌RP运行时模板/ui/runtime/conversation-engine.js)

主要 API：

```js
RPConversation.send(text)
RPConversation.stop()
RPConversation.continueLast()
RPConversation.regenerate()
RPConversation.edit(messageId, content)
RPConversation.remove(messageId)
RPConversation.clear()
```

模型输出统一经过 Prompt Compiler、工具多轮续写、Prompt Regex 和存储提交；表现层不应自行复制一套聊天状态。

### 世界书、状态与记忆

- `RPWorldbook.retrieve(input, options)`
- `RPWorldbookPatches.propose/commit/reject`
- `RPStateGuard.validate/applyPatch`
- `RPMemory.searchStructured/searchVectors`
- `RPSummary.contextHistory/summarize`
- `RPVectorMemory.patrol/retryQueue/stats`

卡内世界书是作者内容和模型提案的边界；向量和总结只是检索辅助，不得覆盖 canonical state。

### 插件与事件

入口文件：

- [plugin-runtime.js](/Users/nanami/Documents/ecnu/mygame/cards/内嵌RP运行时模板/ui/runtime/plugin-runtime.js)
- [capability-plugins.js](/Users/nanami/Documents/ecnu/mygame/cards/内嵌RP运行时模板/ui/runtime/capability-plugins.js)
- [event-bus.js](/Users/nanami/Documents/ecnu/mygame/cards/内嵌RP运行时模板/ui/runtime/event-bus.js)

插件通过 manifest 声明 `capabilities`，再由 `RPPlugins.attach(id, implementation)` 绑定实现。监听器必须使用插件 owner 注册，以便禁用时自动清理：

```js
RPEvents.on('conversation:changed', handler, { owner: 'my-plugin' });
RPPlugins.setEnabled('my-plugin', false);
```

当前插件 ID：

| ID | 作用 |
|---|---|
| `runtime.worldbook.recursion` | 世界书依赖递归 |
| `runtime.patch.guard` | 模型补丁校验 |
| `runtime.timeline` | 检查点、分支、回滚 |
| `runtime.rpg-companion` | RPG 状态上下文 |
| `runtime.command-registry` | 白名单命令 |
| `runtime.variable-overlay` | 浮球变量查看器 |
| `runtime.dynamic-lore` | 动态 Lore 接口 |
| `runtime.webllm` | 本地模型适配 |
| `runtime.media-stage` | 音频、视觉事件、Live2D 探测 |
| `runtime.prompt-inspector` | 最终 Prompt 与注入来源检查 |
| `runtime.guided-generations` | AI 行动建议 |
| `runtime.character-memory` | 结构化人物记忆 |
| `runtime.notebook` | 可选择注入的玩家便签 |
| `runtime.persona-switcher` | 卡内 Persona 切换 |
| `runtime.visual-novel` | 视觉小说表现模式 |
| `runtime.diagram` | 轻量关系图与流程图 |
| `runtime.parameter-randomizer` | 受限模型参数随机化 |
| `runtime.lore-copilot` | 世界书补丁草稿 |
| `runtime.lore-recommender` | 世界书命中与冲突诊断 |

### 卡面、浮层和媒体

- renderer 只负责表现，不拥有模型历史；
- 变量浮层使用 `runtime.variable-overlay`，固定定位，不占舞台布局；
- `RPMedia.registerAsset(id, localSource, kind)` 注册本地资源；
- `RPMedia.playAudio(id, options)` 播放本地音频；
- `RPMedia.effect(name, payload)` 发出视觉效果事件；
- Live2D 只有在卡内提供本地运行时后才启用。

## 构建与发布出口

源代码入口是 `ui/`、`single-stage.manifest.json` 和 `sources/`。不要直接编辑 `release/`。

标准检查：

```bash
cd "/Users/nanami/Documents/ecnu/mygame/cards/内嵌RP运行时模板"
node tools/test-runtime.mjs
node tools/test-model-runtime.mjs
python3 ../../skills/build-rphub-card/scripts/audit_single_stage_manifest.py single-stage.manifest.json --project-root .
node tools/build-template.mjs
node tools/audit-template.mjs
node tools/render-preview.mjs
git diff --check
```

出口文件：

- `release/内嵌RP运行时模板-v0.1-debug.json`：可导入 RP-Hub 的正式 JSON；
- `qa/template-card-preview.html`：单正则预览；
- `single-stage.manifest.json`：构建与能力审计清单；
- `README.md` 与 `docs/`：维护说明，不进入模型上下文。

提交前不要用 `git add .`，避免把 `.DS_Store` 或临时预览提交进去。

## 单飞方案

单飞不是重写卡内逻辑，而是替换宿主适配器。保持 `RPModels`、`RPStorage`、`RPEvents`、`RPPlugins` 这些稳定接口，新增一个独立 provider：

```text
RP-Hub Host Adapter
        ↓ 替换为
Standalone Host Adapter
        ↓
Model Gateway / Conversation / Worldbook / Memory / Renderer
```

### 接口替换表

| 当前 RP-Hub 依赖 | 单飞替换 |
|---|---|
| `RPHubDB` 设置读取 | 独立设置仓库或加密配置存储 |
| RP-Hub API Key | 用户自己的 provider vault |
| OpenAI-compatible endpoint | 独立 provider registry |
| RP-Hub 当前/质量/平衡模型 | 卡内 route 配置页 |
| RP-Hub embedding/summary 模型 | 独立向量与总结 route |
| `triggerSlash` | 卡内 command registry |
| 父页面宿主能力 | `StandaloneHostAdapter` |
| RP-Hub 导出 JSON | 独立卡包/存档导出器 |

单飞时不应改动 Prompt Compiler 的消息顺序，也不应把 provider 逻辑散落到世界书、renderer 或插件里。只要新适配器实现 `RPModels.generate/embed`、设置检测和能力报告，现有卡的剧情输入输出行为即可保持一致。

### 单飞新增接口建议

```js
window.RPStandalone = {
  settings: { read, write, clear },
  models: { list, test },
  generation: { create, stop },
  embeddings: { create },
  storage: { export, import },
  assets: { resolve }
};
```

其中 `storage.export/import` 只处理 canonical、偏好、文本记忆和时间线；向量默认重建，避免把大型二进制索引塞进角色卡。

## 后续开发顺序

1. 为时间线、RPG Companion 和浮层补 UI，不改变现有底层 API。
2. 为骰子增加优势/劣势、DC 检定、暴击和跑团日志。
3. 完成本地 WebLLM provider，而不是把大型模型包默认塞进卡。
4. 接入卡自带音频、Live2D 和视觉资源。
5. 再实现独立 Host Adapter，验证单飞与 RP-Hub 的 Prompt 快照一致性。

每次扩展都要同时更新 manifest、测试、README 和本文件，并通过构建与审计后再发布。
