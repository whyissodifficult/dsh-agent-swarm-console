/**
 * D2 · 证据结构。
 * level: E0 无证据 / E1 有产物但无执行检查 / E2 有可复现执行检查
 * status: verified / failed / partial
 * 零运行时依赖。
 */
import { createHash } from 'node:crypto'

/**
 * @param {{contractId:string, artifacts?:Array, checks?:Array, level?:string, status?:string, at?:string}} input
 */
export function makeEvidence(input) {
  if (!input || typeof input.contractId !== 'string' || input.contractId === '') {
    throw new Error('contractId 必填')
  }
  const artifacts = normalizeArtifacts(input.artifacts)
  const checks = normalizeChecks(input.checks)
  const level = ['E0', 'E1', 'E2'].includes(input.level) ? input.level : inferLevel(checks, artifacts)
  const status = ['verified', 'failed', 'partial'].includes(input.status)
    ? input.status
    : inferStatus(checks)
  const at = typeof input.at === 'string' && input.at !== '' ? input.at : new Date().toISOString()
  return { contractId: input.contractId, artifacts, checks, level, status, at }
}

/** 证据内容哈希（用于 verify_run 返回的 evidenceHash）。 */
export function evidenceHash(evidence) {
  const canonical = JSON.stringify({
    contractId: evidence.contractId,
    artifacts: evidence.artifacts,
    checks: evidence.checks,
  })
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12)
}

export function validateEvidence(evidence) {
  const errs = []
  if (!evidence || typeof evidence !== 'object') return ['evidence 必须是对象']
  if (typeof evidence.contractId !== 'string' || evidence.contractId === '') errs.push('contractId 必填')
  if (!Array.isArray(evidence.artifacts)) errs.push('artifacts 必须是数组')
  if (!Array.isArray(evidence.checks)) errs.push('checks 必须是数组')
  else for (const [i, c] of evidence.checks.entries()) {
    if (!c || typeof c.id !== 'string' || c.id === '') errs.push(`checks[${i}].id 必填`)
    if (typeof c.ok !== 'boolean') errs.push(`checks[${i}].ok 必须是布尔`)
    if (typeof c.type !== 'string' || c.type === '') errs.push(`checks[${i}].type 必填`)
  }
  if (!['E0', 'E1', 'E2'].includes(evidence.level)) errs.push('level 必须是 E0/E1/E2')
  if (!['verified', 'failed', 'partial'].includes(evidence.status)) errs.push('status 必须是 verified/failed/partial')
  return errs
}

function inferLevel(checks, artifacts) {
  if (checks.some((c) => c.exitCode !== undefined || c.cmd)) return 'E2'
  if (checks.length > 0 || artifacts.length > 0) return 'E1'
  return 'E0'
}

function inferStatus(checks) {
  if (checks.length === 0) return 'partial'
  if (checks.every((c) => c.ok)) return 'verified'
  if (checks.some((c) => !c.ok)) return 'failed'
  return 'partial'
}

function normalizeArtifacts(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('artifacts 必须是数组')
  return value.map((a, i) => {
    if (!a || typeof a !== 'object') throw new Error(`artifacts[${i}] 必须是对象`)
    if (typeof a.path !== 'string' || a.path === '') throw new Error(`artifacts[${i}].path 必填`)
    return {
      path: a.path,
      sha256: typeof a.sha256 === 'string' ? a.sha256 : '',
      size: Number.isFinite(a.size) ? a.size : 0,
    }
  })
}

function normalizeChecks(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('checks 必须是数组')
  return value.map((c, i) => {
    if (!c || typeof c !== 'object') throw new Error(`checks[${i}] 必须是对象`)
    if (typeof c.id !== 'string' || c.id === '') throw new Error(`checks[${i}].id 必填`)
    if (typeof c.type !== 'string' || c.type === '') throw new Error(`checks[${i}].type 必填`)
    if (typeof c.ok !== 'boolean') throw new Error(`checks[${i}].ok 必须是布尔`)
    // exec 类 check 必须有可执行 cmd —— 缺 cmd 的失败无法复现，H2 要求策略层就拒绝。
    if (c.type === 'exec' && c.ok === false && (typeof c.cmd !== 'string' || c.cmd.trim() === '')) {
      throw new Error(`checks[${i}] exec 类失败 check 必须提供可执行 cmd（H2 reproCmd）`)
    }
    const out = { id: c.id, type: c.type, ok: c.ok }
    for (const k of ['detail', 'exitCode', 'cmd']) if (c[k] !== undefined) out[k] = c[k]
    return out
  })
}
