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

## 4. 未验证项（如实记录）

- **Plugins 列表 GUI 截图待补**：非阻塞，图标已提供，待宿主渲染后补图
- **npm publish 与市场提交未执行**：由用户执行，本仓库不代为操作凭据

## 5. 复现命令

```bash
npm run gate                                  # 七段门禁一键验证
node --test plugin/test/*.test.mjs            # core / verify / gate-skill / commands 单测

# 手动在 DSH 会话里输入（把 <id> 换成 verify_contract 返回的 contractId）
/gate-status <id>
/gate-retry <id>
/gate-approve <id>
```

每次命令执行会在会话日志留下 `command/run` 与 `command/done` 事件，可作为放行/重试的机器证据。
