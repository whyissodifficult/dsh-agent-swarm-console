# 别人的门禁让 agent 自己变绿；这一道，要**你签字**

> **契约由你确认，证据由插件执行，放行只有你能做。**
> DeepSeek Harness 插件：让 agent 的「完成了」变成可机器验证的东西。

```
你    ：README 加个安装节，加完告诉我
agent ：好的，已完成 ✅
你打开 ：没加。
```

`/gate-freeze <id> --yes` 确认契约（先回显全文），`/gate-approve <id> <证据hash>` 放行——**这两步模型没有工具，做不了**。

- npm：`dsh-swarm-console@0.6.3` · 实测：DSH 0.2.2-rc.5（Windows）/ 0.2.1-rc.2（Android）
- 包页与完整说明：[plugin/README.md](plugin/README.md)
- 一个真案例：[plugin/docs/CASE-dotdot.md](plugin/docs/CASE-dotdot.md)

## 为什么做这个

让 agent 干活不难，难在**验收**。它说"完成了"，可能只是日志刷屏、可能是改了一半、也可能顺手把不该动的东西动了。你只能一条条核，比自己做还累。

多 agent 编排与可视化已经有人做了；真正缺的是**"完成"能不能被机器验证**这一层。所以这个插件只做一件事：

> 把"完成"的定义写成契约，证据由插件去执行，判定交给规则，放行留给你。

---

## 它能做什么

- **交付门禁** —— 每条验收条件必须绑定检查项：缺证据判 `YELLOW`、检查失败判 `RED`、未确认/未放行都不算完成
- **确认前先看清** —— `/gate-freeze <id>` 先回显契约全文（目标/工作区/测试命令/超时/验收条件），`--yes` 才生效；模型没有对应工具，改不了规矩
- **低版本友好** —— 桌面 0.2.2-rc.5 与手机 0.2.1-rc.2 实测可用

插件不绑定任何模型供应商：它只检查证据，不参与推理。

---

## 安装

**已验证**：从本地目录安装 bundle（`install_bundle` 返回 `application: applied`，插件以 link 方式装入 profile）。

> `plugin_manager` 是**模型侧工具**，不是 shell 命令：在 DSH 会话里让 agent 执行
> `plugin_manager install_bundle <plugin 绝对路径>`，或在「插件 → 添加插件」里选本地目录。

**从 npm 包名安装（已实测）**：DSH「插件 → 添加插件」输入 `dsh-swarm-console`，源选 npm 官方源。DSH 0.2.2-rc.5 实测依赖解析为 `^0.4.x`，`verify_*` 与斜杠命令（`/gate-freeze`、`/gate-approve`、`/gate-retry`、`/gate-status`）均可用。

> 两个实操坑：① `^0.3.x` 的 semver 上限不含 0.4.0，跨次版本升级必须显式写版本（让 agent 执行 `plugin_manager install_bundle dsh-swarm-console@0.4.4`）；
> ② 若 profile 走国内镜像（`registry.npmmirror.com`），新版本要等镜像同步（通常几分钟到半小时），
> 急用可从官方源下载 tarball 后用本地文件安装。

本地目录安装以 link 方式挂在当前 profile：**改代码需重启 DSH 或等 HMR 才生效**；卸载 link 插件会清空被链接目录，请只链接已提交/已备份的目录。配置 `externalAgents` 见 [plugin/docs/DETAIL.md](plugin/docs/DETAIL.md)。

---

## 状态

> ✅ **0.5.0 已发布** —— 契约按会话隔离、证据由插件真实执行（相对 `workspaceRoot`、符号链接也挡）、`exec` 受 `testCmd` 白名单约束、确认与放行都需用户操作。

- [x] 竞品调研与架构设计
- [x] 设计文档定稿（v1.1）
- [x] P0 · 最小可跑原型
- [x] P1 · 国内 agent 适配层（`src/` 适配层 + `wiring/` 接线层）
- [x] P2 · 交付门禁（0.1.0 起，0.4.x 已发布）
- [x] P3 · 开源与发布（npm `dsh-swarm-console`）

---

## 路线图

| 阶段 | 内容 | 状态 |
|------|------|------|
| 阶段1 | 适配层（`src/`）：国内 agent 伪装成原生 run | ✅ |
| 阶段2 | 接线层（`wiring/`）：把适配层打进 dsh-agent-swarm | ✅ |
| 阶段3 | 插件化：bundle | ✅ |
| 阶段4 | 交付门禁：三态 gate + 用户确认/放行 | ✅ |

### 当前状态

`plugin/` 已作为 bundle 装进 DSH 并注册 `verify_*` 三个工具与四条斜杠命令，门禁已发布至 npm。核心逻辑按下面的方式验证：

```bash
npm test                                  # 适配层自测（32 项）
npm run probe                             # 回归探针（10 项）
node wiring/install.mjs <上游 dsh-agent-swarm 目录>   # 把适配层接进 swarm
```

`wiring/` 是**过渡形态**：它用补丁把适配层接进现有的 dsh-agent-swarm，插件化完成后会被正式 bundle 取代。接线细节与上游获取见 [wiring/README.md](wiring/README.md)。

---

## 设计原则

1. **站在已有的上面** —— 复刻 DSH 原生能力之上的可观察层，不重复造轮子
2. **看得见优于看不见** —— 过程可视化不是装饰，是可信的前提
3. **完成要有证据** —— agent 的自述不算数，运行时证据才算
4. **通用框架，配置驱动** —— 新 agent 加一行配置就能接，不写死清单

---

## 上架清单

- [x] icon.svg **已具备**：已放入 `plugin/` 包根，`exports` 有 `"./icon": "./icon.svg"`，`files` 含 `"icon.svg"`，插件页已渲染

> 包名说明：npm 包名是 `dsh-swarm-console`，仓库名沿用 `dsh-agent-swarm-console`（两者不必一致）。

---

## 设计参考

门禁契约的设计参考：ai-council（同学项目，未开源）。本仓库的实现为独立重写，未包含其代码。

---

## 许可证

[MIT](LICENSE)

---

## 作者

郑志阳（Walk in the white）· 2026

一个相信「让 AI 团队干活，也能像带真实团队一样看得见、管得住」的大一学生。
