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

## 已知限制

- 还没有画布 —— 看不到 agent 节点、连线或过程可视化
- 没有交付门禁 —— 不校验 evidence，不做 verified/unverified 判定
- 图标未提供 —— 当前回落 DSH 默认图标
- 只支持一次调用，不支持多轮对话或子 agent 编排
