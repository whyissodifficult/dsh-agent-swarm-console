/**
 * D3 · 三态门禁纯函数。
 * decide(contract, evidence) → { decision, reasons, missing, reproCmd? }
 *
 * R1 任一 criterion 的 checkIds 为空，或没有对应 evidence.checks → 最高 YELLOW
 * R2 任一 check.ok === false → RED，reasons 必须包含 reproCmd（可复制执行）
 * R3 全部 criteria 有证据且通过 → GREEN
 *
 * 优先级：RED > YELLOW > GREEN。纯函数，零副作用、零依赖。
 */

/**
 * @param {object} contract  TaskContract
 * @param {object} evidence  Evidence
 */
export function decide(contract, evidence) {
  const reasons = []
  const missing = []

  if (!contract || !Array.isArray(contract.criteria) || contract.criteria.length === 0) {
    return { decision: 'RED', reasons: ['契约没有任何验收条件，不可判通过'], missing: [] }
  }
  const checks = Array.isArray(evidence?.checks) ? evidence.checks : []
  const byId = new Map(checks.map((c) => [c.id, c]))

  // R2 先行：任一 check 失败即 RED，并给出最小复现命令
  const failed = checks.filter((c) => c.ok === false)
  if (failed.length > 0) {
    const reproCmd = failed.map((c) => reproFor(c)).filter(Boolean).join(' && ')
    for (const c of failed) {
      reasons.push(`check "${c.id}" 失败：${c.detail || c.type}${c.cmd ? `（${c.cmd}）` : ''}`)
    }
    if (!reproCmd) reasons.push('未提供可复现命令（reproCmd 为空）')
    return { decision: 'RED', reasons, missing, reproCmd: reproCmd || undefined }
  }

  // R1：逐条 criterion 查证据覆盖
  for (const criterion of contract.criteria) {
    const ids = Array.isArray(criterion.checkIds) ? criterion.checkIds : []
    if (ids.length === 0) {
      missing.push(`${criterion.id}: 未绑定 checkIds`)
      continue
    }
    const hit = ids.filter((id) => byId.has(id))
    if (hit.length === 0) {
      missing.push(`${criterion.id}: 没有对应 evidence.checks（需要 ${ids.join(', ')}）`)
    } else if (hit.length < ids.length) {
      const absent = ids.filter((id) => !byId.has(id))
      missing.push(`${criterion.id}: 缺少检查 ${absent.join(', ')}`)
    }
  }

  if (missing.length > 0) {
    reasons.push(`${missing.length} 条验收条件缺少证据，不能判为通过`)
    return { decision: 'YELLOW', reasons, missing }
  }

  // R3：全部覆盖且全通过
  reasons.push(`全部 ${contract.criteria.length} 条验收条件均有通过证据`)
  return { decision: 'GREEN', reasons, missing }
}

/** 从失败 check 构造可复制执行的最小复现命令。 */
function reproFor(check) {
  if (typeof check.cmd === 'string' && check.cmd.trim() !== '') return check.cmd
  // H2 兜底（正常路径下 exec 缺 cmd 已在 evidence 层被拒，见 normalizeChecks）：
  // 给一条 sh -c 可直接执行且退出非 0 的真命令，不是装饰性注释。
  return `echo "check ${check.id} 未提供 cmd" && exit 1`
}
