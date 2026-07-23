# 安全与权限

## 默认拒绝

模板不提供：

- 远程 JavaScript 安装；
- 任意 `eval`；
- 父页面 DOM 扫描；
- RP-Hub API Key、Cookie 或无关聊天读取；
- 未声明的网络请求；
- 插件直接写 canonical state；
- 模型直接覆盖作者锁定世界书；
- 后台定时生成剧情。

## 插件能力

能力声明用于审计和路由，不等同于浏览器级安全沙箱。插件仍需构建期代码审查。

建议能力词表：

```text
events:listen
commands:register
prompt:inspect
prompt:modify
worldbook:read
worldbook:patch:propose
retrieval:extend
state:read
state:patch:propose
memory:read
memory:write
model:request:narrative
model:request:state
model:request:summarize
model:request:embedding
diagnostics:write
storage:local
```

插件必须登记监听器、计时器、worker、object URL 和 AbortController，由运行时在禁用或卸载时统一清理。
