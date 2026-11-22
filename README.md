# DSH Agent Swarm Console

> **让 AI 团队干活看得见、信得过** —— 一个为 DeepSeek Harness 设计的多智能体可视化协作与交付验证插件。

> ✅ 已发布 `dsh-swarm-console@0.3.2` · 可安装 Host 插件 + 机器可验证的交付门禁
> 0.3 契约结构（破坏性）：`workspaceRoot` 必填、`testCmd` 白名单、`/gate-approve` 需证据 hash、工作区路径不得越界
> 已实测：npm 安装（含国内镜像延迟的绕行办法）与本地目录安装两条路径均可用；画布仍在开发中

[English](README.en.md) · 中文

---

## 为什么做这个

现在让多个 AI agent 并行干活已经不难了——DSH 自带 `subagent` 和 `workflow` 两个原语。但真用起来有两个绕不开的痛点：

- **看不见**：agent 在干什么、产物在谁手里、哪条线在传数据，整个过程是黑盒，只能等最后结果。
- **信不过**：agent 说"完成了"，可能只是日志刷屏，实际产出为零。没有客观证据就不敢放手。

Agent Swarm Console 把这两件事补上：**一个实时画布**让你看见整个团队，**一道交付门禁**让"完成"必须有证据。

---

## 它能做什么

- **多 agent 编排画布** —— 每个 agent 一个节点，分叉 / 并行 / 合并画成连线，状态、产物、日志实时可见
- **自然语言驱动** —— 主 agent 用一个命令就能招募团队、规划、执行、总结
- **交付门禁** —— 每个 agent 收尾必须附证据（改了哪些文件、跑了什么验证），没证据标 `unverified` 不放行
- **因材施教** —— 按能力标签（推理 / 视觉 / 长上下文 / 本地私有）给 agent 分任务
- **低版本友好** —— 运行时能力探测 + 降级，不锁死 DSH 版本

默认以 **DeepSeek** 作为主力推理模型，其他 provider 作为专项补充。

---

## 安装

**已验证**：从本地目录安装 bundle（`install_bundle` 返回 `application: applied`，插件以 link 方式装入 profile）。

```bash
# 在 DSH 会话里执行（plugin 为本仓库内的插件目录）
plugin_manager install_bundle <plugin 绝对路径>
```

**从 npm 包名安装（已实测）**：DSH「插件 → 添加插件」输入 `dsh-swarm-console`，源选 npm 官方源。DSH 0.2.2-rc.5 实测依赖解析为 `^0.3.2`，`verify_*` 与三条斜杠命令均可用。

> 两个实操坑：① `^0.2.x` 的 semver 上限不含 0.3.0，跨次版本升级必须显式写版本（`install_bundle dsh-swarm-console@0.3.2`）；
> ② 若 profile 走国内镜像（`registry.npmmirror.com`），新版本要等镜像同步（通常几分钟到半小时），
> 急用可从官方源下载 tarball 后用本地文件安装。

本地目录安装以 link 方式挂在当前 profile：**改代码需重启 DSH 或等 HMR 才生效**；卸载 link 插件会清空被链接目录，请只链接已提交/已备份的目录。配置 `externalAgents` 见 [plugin/docs/DETAIL.md](plugin/docs/DETAIL.md)。

---

## 状态

> ✅ **0.3.2 已发布** —— 契约按会话隔离、证据由插件真实执行（相对 `workspaceRoot`、不得越界）、`exec` 受 `testCmd` 白名单约束、放行需带证据 hash；画布仍开发中。

- [x] 竞品调研与架构设计
- [x] 设计文档定稿（v1.1）
- [x] P0 · 最小可跑原型
- [x] P1 · 国内 agent 适配层（`src/` 适配层 + `wiring/` 接线层）
- [ ] P2 · 交付门禁
- [ ] P3 · 开源 v0.1

---

## 路线图

| 阶段 | 内容 | 状态 |
|------|------|------|
| 阶段1 | 适配层（`src/`）：国内 agent 伪装成原生 run | ✅ |
| 阶段2 | 接线层（`wiring/`）：把适配层打进 dsh-agent-swarm | ✅ |
| 阶段3 | 插件化：bundle + 画布 | ⏳ |
| 阶段4 | 交付门禁：evidence 四态 + 三态 gate | ⏳ |

### 当前状态

插件骨架（`plugin/`）已能以 bundle 装进 DSH 并注册 `swarm_run`；完整形态（画布 + 门禁 UI）仍在开发中。核心两层代码按下面的方式验证：

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
