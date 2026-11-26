# 别人的门禁让 agent 自己变绿；这一道，要**你签字**

> DeepSeek Harness 插件：**契约由你确认，证据由插件执行，放行只有你能做。**

```
你    ：README 加个安装节，加完告诉我
agent ：好的，已完成 ✅
你打开 ：没加。
```

装了本插件：`verify_run` 之后 **GREEN 才叫完成**，RED 会给你一条能直接粘贴执行的复现命令。
但更关键的是这两步——**它们只能你做，模型没有对应工具**：

```
/gate-freeze <id> --yes          ← 先回显契约全文，你确认了才生效
/gate-approve <id> <证据hash>    ← 你拿着证据决定放不放行
```

## 为什么要强调"你签字"

已经有好几个插件在做"完成门禁"了（[#3233](https://github.com/deepseek-ai/deepseek-harness/discussions/3233)、[#3065](https://github.com/deepseek-ai/deepseek-harness/discussions/3065)、[#365](https://github.com/deepseek-ai/deepseek-harness/discussions/365)），思路各有高低。我在两件事上选了不同的路：

| | 常见做法 | 这里 |
| --- | --- | --- |
| 验收标准谁定 | agent 规划时自己 freeze | **你必须先看全文再 `--yes`**，改一个字就换 contractId |
| 失败之后 | 自动修复循环，直到变绿 | **不做自动修复**：RED 就停在那儿，修不修是人决定的 |
| 放行 | 达到条件自动通过 | **必须带证据 hash 由你放行**；重跑会把旧放行标 `stale` |
| 证据来源 | 有的靠工具调用记录 | 插件**真去查文件、真去跑命令**，模型自报的 `ok` 一律忽略 |

理由很直白：**如果 agent 能自己变绿，那"绿"衡量的是它的坚持，不是结果**；而通往绿的最短路径，永远是**把检查条件改松**。

![门禁 GREEN](https://raw.githubusercontent.com/whyissodifficult/dsh-agent-swarm-console/main/plugin/docs/images/gate-green.png)

## 三十秒装上

1. DSH → **插件 → 添加插件** → 输入 `dsh-swarm-console` → 源选 **npm 官方源**
2. 重启 DSH
3. 让 agent 调 `verify_contract`，你敲 `/gate-freeze <id> --yes`

## 一次真实回合（不是演示数据）

```
verify_contract  → contract bdea29a73b13 已冻结（待确认）
/gate-freeze bdea2            → 回显契约全文：目标 / 工作区 / 测试命令 / 每条验收条件
/gate-freeze bdea2 --yes      → 已确认 @ 2026-11-24T15:31:58Z
verify_run                    → 门禁 GREEN：全部 1 条验收条件均有通过证据
/gate-status bdea2            → 已确认；最近决定 GREEN；尚未放行   证据：3e5b3d76a9b2
/gate-approve bdea2 3e5b3d76a9b2 → 已由用户放行 @ 2026-11-24T15:32:45Z
```

每一步都落盘（`~/.dsh/swarm-console/state.json`），重启 DSH 也不丢：
谁确认的、什么决定、用哪份证据放行、什么时候放的。

## 它怎么防住"假完成"

| 环节 | 机制 |
| --- | --- |
| 契约 | 目标 / 工作区 / 验收条件 / 唯一允许的测试命令，内容哈希成 `contractId`；改一个字就换 id |
| 证据 | **插件自己执行**：`file.exists` 去查真实文件，`exec` 真跑那条命令 |
| 边界 | 检查路径必须是工作区内的相对路径；`../`、符号链接/junction 越界都判 RED |
| 判定 | `GREEN` 全部有证据且通过 / `YELLOW` 缺证据 / `RED` 检查失败（附可执行复现命令） |
| 确认与放行 | 只有用户的斜杠命令能做，且放行必须带与最近一次校验一致的证据 hash |

![门禁 RED 与复现命令](https://raw.githubusercontent.com/whyissodifficult/dsh-agent-swarm-console/main/plugin/docs/images/gate-red.png)

## 一个真事：这个门禁自己抓到过什么

`file.exists` 的越界判断曾经用 `rel.startsWith('..')`，于是工作区里**名字以 `..` 开头的合法文件**（如 `..foo`）会被误判成越界、判 RED。

- 别人报给我 → 我先复现（建 `..foo`，确认 RED）→ 改成 `rel === '..' || rel.startsWith('..' + sep)`（词法与 realpath 两处都改）
- 加回归测试 + **反证**（把修复改回去，测试必须变红）
- 0.6.1 发布，全过程见 [`docs/CASE-dotdot.md`](https://github.com/whyissodifficult/dsh-agent-swarm-console/blob/main/plugin/docs/CASE-dotdot.md)

这类"把合法情况判成失败"的方向性错误，**比漏判更危险**——它会让用户开始怀疑门禁本身。

## 谁适合用

- 让 agent 写代码、写文档，然后**不得不逐条核对**的人
- 用多个 agent 并行干活，想给每个交付物一个客观闸口的人（编排用 DSH 原生 `subagent` / `workflow`）
- 需要"谁在什么时候基于哪份证据签字的"留痕的人

**不适合**：想要可视化画布的人（本插件不做）；想让插件替你写代码的人（它只验收）。

## 已知限制（写在这里，省得你踩）

- **单实例**：状态文件假定一个 DSH 写入；两个窗口并发写会后写覆盖（文件不会损坏，但会丢条目）
- `exec` 以你的用户权限运行，等同你自己在终端敲——只把可信命令写进契约
- 最多保留 500 条记录；**已确认 / 已放行的记录不会被淘汰**
- 未实现：可视化画布、多阶段评审状态机（不承诺时间）

## 安装细节与坑

- 跨次版本升级必须显式写版本（如 `dsh-swarm-console@0.6.3`），`^0.6.x` 的 semver 上限不含下一个次版本
- 国内镜像（`registry.npmmirror.com`）同步慢几分钟到半小时；急用可从官方源下 tarball 用本地文件装
- 以 `link` 方式安装时，卸载会清空被链接目录——只链接已提交/已备份的目录
- 实测环境：桌面 DSH **0.2.2-rc.5**（Windows）、手机端 **0.2.1-rc.2**（Android / Termux）均可安装运行；未声明版本下限

## 现状与维护状态

- **作者自用为主**：这套东西先是为了解决自己的问题（agent 说完成但其实没做），不是商业项目。
- **欢迎反馈，但不承诺响应时间**：issue 我会看；能不能修、什么时候修，取决于它是否也影响我自己。
- **版本节奏**：功能攒着发次版本，修补发补丁；文档与 npm 页面同步更新。
- **不会做的事**：不做可视化画布；不做自动修复（让 agent 自己变绿）；不接入任何云端服务（证据只在本机）。
- **已知限制**：状态文件假定单实例写入；`exec` 以你的用户权限运行；最多保留 500 条记录（已确认/已放行的不淘汰）。

## 反馈

装了用一次，然后一句话就够：**你会拿它卡什么任务？哪一步最烦？**
👉 https://github.com/whyissodifficult/dsh-agent-swarm-console/issues

---

<sub>包名与仓库名沿用早期「swarm 编排」实验的历史；0.5.0 起专注交付门禁。MIT License.</sub>
