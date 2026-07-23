# 预设管理与 RP-Hub 互通

模板内的“预设”指发送给模型的提示词片段，不是角色卡世界书。它们可以使用 `system`、`user`、`assistant` 三种角色，并由卡内 Prompt Compiler 按阶段组装。

## RP-Hub 兼容格式

RP-Hub 当前把预设导出为 JSON 直接数组：

```json
[
  {
    "name": "示例预设",
    "content": "提示词正文",
    "enabled": true,
    "role": "system"
  }
]
```

本模板默认导出同样的直接数组，只写入四个互通字段：

- `name`
- `content`
- `enabled`
- `role`

文件可直接在 RP-Hub 的预设页导入。模板导入时也接受 RP-Hub 支持的单个预设对象；为便于其他工具集成，额外接受 `{ "presets": [...] }` 包装对象。

## 模板扩展字段

卡内管理器还保存以下本地信息：

- `id`：稳定内部标识；
- `phase`：`system-root`、`system-support` 或 `prelude`；
- `order`：Prompt Compiler 顺位；
- `source`：来源和许可；
- `locked`：运行时核心保护；
- `builtin`：模板内置或用户自定义。

这些字段不写入 RP-Hub 互通文件。RP-Hub 导入项回到模板时，`system` 默认进入 `system-support`，`user` 和 `assistant` 默认进入 `prelude`。之后可以在卡内管理器中调整顺位和阶段。

## 管理行为

- 内置非锁定预设可以编辑；修改以本机覆盖层保存，不直接改写模板源文件。
- 官方默认预设均可编辑和启停；本地修改不会改写官方快照。
- 导入项和新建项属于自定义预设，可以编辑、复制和删除。
- “恢复此内置项”只清除该项覆盖。
- “恢复默认”会清除全部自定义项、覆盖、启停和排序设置。

所有管理数据保存在浏览器当前站点的 `localStorage`。构建正式模板时，只有 `ui/data/rphub-presets.js` 中的内置预设会被打包为新用户的默认值。

## 官方默认同步

`sources/rphub-official-presets.json` 保存 RP-Hub 官方直接数组格式的快照。运行：

```bash
node tools/sync-rphub-presets.mjs
```

会重新生成 `ui/data/rphub-presets.js`。生成过程不改写提示词正文、角色或默认启停状态，只补充卡内运行时需要的稳定 ID、注入阶段、顺位和来源字段。
