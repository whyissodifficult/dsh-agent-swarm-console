# Swarm Console（`dsh-swarm-console`）

> 让 agent 说「完成」之前，先过一道可机器验证的交付门禁。

[![npm](https://img.shields.io/npm/v/dsh-swarm-console.svg)](https://www.npmjs.com/package/dsh-swarm-console)
[![license](https://img.shields.io/npm/l/dsh-swarm-console.svg)](https://github.com/whyissodifficult/dsh-agent-swarm-console/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/dsh-swarm-console.svg)](https://nodejs.org/)

DeepSeek Harness（DSH）插件：把「任务契约 → 证据校验 → 三态门禁 → 用户放行」做成一条可核查的链路。

## 它解决什么

Agent 说「完成了」，可能只是日志刷屏、产出为零。这个插件让「完成」必须在证据上成立：

- **冻结契约**：目标 / 约束 / 验收条件写死并哈希成 `contractId`，改一个字就换 id；
- **证据先于验收**：每条验收条件必须绑定检查项，缺证据最多判 `YELLOW`；
- **三态判定**：`GREEN` / `YELLOW` / `RED`；**检查失败导致的 RED 一定带可复制执行的复现命令**（未确认契约 / 未知 id / 未知策略这类结构性 RED 给原因与下一步，不带命令）；
- **放行只归用户**：由斜杠命令触发，模型中不存在对应工具，无法代批。

## 安装

### 从 npm 安装（已验证）

在 DSH 的 **插件 → 添加插件** 里输入包名，安装源选 `npm 官方源`：

```text
dsh-swarm-console
```

也可以直接在会话里让 agent 装（它调用 `plugin_manager`，这不是你能在终端敲的命令）。

> **两个实操坑**
> 1. `^0.3.x` 的 semver 上限不含 0.4.0：跨次版本升级必须显式写版本（如 `dsh-swarm-console@0.4.4`）。
> 2. 若你的 DSH 走国内镜像（`registry.npmmirror.com`），新版本要等镜像同步（几分钟到半小时）；
>    急用可从官方源下载 tarball 后用本地文件安装。

> 实测环境：桌面端 DSH **0.2.2-rc.5**（Windows）、手机端 DSH **0.2.1-rc.2**（Android / Termux）——两处都能装、`verify_*` 与四条斜杠命令均可用
> （profile 依赖解析为 `^0.4.x`）。未声明 DSH 版本下限，跨版本兼容性以这两处实测为准。

### 从本地目录安装（已验证）

```text
plugin_manager install_bundle <本包目录的绝对路径>
```

> 注意：以 `link` 方式安装时，卸载该插件会清空被链接目录的内容——请只链接已提交（或已备份）的目录。


## 快速开始

```text
verify_contract   冻结契约（objective / workspaceRoot / criteria / constraints，testCmd 可选）
verify_run        跑证据校验：checks 是「检查请求」，由插件实际执行
/gate-freeze      先看契约全文，再加 --yes 确认：/gate-freeze <id|前缀> [--yes]
/gate-status      不带参数列出本会话所有契约；带参数看单条（支持 id 前缀，如 7e28）
/gate-approve     放行：/gate-approve <id|前缀> <证据hash>（仅 GREEN + hash 一致时允许）
/gate-retry       清空证据并重算（不重跑检查）；旧放行标 stale
```

示例：

```text
> verify_contract {"objective":"给 README 加安装节","workspaceRoot":"/path/to/your/project",
                   "criteria":[{"id":"c1","text":"安装节存在","checkIds":["k1"]}]}
contract 7e280e5c4f7e 已冻结（待确认）
等待用户确认：/gate-freeze 7e280e5c4f7e       ← 契约不经用户确认不能跑

> /gate-freeze 7e28
契约 7e280e5c4f7e：
  目标：给 README 加安装节
  工作区：/path/to/your/project
  验收条件（1）：
    - c1：安装节存在（检查：k1）

确认无误后执行：/gate-freeze 7e280e5c4f7e --yes

> /gate-freeze 7e28 --yes
契约 7e280e5c4f7e 已由用户确认（frozen）@ …，现在可以执行 verify_run

> verify_run {"contractId":"7e280e5c4f7e","checks":[{"id":"k1","type":"file.exists","path":"README.md"}]}
门禁 GREEN：全部 1 条验收条件均有通过证据

> /gate-status 7e28
契约 7e280e5c4f7e：最近决定 GREEN @ …；尚未放行
证据：<evidenceHash>（每次 verify_run 都会变）

> /gate-approve 7e28 <evidenceHash>
契约 7e280e5c4f7e 已由用户放行（approved）
```

## 能力与限制

已实现：

- 契约冻结与内容哈希（`contract.id`）
- 证据由插件执行：`verify_run` 的 `checks` 是**检查请求**而非结论——`file.exists` 由插件 `existsSync` 判定，`exec` 由插件实际执行；模型自报的 `ok` 一律忽略
- 证据分级与三态门禁（`GREEN` / `YELLOW` / `RED`）；空契约直接 `RED`
- 检查失败 → `RED` 且带可执行复现命令；缺证据不判通过
- 契约须用户确认：`/gate-freeze <id>` 之后才能跑 `verify_run`（模型没有对应工具，改不了规矩）
- 用户专属放行：`/gate-approve` `/gate-retry` `/gate-status`；重跑后旧放行标记 `stale`
- 外部 agent 适配层（OpenAI 兼容端点，作为原生 subagent run 使用）

⚠️ 两条必须知道的行为：

- **`exec` 检查以当前用户权限执行命令**，等同于你自己在终端敲那条命令。请只把可信命令写进契约，不要接受来源不明的检查请求。
- **Android / Termux**：`exec` 显式探测可用 shell（不再依赖 `shell: true` 的硬编码路径）；
  环境确实没有 shell 时判 **YELLOW** 并说明「环境不可用」，不会误报成测试失败
- **异步执行**：检查用 `spawn` 异步跑；单条超时由契约的 `testTimeoutMs` 决定（默认 60 秒，范围 1–600 秒），超时被强制终止并按失败计入证据；执行期间不阻塞宿主。

尚未实现（不承诺）：

- 可视化画布
- 多阶段评审状态机
- 动作卡片：代码保留为可选增强，需目标 profile 挂载 `action-cards` 服务
- 证据持久化：v1 存在进程内，DSH 重启即丢

## 开发与门禁

```bash
npm run gate        # probe / selftest / plugin:test / smoke / pack / wiring / dryrun / encoding 八段
```

验收记录见 [`docs/V1-ACCEPTANCE.md`](https://github.com/whyissodifficult/dsh-agent-swarm-console/blob/main/plugin/docs/V1-ACCEPTANCE.md)：包含斜杠命令链路的日志证据（`command/run`、`command/done`）与三条硬规则的反证。

## 链接

- 仓库：https://github.com/whyissodifficult/dsh-agent-swarm-console
- 插件详情：见 [`docs/DETAIL.md`](https://github.com/whyissodifficult/dsh-agent-swarm-console/blob/main/plugin/docs/DETAIL.md)
- 验收记录：[`docs/V1-ACCEPTANCE.md`](https://github.com/whyissodifficult/dsh-agent-swarm-console/blob/main/plugin/docs/V1-ACCEPTANCE.md)

## 许可

[MIT](https://github.com/whyissodifficult/dsh-agent-swarm-console/blob/main/LICENSE)
