# 架构参考与许可证边界

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
- 不依赖私有宿主内部变量名；
- 增强能力通过新定义的受限 postMessage 协议完成；
- 如果未来采用或修改参考项目代码，先单独审计许可证、署名和分发条件。

## RP-Hub 预设

模板中的 `sources/rphub-official-presets.json` 保存 RP-Hub 官方导出的完整默认预设快照，`ui/data/rphub-presets.js` 由同步脚本生成。每个条目的 `source` 字段保留：

- 项目：`STA1N156/RP-Hub`；
- 来源链接；
- 许可证：`CC BY-NC 4.0`；
- `adapted: false`。

这些预设延续非商业与署名要求。提示词正文、角色和默认启停状态与官方快照逐项一致；模板只补充内部 ID、注入阶段、顺位和来源元数据。
