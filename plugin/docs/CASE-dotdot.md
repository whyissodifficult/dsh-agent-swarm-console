# 案例：一次「把合法文件判成违规」的真 bug（0.6.1）

> 这个案例说明两件事：门禁本身也会错；以及**发现—复现—修复—反证**该怎么走。

## 1. 报告

2026-11-24，外部评审给出这样一条：

```
file.exists 的越界判断用的是 rel.startsWith('..')，文件名本身以 .. 开头就会误杀：

  文件: <tmp>/..foo 确实存在
  判定: ok=false, detail="检查路径越出 workspaceRoot：..foo"   ← 误判

一行修法：rel === '..' || rel.startsWith('..' + sep)（relReal 那处同样改）。
概率低，但这是"把合法文件判成 RED"，方向反了。
```

## 2. 先复现，别急着改

```bash
# 在工作区根下建一个名字以 .. 开头的文件
touch <workspace>/..foo

# 让门禁去查它
file.exists "..foo"   →  ok=false  「检查路径越出 workspaceRoot：..foo」
```

确认：文件**确实存在**，判定却是 RED。**复现成立。**

顺带发现报告里有一处不准确：`plugin/test/..foo`（中间路径）是**正常的**——
`relative()` 返回 `plugin/test/..foo`，开头不是 `..`。只有**相对路径本身**以 `..` 开头才会误判。
**结论不变，但回归测试必须按真实边界写**，否则会写出一个永远绿的假测试。

## 3. 修复

```js
// 改前
if (rel.startsWith('..') || isAbsolute(rel)) { /* RED */ }

// 改后：只有 `..` 整体、或 `..` + 分隔符 才算真的出界
function isOutside(rel) {
  return rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)
}
```

词法检查与 `realpath` 检查**两处都改**（否则符号链接路径仍会走旧判断）。

## 4. 验证

```
改后：
  ..foo          → ok=true  「文件存在：..foo」
  ../outside     → ok=false 「检查路径越出 workspaceRoot」   ← 真越界仍然拦
  plugin/README  → ok=true
```

## 5. 反证（关键一步）

```
把 isOutside 改回 startsWith('..')  → not ok 39 变红   ✅ 测试确实守住了这个行为
恢复                               → 94/94 全绿
```

**没有反证的回归测试不算测试**——它可能只是在描述当前实现。

## 6. 同批修的两处

| 问题 | 修法 |
| --- | --- |
| 淘汰按插入序，500 条上限下**已确认/已放行的契约可能被静默淘汰** | 淘汰改 LRU（`set` 时 touch），且 `confirmed` / `approved` 的记录不参与淘汰 |
| Windows 上 `renameSync` 可能被索引/杀软占用（EBUSY/EPERM） | 重试 3 次（EBUSY/EPERM/EACCES），仍失败才记 warning |

## 7. 教训

1. **方向性错误比漏判更危险**：把合法情况判成失败，用户会开始怀疑门禁本身，而门禁的全部价值就是"可信"。
2. **外部报告要先复现**：这次报告里有半句不准确，照抄会造出假测试。
3. **修复必须配反证**：把修复改回去，测试要能红。
4. **淘汰策略要保护签字**：被静默丢掉的"已放行证据"，等于把审计记录撕了。

发布：`dsh-swarm-console@0.6.1`
