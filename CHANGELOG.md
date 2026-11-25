# 更新日志

## 0.6.2 · 包页重写：陌生人 30 秒能看懂

只改文档，不动代码。目标很具体：**从 npm 页面点进来的人，第一屏就知道这是干什么的**。

- 开头换成「三行对话」钩子（agent 说完成了、其实没做），再给装法
- 加一次**真实回合**（真实 contractId / 时间戳 / 证据 hash），不是演示数据
- 加两张截图：GREEN 结果、RED 与复现命令（`plugin/docs/images/`）
- 新增「谁适合用 / 不适合」与「已知限制」两节——不吹，先把边界摆出来
- 根 README 顶部同款钩子


## 0.6.1 · 修 `..` 前缀误判（合法文件被判 RED）

- **真 bug（外部反馈，已复现）**：边界判断用 `rel.startsWith('..')`，把工作区里**名字以 `..` 开头**的
  合法文件（如 `..foo`、`..dir/x`）误判成越界 → RED。实际服务里这类文件名不罕见（临时文件、隐藏配置）。
  修法：`rel === '..' || rel.startsWith('..' + sep)`，词法检查与 realpath 检查两处都改。
- **淘汰策略改为 LRU 且保护关键记录**：原来按纯插入序淘汰，且重复写入不刷新顺序——
  500 条上限下，**已确认/已放行的契约可能被静默淘汰**。现在 set 会 touch，且 confirmed/approved 的记录不参与淘汰。
- **写盘重试**：Windows 上 `renameSync` 可能被索引/杀软短暂占用（EBUSY/EPERM），现在重试 3 次再放弃。
- **已知限制（新增说明）**：state.json 假定**单实例**写入；两个 DSH 窗口同时写会后写覆盖（原子写保证不损坏，但会丢条目）。
- 测试：+3（`..` 前缀回归、淘汰保护关键记录、LRU 刷新顺序），共 94 条全绿；两处修复各有反证。


## 0.6.0 · 契约与证据落盘：重启不再丢

为什么：v1 把契约和证据存在进程内存里，DSH 一重启就全没了——`/gate-status` 只会回“未知契约”，
这在一个“要拿去验收”的工具里是最不像产品的地方。

- 新增 `lib/core/store.js`：单文件 JSON 状态（默认 `~/.dsh/swarm-console/state.json`），
  原子写（tmp + rename）、变更后 200ms debounce 合并落盘、最多保留 500 条（最旧淘汰）
- 插件激活时自动载入；状态文件损坏或缺失 → 按空状态启动并留 warning，**不阻塞激活**
- 配置项 `stateFile` 可改路径；显式传空串则退回纯内存（测试/临时会话用）
- 关闭时（`ctx.effect` 的 disposer）flush 一次，避免丢最后一条写入
- 测试：+3（跨“进程”重启读回、损坏文件容错、上限淘汰），共 91 条全绿


## 0.5.0 · 收窄定位：只做门禁（破坏性）

为什么：多 agent 编排/可视化已经有人做了，本插件的价值在「验收」这一层。继续挂着“跑外部 agent”
的工具只会让定位含糊、让评审看不懂它解决什么问题。

- **移除** `swarm_run` 工具与 `externalAgents` 配置（连同 `baseUrl`/`apiKeyEnv`/`models` 校验）
- 插件现在只提供：`verify_contract` / `verify_run` / `verify_status` + 四条斜杠命令 + 运行期 skill
- 文案与包描述改为“交付门禁”定位；仓库名与包名保留（改名会丢安装量与链接，不值得）
- 测试：删除 swarm_run 相关断言，其余 88 条全绿


## 0.4.5 · 修复 Android/Termux 上 exec 检查恒失败

- **现象**：DSH 手机端（0.2.1-rc.2，Android/Termux，Node 26）上带 `exec` 的契约必然 RED：
  `spawn /data/data/com.termux/files/usr/bin/sh ENOENT`——`shell: true` 走的是 Node 编译期硬编码路径。
- **修复**：显式探测可用 shell 后传给 `spawn`（`ComSpec` → `$SHELL` → `/bin/sh` → `/usr/bin/sh` →
  `/system/bin/sh` → Termux 的 sh/bash，取第一个存在的）；`resolveShell` 可注入，便于测试。
