# 更新日志

## 0.2.2 · 门禁状态可发现：无参列表 + id 前缀

- `/gate-status` 不带参数时列出本会话所有契约（判定、时间、是否放行、是否 stale），解决「id 丢了找不回来」
- 三条命令都接受 **id 前缀**（如 `1578`），唯一命中即生效；歧义时报错并列出候选
- 契约 id 仍是内容哈希前 12 位，语义不变；前缀只是解析层便利
- 测试：无参列表 / 前缀唯一命中 / 前缀歧义 / 前缀放行 四条


## 0.2.1 · 复现命令按检查类型生成

- `file.exists` 失败时，复现命令由 `echo "check X 未提供 cmd" && exit 1` 改为 `test -f '<path>'`：
  文件缺失时该命令退出 1，正好复现失败；不再是文不对题的兜底提示
- `evidence.js` 在规范化时保留 `path` 字段（此前被丢弃，导致 gate 无法构造针对性命令）
- 无可用路径/命令时仍给出可执行兜底：`echo "check X 无可执行复现命令…" && exit 1`
- 测试：新增 file.exists 复现命令用例；更新一条旧断言（原来只认「未提供 cmd」文案）


## 0.2.0 · 证据真实化 + 状态正确性（破坏性变更）

**破坏性变更：checks 语义变了。** 0.1.x 的 checks 是模型**自报的结论**（`ok` 由模型填写，插件照单全收）；0.2.0 起 checks 是**检查请求**，由插件真实执行后判定——`file.exists` 查文件、`exec` 真跑命令，模型传的 `ok` 一律忽略并记 warning。旧调用方若仍传 `ok` 当结论，行为会变，必须按新语义重接。

- P0-1 空 criteria 不再判 GREEN，直接 RED（「契约没有任何验收条件，不可判通过」）
- P0-2 新增 `lib/core/checks.js`：可注入执行器的检查请求引擎；evidence 增 `warnings[]`
- P0-3 接 policy runner：未给 checks 时按 `code-change` 策略生成检查请求；策略进发布包
- P0-4 运行状态键改 `sessionId:contractId`；approve 校验 evidenceHash（过期拒绝）；retry 保留 approved 标记 stale，`/gate-status` 显示 `[stale]`
- P1 六项：测试健壮性（git/sh 不可用显式 skip）、编码词表扩充与全仓扫描、adapter 取最后 json 块并去掉内嵌示例、wiring 适配层消重为 re-export、文档与八段门禁对齐
- 门禁升为八段：`npm run gate` 含 encoding（严格 UTF-8 + GBK 误读词表）

## 0.1.5 · 元数据乱码修复落地（0.1.4 已占用）

- 0.1.4 在本地修复前就已发布，元数据仍是乱码版（npm 不允许覆盖已发布版本），故以 0.1.5 发布修正
- 修正 `plugin/package.json` 的 description / author 与 CHANGELOG 早期条目（从历史提交取回原文）
- 新增编码门禁 `tools/check-encoding.mjs`，并入 `npm run gate`：严格 UTF-8 + GBK 误读词表扫描

## 0.1.4 · 安装说明与验收记录对齐实测

- README 安装节：npm 直装路径由「待验证」改为「已验证」（实测 profile 依赖解析为 ^0.1.3，工具与命令可用）
- README 增加 link 安装的风险提示：卸载 link 安装会清空被链接目录的内容（本轮已实际踩到并由 git 恢复）
- V1-ACCEPTANCE 第 4 节更新为「发布与安装验证」，记录 npm 0.1.3 上线与直装验证结果
- **修复历史乱码**：`plugin/package.json` 的 description/author 与 CHANGELOG 早期条目此前被 GBK 误读写成乱码，
  本次从历史提交取回原文重写（JSON 合法不等于内容正确，这类问题只有严格解码才能发现）

## 0.1.3 · 让门禁结论自己带复现命令

- `/gate-status` 与 `verify_status`：RED 追加「复现：<cmd>」，YELLOW 追加「缺失证据：<...>」
- 为什么：H2 要求 RED 必须有可执行复现命令，但此前只有模型侧 `verify_run` 输出里有，
  用户敲 `/gate-status` 看不到；现在命令与工具输出一致
- verify_run 把 reproCmd/missing 落进运行记录，status 直接读回

## 0.1.2 · 插件页文案纠偏

- locale 描述此前写「画布与交付门禁开发中」；门禁已交付，改为「用可机器验证的门禁确认交付；画布开发中」
- README 内相对链接改为 GitHub 绝对链接（npm 页上相对链接点不开）

## 0.1.1 · npm 包页补 README 与许可

- 新增 `plugin/README.md`：npm 包页不再显示「This package does not have a README」
- 包内补 `LICENSE`（此前只有仓库根有，npm 页的许可链接会 404）
- 版本 0.1.0 → 0.1.1（0.1.0 已发布，不可覆盖；npm 现为分阶段发布，需 2FA 批准）
- 为什么：市场与扶持计划看的是作品页，包页没有 README 等于没有说明书

## 0.1.0 · 可安装插件 + 交付门禁 v1
3A 把适配层做成可安装的 DSH bundle（`plugin/`，`swarm_run` 已实机注册）；verify v1 落地任务契约、证据与 GREEN/YELLOW/RED 三态门禁，并把 H1 证据先于验收、H2 失败必给可执行复现命令、H3 放行只能由用户触发写进代码；`npm run gate` 串起七段门禁（probe / selftest / plugin:test / smoke / pack / wiring:test / dryrun；0.1.5 起 encoding 入链，共八段），让每次改动都能一键验完再交付。

## 0.0.3 · 评审修复
按 DSH 两轮评审修 P0/P1/P2 共 13 项（静默失败、伪造进度、取消语义、README 恢复、补丁真实性反证、上游校验等），并把评审探针纳入仓库 —— 官方评审是可信交付的门禁，逐条对得上 diff 才拿得到作者计划的认可与后续奖励。

## 0.0.2 · 接线层（`wiring/`）
用补丁 + 一键安装把适配层接进 dsh-agent-swarm 的 `spawn`，产出可复现的 dry-run 与离线集成测试 —— 核心层过评审了但插件真正的 spawn 在上游，必须让"clone 即可装"成立，不能只在我机器上是好的。

## 0.0.1 · 适配层（`src/`）
把国内 agent（DeepSeek/Qoder/Kimi/Ollama）用 `{id, result, dispose}` 伪装成 DSH 原生 subagent run —— 先有一层不依赖宿主版本、能独立跑通自测的核心，后面所有形态都建立在它上面。
