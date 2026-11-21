/**
 * D1 · 冻结任务契约。
 * id = 规范化内容哈希前 12 位 —— 同一份目标/约束/验收条件得到同一个 id，
 * 改一个字就换 id，防止"验收时换了题目"。
 * 零运行时依赖：用 node:crypto 的 sha256（Node 内置）。
 */
import { createHash } from 'node:crypto'

/**
 * @param {{objective:string, constraints?:string[], criteria?:Array<{id:string,text:string,checkIds?:string[]}>, policyId?:string}} input
 * @returns {{id:string, objective:string, constraints:string[], criteria:Array<{id:string,text:string,checkIds:string[]}>, policyId:string, frozenAt:string}}
 */
export function freezeContract(input) {
  if (!input || typeof input.objective !== 'string' || input.objective.trim() === '') {
    throw new Error('objective 必须是非空字符串')
  }
  const constraints = normalizeStringArray(input.constraints, 'constraints')
  const criteria = normalizeCriteria(input.criteria)
  const policyId = typeof input.policyId === 'string' && input.policyId !== '' ? input.policyId : 'code-change'
  const frozenAt = typeof input.frozenAt === 'string' && input.frozenAt !== '' ? input.frozenAt : new Date().toISOString()

  // 规范化后再哈希：字段顺序固定、数组保序，避免对象键顺序影响 id
  const canonical = JSON.stringify({ objective: input.objective, constraints, criteria, policyId })
  const id = createHash('sha256').update(canonical).digest('hex').slice(0, 12)
  return { id, objective: input.objective, constraints, criteria, policyId, frozenAt }
}

/** 校验已冻结契约的形状（供 gate / verify_run 入口复用）。 */
export function validateContract(contract) {
  const errs = []
  if (!contract || typeof contract !== 'object') return ['contract 必须是对象']
  if (typeof contract.id !== 'string' || !/^[0-9a-f]{12}$/.test(contract.id)) errs.push('id 必须是 12 位小写十六进制')
  if (typeof contract.objective !== 'string' || contract.objective.trim() === '') errs.push('objective 必填')
  if (!Array.isArray(contract.constraints)) errs.push('constraints 必须是数组')
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