- **语义修正**：环境确实没有 shell 时不再判 RED，而是 `env-unavailable` 检查 → 门禁 **YELLOW**，
  reason 写明「环境无可用 shell（已尝试：…）」。环境缺失 ≠ 代码没通过。
- 同时修：`envUnavailable` 参与 evidence 规范化；H2「失败必须给 cmd」不再误伤环境不可用检查。
- 测试：+3（无 shell → YELLOW、显式 shell → 正常执行、环境不可用与真实失败并存仍判 RED），共 88 条。


## 0.4.4 · 确认前先看清内容 + 超时可配置

- **P0-E（安全）**：`/gate-freeze` 以前只回显 id，等于蒙着眼睛签字。现在会**先回显契约全文**
  （目标 / 工作区 / 唯一允许的测试命令 / 超时 / 策略 / 每条验收条件），再加 `--yes` 才真正确认。
- **P1-A**：`exec` 超时不再写死 10 秒——由契约的 `testTimeoutMs` 决定（默认 60 秒，范围 1–600 秒），
  慢测试不会被误杀；默认值与硬上限都写进 DETAIL。
- **P1-B**：未确认 / 未知策略 / 未知契约这类**结构性 RED 现在会写状态记录**，
  `/gate-status` 不再出现「最近决定 undefined」。
- **P2-A**：符号链接越界的回归测试改为注入 `realpathSync`，不再因 Windows 建链接无权限而静默 SKIP。


## 0.4.3 · 符号链接绕过工作区边界（安全）

- **问题**：`workspaceRoot` 内的 junction / 符号链接能指向工作区外，`file.exists` 对
  `link/secret.txt` 会判存在——词法路径校验挡不住物理跳转（实测 junction 可复现）
- **修复**：解析真实路径后再比一次边界（`realpath(workspaceRoot)` vs `realpath(target)`），
  越界判 RED「检查路径经符号链接解析后越出 workspaceRoot」
- 回归测试：在临时目录建 junction 指向外部，断言 RED；无权限建链接时跳过


## 0.4.2 · 文档与实现对齐（只改文档与描述）

- 包页 README：`exec` 改为「异步 spawn + 10 秒超时」（旧文写的是「同步 120 秒、异步排进 0.3」，与 0.4.0 实现相反）
- 包页 README：RED 的复现命令限定为「**检查失败导致的** RED」（未确认 / 未知 id / 未知策略这类结构性 RED 不带命令）；
  命令条数 3 → 4（补 `/gate-freeze`）；补 `swarm_run` 一行；`/gate-retry` 描述改为「清空证据并重算（不重跑检查）」
- 根 README：版本 0.3.2 → 0.4.2；安装节不再把模型工具 `plugin_manager` 写成终端命令；
  勾掉已完成里程碑（P2/P3、阶段 3/4）；把画布与能力路由标注为「开发中 / 仅 wiring 生效」；删掉不存在的 `unverified` 状态说法
- README.en.md：语言切换方向修正（原来 English 指向中文页）、版本与命令数与中文版对齐
- `package.json` description 去掉 `v0.1` 字样（npm 副标题不再与 0.4.x 冲突）


## 0.4.1 · 修 /gate-freeze 之后 verify_status 报错

- **现象**：刚 `/gate-freeze`、还没跑过 `verify_run` 时，`verify_status` 工具报
  `invalid output: value is not lossless JSON`——因为记录里 `decision`/`at`/`evidenceHash`
  还是 `undefined`，随工具输出序列化失败
- **修复**：`verifyStatus` 省略未定义字段；工具渲染兜住「已确认但还没跑过」→「尚未跑过 verify_run」
- 回归测试：freeze 后 `verifyStatus` 结果可 `JSON.stringify` 且不含 undefined


## 0.4.0 · 契约必须由用户确认（破坏性）

**破坏性变更：`verify_run` 现在要求先确认契约。**
- `verify_contract` 冻结后进入**待确认**状态；未确认时 `verify_run` 直接判 RED（「契约尚未由用户确认，请先 /gate-freeze <id>」），不生成检查、不写证据
- 新增斜杠命令 `/gate-freeze <id|前缀>`：只能由用户触发（模型无对应工具），记录 `confirmed/confirmedAt/confirmedBy:'user'`，按会话隔离
- 确认是**状态**不是内容：契约哈希不变；同一契约重复冻结不会重置已确认
- `/gate-status` 显示「待确认」或「已确认 @ 时间」

