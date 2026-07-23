# 架构参考与许可证边界

## 本运行时身份

- 维护者 / 版权标识：`AKkzzzz`；
- 项目定位：RP-Hub 单正则 + 插件功能的小卡底层；
- 社区许可：见 `LICENSE-COMMUNITY-NONCOMMERCIAL.txt`；
- 发布规则：正式卡只携带压缩运行产物，不携带本仓库的模块化源码、测试或构建工具；
- 每个发布包的 `embedded_runtime_manifest.provenance.sourceHash` 是内嵌运行 HTML 的 SHA-256，用于核对构建来源；
- GitHub 仓库：`https://github.com/AKkzzzz/embedded-rp-runtime`；

本模板的实现代码为当前项目新写代码。参考项目用于研究架构和交互概念，没有把远程项目源代码直接复制进卡。

## 参考

- SillyTavern：事件系统、扩展生命周期、命令、World Info、提示词控制与多模型前端概念。项目使用 AGPL-3.0。
- LittleWhiteBox：模块清理、诊断、变量 schema、记忆与世界书管理概念。项目使用 Apache-2.0，并有明确署名要求。
- JS-Slash-Runner / 酒馆助手：iframe 生命周期、事件顺序、命令桥和自动清理概念。项目使用 Aladdin License。
- RP-Hub：角色卡字段、正则、可执行 iframe、`triggerSlash` 与本地模型前端行为。项目使用 CC BY-NC 4.0。

## 当前策略

- 不复制上述项目的实现代码；
- 不把 SillyTavern 扩展直接安装到 RP-Hub 卡内；
- 不提供任意远程脚本安装；
- RP-Hub 兼容适配只依赖官方当前使用的 `RPHubDB/store/rp_hub_settings` 持久化键与 OpenAI 兼容接口；
- 该同源键属于兼容基线，RP-Hub 上游变更时由回归测试与兼容台账同步；
- 如果未来采用或修改参考项目代码，先单独审计许可证、署名和分发条件。

## RP-Hub 预设

模板中的 `sources/rphub-official-presets.json` 保存 RP-Hub 官方导出的完整默认预设快照，`ui/data/rphub-presets.js` 由同步脚本生成。每个条目的 `source` 字段保留：

- 项目：`STA1N156/RP-Hub`；
- 来源链接；
- 许可证：`CC BY-NC 4.0`；
- `adapted: false`。

这些预设延续非商业与署名要求。提示词正文、角色和默认启停状态与官方快照逐项一致；模板只补充内部 ID、注入阶段、顺位和来源元数据。

## RP-Hub 世界书兼容层

`ui/runtime/worldbook-engine.js` 与 `ui/runtime/prompt-compiler.js` 参考本地 RP-Hub `092ab90` 的字段归一化、历史扫描、概率判定和七类位置注入语义重新实现，并保留源码注释署名。模板没有复制 RP-Hub 的整段应用代码；兼容层继续遵守 CC BY-NC 4.0。

模板额外提供 RP-Hub 当前没有的显式 `dependencies` 递归、状态触发、可选字符预算和事务化模型补丁。这些扩展不会写入标准 RP-Hub 世界书导出字段。

## RP-Hub 模型兼容层

`ui/runtime/host-bridge.js` 与 `ui/runtime/model-gateway.js` 依据本地 RP-Hub `092ab90` 的设置持久化键、端点拼接和聊天请求形状重新实现。模板不复制 RP-Hub 的 Vue 应用代码；兼容层读取同源设置后只发送 `model`、`messages`、`temperature` 与 `stream`，并独立处理流式增量和原生 reasoning 字段。
