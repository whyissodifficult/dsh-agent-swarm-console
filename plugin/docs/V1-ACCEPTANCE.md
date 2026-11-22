# v1 验收记录

## 1. 验收范围

- 版本：0.1.0，基准提交 `58dc124`
- 覆盖：阶段 3A（可安装 Host 插件骨架）、阶段 4（verify v1 三态门禁）、阶段 5（发布配置）
- 本文事实以 `58dc124` 为准；放行入口为斜杠命令，门禁卡为可选增强（当前 profile 未挂载 action-cards）

## 2. 机器证据（会话日志 session.v4.jsonl.zstd，3186 事件）

评审侧逐帧解出的五条 command 事件：

| seq | 事件对 | 命令 | 结果 |
|---|---|---|---|
| 3150 / 3151 | command/run → command/done | `gate-status` | success：GREEN，尚未放行 |
| 3152 / 3153 | command/run → command/done | `gate-approve` | success：已由用户放行（approved） |
| 3154 / 3155 | command/run → command/done | `gate-status` | success：已由 user 放行 @ 时间戳 |
| 3156 / 3157 | command/run → command/done | `gate-approve` | error：非 GREEN 不可放行，请先 /gate-retry |
| 3158 / 3159 | command/run → command/done | `gate-retry` | success：重算 YELLOW，需补证据 |

**全日志模型侧 gate 类工具调用 0 次** —— H3（放行只能由用户触发）由结构保证：斜杠命令由用户在交互界面输入，模型中不存在对应工具。

## 3. 三条硬规则与反证

| 规则 | 内容 | 反证（已实测） |
|---|---|---|
| H1 | 证据先于验收：没有 evidence 的 criterion 不算通过 | 某 criterion 的 `checkIds` 为空 → 判定必为 YELLOW，不判 GREEN |
| H2 | RED 必须给可执行的最小复现命令 | 失败 check 未提供 `cmd` → `makeEvidence` 抛错；gate 兜底给 `echo "check X 未提供 cmd" && exit 1`，经 `sh -c` 执行退出非 0 |
| H3 | 放行只能由用户触发 | agent 身份调 `act(approve)` → refused 并留拒绝事件；实机全日志模型侧 gate 工具调用 0 次 |

## 4. 发布与安装验证（2026-11-22 补充）

> 后续演进：0.2.0 起 checks 改为「检查请求」由插件执行；0.3.0 契约加 `workspaceRoot`/`testCmd` 并做会话隔离；
> 0.3.2 修掉 `../` 越界（工作区外文件可被断言为存在）。当前最新版 `0.3.2`。

- **npm**：`dsh-swarm-console@0.1.5` 已发布，`latest` 指向 0.1.5；tarball 逐文件核对通过（16 文件，含 README / LICENSE / icon.svg / docs）
- **npm 直装已验证**：在 DSH 0.2.2-rc.5 的「插件 → 添加插件」输入包名安装成功，profile 依赖解析为 `^0.1.5`，
  安装后 `verify_contract` / `verify_run` / `verify_status` 与三条斜杠命令均可用
- **Plugins 列表截图**：已由用户补（图标、名称、版本、启用开关齐全）
- **市场/意向表**：已提交（用户侧）

仍待补：
- 真实第三方用户的使用记录（加分项，非阻塞）

## 5. 复现命令

```bash
npm run gate                                  # 八段门禁一键验证（含 encoding）
node --test plugin/test/*.test.mjs            # core / verify / gate-skill / commands 单测

# 手动在 DSH 会话里输入（把 <id> 换成 verify_contract 返回的 contractId）
/gate-status <id>
/gate-retry <id>
/gate-approve <id>
```

每次命令执行会在会话日志留下 `command/run` 与 `command/done` 事件，可作为放行/重试的机器证据。
