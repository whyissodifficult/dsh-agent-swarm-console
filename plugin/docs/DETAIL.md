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

三态规则：缺证据 YELLOW；任一 check 失败 RED（必带可复制执行的 `reproCmd`）；全部有证据且通过 GREEN。放行只能由用户通过门禁卡触发。

## 已知限制

- 还没有画布 —— 看不到 agent 节点、连线或过程可视化
- 交付门禁为 v1 实验：证据存**进程内 Map**，DSH 重启即丢，不做持久化
- 本插件以 **link 方式**装进当前 profile；新增的 `verify_*` 工具需**重启 DSH** 才会注册，未重启时宿主只看到 `swarm_run`
- 门禁卡 GUI 截图与 approve/retry 事件流：当前为**未验证项**，待宿主重启后补
- 图标未提供 —— 当前回落 DSH 默认图标
- `swarm_run` 只支持一次调用，不支持多轮对话或子 agent 编排
