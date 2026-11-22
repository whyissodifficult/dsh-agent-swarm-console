# Swarm Console（`dsh-swarm-console`）

> 让 agent 说「完成」之前，先过一道可机器验证的交付门禁。

[![npm](https://img.shields.io/npm/v/dsh-swarm-console.svg)](https://www.npmjs.com/package/dsh-swarm-console)
[![license](https://img.shields.io/npm/l/dsh-swarm-console.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/dsh-swarm-console.svg)](https://nodejs.org/)

DeepSeek Harness（DSH）插件：把「任务契约 → 证据校验 → 三态门禁 → 用户放行」做成一条可核查的链路。

## 它解决什么

Agent 说「完成了」，可能只是日志刷屏、产出为零。这个插件让「完成」必须在证据上成立：

- **冻结契约**：目标 / 约束 / 验收条件写死并哈希成 `contractId`，改一个字就换 id；
- **证据先于验收**：每条验收条件必须绑定检查项，缺证据最多判 `YELLOW`；
- **三态判定**：`GREEN` / `YELLOW` / `RED`，`RED` 一定带可复制执行的复现命令；
- **放行只归用户**：由斜杠命令触发，模型中不存在对应工具，无法代批。

## 安装

DSH 中安装（本地目录，已验证）：

```text
plugin_manager install_bundle <本包目录的绝对路径>
```

或在 DSH 的 **Plugins → Add plugin** 里选择本地目录。

> 通过 npm 包名直接安装的路径**尚未验证**，暂不承诺可用。

## 快速开始

```text
verify_contract   冻结一个契约（objective / constraints / criteria）
verify_run        跑证据校验，得到 GREEN / YELLOW / RED
/gate-status      查看某个契约最近一次判定
/gate-approve     放行（仅 GREEN 允许，用户手动输入）
/gate-retry       重算并刷新判定
```

示例：

```text
> verify_contract {"objective":"给 README 加安装节","criteria":[{"id":"c1","text":"安装节存在","checkIds":["k1"]}]}
contract 5bc483324d46 已冻结

> verify_run {"contractId":"5bc483324d46","checks":[{"id":"k1","type":"file.exists","ok":true}]}
门禁 GREEN：全部 1 条验收条件均有通过证据

> /gate-approve 5bc483324d46
契约 5bc483324d46 已由用户放行（approved）
```

## 能力与限制

已实现：

- 契约冻结与内容哈希（`contract.id`）
- 证据分级与三态门禁（`GREEN` / `YELLOW` / `RED`）
- `RED` 必带可执行复现命令；缺证据不判通过
- 用户专属放行：`/gate-approve` `/gate-retry` `/gate-status`
- 外部 agent 适配层（OpenAI 兼容端点，作为原生 subagent run 使用）

尚未实现（不承诺）：

- 可视化画布
- 多阶段评审状态机
- 动作卡片：代码保留为可选增强，需目标 profile 挂载 `action-cards` 服务
- 证据持久化：v1 存在进程内，DSH 重启即丢

## 开发与门禁

```bash
npm run gate        # probe / selftest / plugin:test / smoke / pack / wiring / dryrun 七段
```

验收记录见 [`docs/V1-ACCEPTANCE.md`](./docs/V1-ACCEPTANCE.md)：包含斜杠命令链路的日志证据（`command/run`、`command/done`）与三条硬规则的反证。

## 链接

- 仓库：https://github.com/whyissodifficult/dsh-agent-swarm-console
- 插件详情：见 [`docs/DETAIL.md`](./docs/DETAIL.md)
- 验收记录：[`docs/V1-ACCEPTANCE.md`](./docs/V1-ACCEPTANCE.md)

## 许可

[MIT](./LICENSE)
