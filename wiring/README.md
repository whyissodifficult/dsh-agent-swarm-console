# 接线层：把适配层打进 dsh-agent-swarm

这个目录补的是**阶段2 断层**：核心适配层（`src/`）已经过评审，但 DSH 插件真正的 `spawn` 在 `dsh-agent-swarm` 里。这里提供可复现的接线，让开源仓库 clone 下来就能把国内 agent 接进 swarm 的画布。

## 文件

| 文件 | 作用 |
|------|------|
| `swarm-index.patch` | 对上游 `dd67b64` 的 `lib/index.js` 打的补丁：`externalAgents` 配置字段、`pickExternalProfile()`、`spawnExternal()`、`spawn()` 分流 |
| `external-agent-adapter.js` | **过评审的新版**适配器（含 R1–R5 修复）。注意 E 盘旧克隆里那份是旧版，别用 |
| `integration-test.mjs` | 离线集成测试（mock fetch，不打真 API）：路由规则 + run 契约 + 事件流 + 产物落 roster |
| `install.mjs` | 一键安装：校验目标 → 备份 → 打补丁 → 装新版适配器 → 放测试。幂等 |

## 用法

```bash
# 1. 装到一个 dsh-agent-swarm 副本（不要对你正在用的那份直接跑，先复制一份试）
node wiring/install.mjs /path/to/dsh-agent-swarm

# 2. 验证（在插件目录里）
cd /path/to/dsh-agent-swarm && node lib/integration-test.mjs

# 3. 本仓库内也能单独测接线逻辑，不打 API
npm run wiring:test
```

安装脚本会：
- 检查目标是 `dsh-agent-swarm`（有 `lib/index.js` 且含 `agent-swarm`）
- 把原 `index.js` 和旧适配器备份到 `<target>/.wiring-backup/<时间戳>/`
- 已接过线则跳过补丁（幂等）
- 检测到新版适配器（含 `PROGRESS_FULL_CHARS` + `randomUUID`）则跳过覆盖

## 配置

补丁只加代码，不改配置。在 `cordis.patch.yml` 里加 `externalAgents`（令牌只写环境变量名，绝不写值）：

```yaml
- insert:
    - id: agent-swarm
      name: dsh-agent-swarm
      config:
        providers: []
        model: null
        reasoningEffort: null
        capabilityRouting: true
        externalAgents:
          deepseek:
            role: reasoning
            baseUrl: https://api.deepseek.com/v1
            apiKeyEnv: DEEPSEEK_API_KEY
            models: [deepseek-v4-pro, deepseek-flash]
            capabilities: [reasoning, chinese, code, summary]
          ollama:
            role: local
            baseUrl: http://127.0.0.1:11434/v1
            apiKeyEnv: OLLAMA_API_KEY
            models: [qwen2.5-coder:7b]
            capabilities: [local, private, free, code]
```

路由优先级（`pickExternalProfile`）：`spec.agent` 显式指定 → `spec.role` 匹配 → 开了 `capabilityRouting` 时 `spec.capabilities` 全匹配 → 只有一个 agent 时用它 → 否则走原生 `ctx.subagents`（低版本 DSH 也能降级）。

## 契约

`spawnExternal` 产出的 run 与原生 `ctx.subagents.start()` 形状一致：

```js
{ id, result: Promise<{stopReason, output}>, dispose() }
```

所以下游的 `runsFor` / `childToRoster` / 事件流 / 产物归因全部不用改。这是阶段2"接进 swarm"的关键——不是重写插件，是在 spawn 处分流。

## 注意

- 补丁基于上游 `dd67b64`。目标若已手工改过 `lib/index.js`，`git apply` 会失败并保留原文件（不会半途写入）。
- 接线只用 `externalAgents` 里声明的环境变量名取令牌；配置里不存令牌。
- 低版本 DSH：没有 `ctx.subagents` 时原生分支仍会报 `subagent service unavailable`；配了 `externalAgents` 就绕开它，所以这种情况下必须配至少一个外部 agent。
