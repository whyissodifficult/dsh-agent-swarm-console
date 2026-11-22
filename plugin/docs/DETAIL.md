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

## verify 三工具（0.3.0 契约结构）

- `verify_contract({objective, workspaceRoot, testCmd?, policyId?, constraints, criteria})` → `{contractId}`，**初始为待确认**（需 `/gate-freeze`）
  - **`workspaceRoot` 必填**：绝对路径、必须存在且是目录；所有检查以它为根
  - `testCmd` 可选：`exec` 检查**唯一允许**的命令；不声明就拒绝一切 `exec`
  - `policyId` 可选：只有显式声明，且策略的检查 id 全部被契约 `checkIds` 覆盖时才启用
- `verify_run({contractId, checks})` → `{decision, reasons, evidenceHash, reproCmd?, missing?, warnings?}`
  - `file.exists` 的 `path` 必须是**相对 workspaceRoot 的相对路径**（绝对路径直接判 RED）
  - `exec` 的 `cmd` 必须与 `testCmd` 完全相等；执行时 `cwd` 固定为 `workspaceRoot`
  - 非法检查请求不抛异常，返回 `ok:false` 并判 RED
- `verify_status({contractId})` → `{known:true, decision, at, evidenceHash, approved?, stale?, ...}`；未知 `{known:false}`

三态规则：缺证据 YELLOW；任一 check 失败 RED（必带可复制执行的 `reproCmd`）；全部有证据且通过 GREEN。

**策略层（`code-change`）当前只生成 `testCmd` 检查**。`exists` / `workspace.diff` 已从策略声明中删除——需要文件检查时由调用方在 `checks` 里显式给出。

**契约确认（0.4.0）**：`verify_contract` 冻结后是「待确认」状态，`verify_run` 会直接判 RED 并提示先 `/gate-freeze <id>`。确认只能由用户通过斜杠命令完成——模型没有对应工具，这是把「定规矩」的权力从模型手里收回来的结构保证。

**放行入口**：斜杠命令 `/gate-freeze <id|前缀>`、`/gate-approve <id|前缀> <evidenceHash>`、`/gate-retry <id|前缀>`、`/gate-status [id|前缀]`（不带参数列出**本会话**全部契约）。放行只能由用户触发——斜杠命令由用户在交互界面直接输入，图中没有对应的模型工具，模型无法代替用户调用，H3（放行只能由用户触发）由这个结构保证，不依赖运行时身份判断。非 GREEN 时 `/gate-approve` 直接拒绝并提示先 retry。门禁卡（action-cards）为可选增强，仅在挂载该服务的 profile 生效。

每次命令执行会在会话日志留下 `command/run` 与 `command/done` 事件，可作为放行/重试的机器证据。

**`gate-retry` 语义**：用空证据重算，结果必为 YELLOW（提示补证据）；旧放行会被置 `approved=false`、`stale=true`，并保留 `lastApprovedAt` / `lastApprovedHash`，`/gate-status` 显示 `[stale] 上次放行已失效（时间）`。要转 GREEN 需重新执行 `verify_run` 并提供真实证据。

**会话隔离**：契约与运行状态都按 `${sessionId}:${contractId}` 存放；`/gate-status` 不带参数只列**本会话**契约，id 前缀解析也只在本会话内匹配（前缀最短 4 位）。

## 命令速查

- `/gate-freeze <id|前缀>`：由用户确认契约；确认后才能 `verify_run`
- `/gate-status`：不带参数列出本会话所有契约（含待确认/已确认）；带参数（或 id 前缀）查看单条
- `/gate-approve <id|前缀> <evidenceHash>`：**必须**带证据 hash 自证；缺参数会提示先 `/gate-status` 复制；非 GREEN 或 hash 不一致均拒绝
- `/gate-retry <id|前缀>`：重跑校验并把旧放行标为 `stale`

## 已知限制

- **`exec` 检查以当前用户权限执行命令**：等同于你在终端敲那条命令。只把可信命令写进契约；不要接受来源不明的检查请求。
- **exec 检查异步执行**（0.4.0）：`spawn` + 10 秒超时后强制终止，不再阻塞宿主事件循环；超时按失败计入证据。
- 证据存**进程内 Map**，DSH 重启即丢，不做持久化（重启后 `/gate-status` 返回「未知契约」）
- 还没有画布 —— 看不到 agent 节点、连线或过程可视化
- 多阶段评审状态机未实现
- `swarm_run` 的 `RESULT:` 解析只取**第一行**（`RESULT: ok` 后面的说明不会进结果）
- 动作卡片：代码保留为可选增强，需目标 profile 挂载 `action-cards` 服务；v1 的放行入口是斜杠命令
- `swarm_run` 只支持一次调用，不支持多轮对话或子 agent 编排

