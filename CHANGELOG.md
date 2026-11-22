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
# 鏇存柊鏃ュ織

## 0.1.0 · 可安装插件 + 交付门禁 v1
3A 把适配层做成可安装的 DSH bundle（`plugin/`，`swarm_run` 已实机注册）；verify v1 落地任务契约、证据与 GREEN/YELLOW/RED 三态门禁，并把 H1 证据先于验收、H2 失败必给可执行复现命令、H3 放行只能由用户触发写进代码；`npm run gate` 串起七段门禁（probe / selftest / plugin:test / smoke / pack / wiring:test / dryrun），让每次改动都能一键验完再交付。

## 0.0.3 · 评审修复
按 DSH 两轮评审修 P0/P1/P2 共 13 项（静默失败、伪造进度、取消语义、README 恢复、补丁真实性反证、上游校验等），并把评审探针纳入仓库 —— 官方评审是可信交付的门禁，逐条对得上 diff 才拿得到作者计划的认可与后续奖励。

## 0.0.2 · 接线层（`wiring/`）
用补丁 + 一键安装把适配层接进 dsh-agent-swarm 的 `spawn`，产出可复现的 dry-run 与离线集成测试 —— 核心层过评审了但插件真正的 spawn 在上游，必须让"clone 即可装"成立，不能只在我机器上是好的。

## 0.0.1 · 适配层（`src/`）
把国内 agent（DeepSeek/Qoder/Kimi/Ollama）用 `{id, result, dispose}` 伪装成 DSH 原生 subagent run —— 先有一层不依赖宿主版本、能独立跑通自测的核心，后面所有形态都建立在它上面。
