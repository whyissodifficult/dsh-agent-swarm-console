# 接线层：把适配层打进 dsh-agent-swarm

这个目录补的是**阶段2 断层**：核心适配层（`src/`）已经过评审，但 DSH 插件真正的 `spawn` 在 `dsh-agent-swarm` 里。这里提供可复现的接线，让开源仓库 clone 下来就能把国内 agent 接进 swarm 的画布。

## 文件

| 文件 | 作用 |
|------|------|
| `swarm-index.patch` | 对上游 `dd67b64` 的 `lib/index.js` 打的补丁：`externalAgents` 配置字段、`pickExternalProfile()`、`spawnExternal()`、`spawn()` 分流 |
| `external-agent-adapter.js` | **过评审的新版**适配器（含 R1–R5 修复）。注意 E 盘旧克隆里那份是旧版，别用 |
| `integration-test.mjs` | 离线集成测试（mock fetch，不打真 API）：路由规则 + run 契约 + 事件流 + 产物落 roster |
| `install.mjs` | 一键安装：校验目标 → 备份 → 打补丁 → 装新版适配器 → 放测试。幂等 |
| `sandbox-spawn.mjs` | 沙箱安全的子进程调用：pipe EPERM → fd 重定向 → inherit，区分 EPERM/ENOENT |
| `sandbox-spawn.test.mjs` | 降级路径单测（注入 mock spawn + 强制开关端到端，21 项），进 `npm run wiring:test` |
| `f2-counterproof.mjs` | F2 反证：造"能 apply 但语法坏"的补丁，证明 node --check 会变红 |
| `verify-upstream.mjs` | 上游校验：不可达 / commit 不符 / 可应用，三诊断分开 |
| `fixtures/index.baseline.js` | `dd67b64` 的 `lib/index.js` 独立基线，供补丁 dry-run 反证 |

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

## 获取上游（必读）

补丁基于 `dd67b64bdfb1e04ac4dcbf201d0af20d9879f847`（树哈希 `a767b6aa3b192b9684941a7760ce3a1576afda85`）。先拿到这个 commit 的副本，再装补丁：

```bash
# 公开上游（实测存在，HEAD 就是 dd67b64）
git clone https://github.com/xieshuaix/dsh-agent-swarm.git /tmp/swarm-upstream

# 国内直连 github.com 常被重置，可用镜像
git clone https://ghproxy.net/https://github.com/xieshuaix/dsh-agent-swarm.git /tmp/swarm-upstream

# 装之前先验：不可达 / commit 不符 / 可应用
node wiring/verify-upstream.mjs /tmp/swarm-upstream
# 也可传 URL 只验可达性与 commit：
node wiring/verify-upstream.mjs https://github.com/xieshuaix/dsh-agent-swarm.git
```

`verify-upstream.mjs` 三种诊断分开报，退出码区分：A 不可达=1、B commit 不符=2、C 不可应用=3、可应用=0。它不会碰你的原文件，只在临时副本上 `git apply --check`。

若上游转私有或拿不到该 commit：**需自备含 `dd67b64` 的上游副本**，并用 `verify-upstream.mjs` 校验通过后再装；不要把"clone 即可装"当成前提。本仓库自带 `wiring/fixtures/index.baseline.js`（该 commit 的 `lib/index.js`），可在无上游时单独跑补丁 dry-run：

```bash
npm run wiring:test   # 其中第④组就是 git apply --check 的真实验证
```

## 已知限制

- **R-c（评审记档，本轮不改）**：`spawnExternal` 上层有 30 分钟 `AbortSignal.timeout`，适配器内部有 120 秒 fetch 超时（可由 `SWARM_TIMEOUT_MS` 覆盖）；两层超时叠加且上层写死。需要长任务时上层会先掐断。下轮考虑只留一层或让上层也读 `SWARM_TIMEOUT_MS`。
- **R-b（评审记档，本轮不改）**：`settleAgent` 用 spawn 时捕获的对象，persist 用 `load()` 出的新对象；若两者不是同一引用，settle 结果可能丢。代码里已加 `// TODO(review)`，正解是统一"load → 改 → persist"。
- **沙箱管道（已修）**：DSH 沙箱内 `spawnSync` 用 pipe 会 EPERM。统一走 `sandbox-spawn.mjs`：pipe → fd 重定向 → inherit 三级降级，错误区分 EPERM（沙箱）与 ENOENT（真没装 git），不再误报"未找到 git"。想端到端验证 fd 分支（宿主终端）：`WIRING_FORCE_SPAWN_EPERM=1 npm run wiring:test`，强制首跳构造 EPERM，真进程真文件走 fd 并捕获 git version。
- **补丁语法门禁**：`patch-dryrun.mjs` 在 apply 后对打完补丁的 `lib/index.js` 跑 `node --check`，堵"补丁能打上但语法坏"；`f2-counterproof.mjs` 用能 apply 的坏语法补丁做反证。

