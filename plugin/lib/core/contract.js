/**
 * D1 · 冻结任务契约（0.3.0 起破坏性变更）。
 *
 * 新增 workspaceRoot（必填）：检查以它为根执行，避免「在哪个 cwd 跑」决定结论。
 * 新增 testCmd（可选）：exec 检查唯一允许的命令（白名单）；未声明则拒绝一切 exec。
 * policyId 不再默认填充：只有显式声明才可能启用策略（P0-1 杜绝「命名即自证」）。
 *
 * id = 规范化内容哈希前 12 位；改 workspaceRoot / testCmd 同样换 id。
 */
import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

/**
 * @param {{objective:string, constraints?:string[], criteria?:Array, workspaceRoot:string, testCmd?:string, policyId?:string, frozenAt?:string}} input
 */
export function freezeContract(input) {
  if (!input || typeof input.objective !== 'string' || input.objective.trim() === '') {
    throw new Error('objective 必须是非空字符串')
  }

  // P0-2/P0-5：workspaceRoot 必填，且必须是存在目录的绝对路径
  if (typeof input.workspaceRoot !== 'string' || input.workspaceRoot.trim() === '') {
    throw new Error('workspaceRoot 必填（绝对路径）：检查以它为根执行')
  }
  if (!isAbsolute(input.workspaceRoot)) {
    throw new Error(`workspaceRoot 必须是绝对路径，收到：${input.workspaceRoot}`)
  }
  const workspaceRoot = resolve(input.workspaceRoot)
  if (!existsSync(workspaceRoot)) {
    throw new Error(`workspaceRoot 不存在：${workspaceRoot}`)
  }
  let st
  try { st = statSync(workspaceRoot) } catch { st = undefined }
  if (!st || !st.isDirectory()) {
    throw new Error(`workspaceRoot 不是目录：${workspaceRoot}`)
  }

  const constraints = normalizeStringArray(input.constraints, 'constraints')
  const criteria = normalizeCriteria(input.criteria)

  // P0-4：testCmd 可选；给了就必须是非空字符串
  let testCmd
  if (input.testCmd !== undefined && input.testCmd !== null) {
    if (typeof input.testCmd !== 'string' || input.testCmd.trim() === '') {
      throw new Error('testCmd 必须是非空字符串（exec 检查的唯一允许命令）')
    }
    testCmd = input.testCmd.trim()
  }

  // P0-1：policyId 仅显式声明才存在，不设默认值
  let policyId
  if (input.policyId !== undefined && input.policyId !== null) {
    if (typeof input.policyId !== 'string' || input.policyId.trim() === '') {
      throw new Error('policyId 必须是非空字符串')
    }
    policyId = input.policyId.trim()
  }

  const frozenAt = typeof input.frozenAt === 'string' && input.frozenAt !== '' ? input.frozenAt : new Date().toISOString()

  const canonical = JSON.stringify({ objective: input.objective, constraints, criteria, workspaceRoot, testCmd, policyId })
  const id = createHash('sha256').update(canonical).digest('hex').slice(0, 12)

  const contract = { id, objective: input.objective, constraints, criteria, workspaceRoot, frozenAt }
  if (testCmd !== undefined) contract.testCmd = testCmd
  if (policyId !== undefined) contract.policyId = policyId
  return contract
}

/** 校验已冻结契约的形状（供 gate / verify_run 入口复用）。 */
export function validateContract(contract) {
  const errs = []
  if (!contract || typeof contract !== 'object') return ['contract 必须是对象']
  if (typeof contract.id !== 'string' || !/^[0-9a-f]{12}$/.test(contract.id)) errs.push('id 必须是 12 位小写十六进制')
  if (typeof contract.objective !== 'string' || contract.objective.trim() === '') errs.push('objective 必填')
  if (!Array.isArray(contract.constraints)) errs.push('constraints 必须是数组')
  if (typeof contract.workspaceRoot !== 'string' || !isAbsolute(contract.workspaceRoot)) {
    errs.push('workspaceRoot 必须是绝对路径')
  }
  if (contract.testCmd !== undefined && (typeof contract.testCmd !== 'string' || contract.testCmd.trim() === '')) {
    errs.push('testCmd 必须是非空字符串')
  }
  if (!Array.isArray(contract.criteria)) errs.push('criteria 必须是数组')
  else for (const [i, c] of contract.criteria.entries()) {
    if (!c || typeof c.id !== 'string' || c.id === '') errs.push(`criteria[${i}].id 必填`)
    if (typeof c.text !== 'string' || c.text === '') errs.push(`criteria[${i}].text 必填`)
    if (!Array.isArray(c.checkIds)) errs.push(`criteria[${i}].checkIds 必须是数组`)
  }
  return errs
}

function normalizeStringArray(value, name) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${name} 必须是数组`)
  return value.map((v, i) => {
    if (typeof v !== 'string') throw new Error(`${name}[${i}] 必须是字符串`)
    return v
  })
}

function normalizeCriteria(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('criteria 必须是数组')
  return value.map((c, i) => {
    if (!c || typeof c !== 'object') throw new Error(`criteria[${i}] 必须是对象`)
    if (typeof c.id !== 'string' || c.id === '') throw new Error(`criteria[${i}].id 必填`)
    if (typeof c.text !== 'string' || c.text === '') throw new Error(`criteria[${i}].text 必填`)
    const checkIds = normalizeStringArray(c.checkIds, `criteria[${i}].checkIds`)
    return { id: c.id, text: c.text, checkIds }
  })
}
