# Swarm Console

在 DSH 里调用一个外部 agent 执行一次任务，返回结构化的停止原因与文本结果。

## 配置 externalAgents

在插件配置里给出 agent 画像表。令牌只写环境变量名，不写令牌值：

```yaml
externalAgents:
  deepseek:
    baseUrl: https://api.deepseek.com/v1
    apiKeyEnv: DEEPSEEK_API_KEY
    models: [deepseek-flash]
    capabilities: [reasoning, chinese]
capabilityRouting: true
```

每个条目必须有 `baseUrl`、`apiKeyEnv`、`models` 三项，缺一项插件激活即报错（不静默跳过）。

## 调用 swarm_run

参数：

```js
{ task: '要做的任务', agent: 'deepseek', model: 'deepseek-flash' }
```

`task` 必填；`agent` 省略时，若只配了一个 external agent 就自动用它；`model` 省略时用画像里的第一个。

返回：

```js
{ stopReason: 'completed' | 'cancelled' | 'error', text: '文本结果', ms: 1234 }
```

`stopReason='cancelled'` 表示调用被取消（`exec.signal` 触发），不抛异常。

## verify v1 三工具（实验性）

- `verify_contract({objective, constraints, criteria})` → `{contractId}`，契约内容冻结成 12 位 id
- `verify_run({contractId, checks})` → `{decision: 'GREEN'|'YELLOW'|'RED', reasons, evidenceHash, reproCmd?}`
- `verify_status({contractId})` → 有记录时 `{known:true, decision, at}`；未知契约 `{known:false}`（不返回三态值）

三态规则：缺证据 YELLOW；任一 check 失败 RED（必带可复制执行的 `reproCmd`）；全部有证据且通过 GREEN。

**放行入口（v1）**：斜杠命令 `/gate-approve <contractId>`、`/gate-retry <contractId>`、`/gate-status <contractId>`。放行只能由用户触发——斜杠命令由用户在交互界面直接输入，图中没有对应的模型工具，模型无法代替用户调用，H3（放行只能由用户触发）由这个结构保证，不依赖运行时身份判断。非 GREEN 时 `/gate-approve` 直接拒绝并提示先 retry。门禁卡（action-cards）为可选增强，仅在挂载该服务的 profile 生效。

每次命令执行会在会话日志留下 `command/run` 与 `command/done` 事件，可作为放行/重试的机器证据。

**`gate-retry` 语义**：用空证据重算，结果必为 YELLOW（提示补证据）；它只刷新决定时间戳，不伪造通过证据。要转 GREEN 需重新执行 `verify_run` 并提供真实证据。

## 已知限制

- **`exec` 检查以当前用户权限执行命令**：等同于你在终端敲那条命令。只把可信命令写进契约；不要接受来源不明的检查请求。
- **同步执行会阻塞宿主**：v0.2 的检查由 `spawnSync` 同步跑，单条最长 120 秒，期间宿主事件循环被占用，界面可能短暂无响应。异步执行排进 0.3。
- 证据存**进程内 Map**，DSH 重启即丢，不做持久化（重启后 `/gate-status` 返回「未知契约」）
- 还没有画布 —— 看不到 agent 节点、连线或过程可视化
- 多阶段评审状态机未实现
- 动作卡片：代码保留为可选增强，需目标 profile 挂载 `action-cards` 服务；v1 的放行入口是斜杠命令
- `swarm_run` 只支持一次调用，不支持多轮对话或子 agent 编排