**迁移**：升级后按旧流程直接 `verify_run` 会得到 RED「契约尚未由用户确认，请先 /gate-freeze <id>」——补敲一次 `/gate-freeze <id>` 即可继续，不需要重新冻结契约。

**异步执行：**
- `runChecks` / `verifyRun` / `gate-retry` 改为 async；默认 exec 用 `child_process.spawn`，10 秒超时强制终止，等待期间不再阻塞宿主事件循环
- 工具 `execute` 与命令 handler 全部 `await`，宿主不会收到浮动 Promise

## 0.3.3 · 包页文档纠错（只改文档）

- 安装节不再让用户在终端敲 `plugin_manager`（那是模型侧工具）；改为 UI 路径 + 说明可让 agent 代装
- 补两个实操坑：跨次版本必须显式写版本号；国内镜像 `npmmirror` 有同步延迟，急用可从官方源装
- 同步 0.3.x 的能力描述到包页（workspaceRoot / testCmd 白名单 / 证据 hash / 路径不得越界）


## 0.3.2 · 工作区边界与策略错误处理

- **P0-A（安全）**：`file.exists` 的路径必须留在 `workspaceRoot` 内；`../` 越界直接判 RED
  （此前 `../dsh-secret.txt` 可以对工作区外任意文件断言成功）
- **P1-B**：未知 `policyId` 不再抛异常并泄露内部绝对路径，改为 RED「未知策略 <id>」
- **P1-A（缓解）**：`exec` 超时 120s → 10s，减少阻塞窗口；异步执行仍排 0.4.0
- **P3**：查不到契约时不再渲染「复现：未提供命令（异常）」
- **P2**：README 示例改用占位符（`<evidenceHash>`、`/path/to/your/project`），避免照抄得到「证据已过期」


## 0.3.1 · 文档与复现命令对齐 0.3.0 语义

- README 示例按 0.3.0 重写：`verify_contract` 带 `workspaceRoot`、`verify_run` 用相对路径检查、
  `/gate-status` 输出「证据：<hash>」、`/gate-approve <id> <hash>`
- README 安装节补 semver 提示：`^0.2.x` 装不到 0.3.x，升级需显式指定版本
- `exec` 被 `testCmd` 白名单拒绝时，复现命令不再回显那条被拒命令（它可能退出 0），
  改为可执行的 `echo … && exit 1` 提示；`checks[].rejected` 参与 evidence 规范化


## 0.3.0 · 门禁可信度加固（破坏性）

**破坏性变更（契约结构）：**
- `verify_contract` **必须**提供 `workspaceRoot`（绝对路径、必须存在且是目录）。所有检查以它为根执行，结论不再随宿主 cwd 变化。
- `file.exists` 的 `path` 必须是**相对 `workspaceRoot`** 的相对路径；绝对路径直接判 RED。
- 契约新增 `testCmd`（可选）：`exec` 检查只允许这一条命令，`cmd` 必须与它完全相等；不声明则拒绝一切 `exec`。
- `/gate-approve` **必须**带第二参数 `evidenceHash`（先用 `/gate-status` 复制）；非 GREEN 或 hash 不一致一律拒绝。
- 契约与运行状态改为按 `${sessionId}:${contractId}` 存储；`/gate-status` 无参只列本会话，前缀解析限定本会话且最短 4 位。
- 复现命令使用**绝对路径**：`evidence` 保留 `checks[].absPath`，`file.exists` 的 reproCmd 不再随执行目录漂移

**可信度修复：**
- 删除策略层的 `'npm test'` 兜底：策略不再猜命令；且只有契约显式声明 `policyId`、策略检查 id 全被契约 `checkIds` 覆盖时才启用（杜绝「模型命名即可自证」）
- `checks` 非法请求不再抛异常，统一返回 `ok:false` 并判 RED（宿主不会收到未捕获异常）
- `gate-retry` 语义修正：`approved=false`、`stale=true`，保留 `lastApprovedAt` / `lastApprovedHash`
- `file.exists` 的复现命令改为跨平台的 `node -e "...existsSync..."`，不再依赖 `sh` / `test -f`
- `RESULT:` 解析只取第一行，避免把后续说明吞进结果
- 修 `sandbox-spawn` 的 ENOENT 诊断：报完整命令行，不再把参数当可执行文件名
- 策略 JSON 只保留实际能生成的 `exec` 检查（删除 `exists` / `workspace.diff` 声明）

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
