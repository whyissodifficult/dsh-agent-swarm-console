/**
 * P0-3 · 策略加载与转换（0.3.0）。
 *
 * P0-1：策略层不再猜命令——删掉 'npm test' 兜底。
 * P0-4：exec 只能来自 contract.testCmd；契约没声明就生成不出任何检查。
 * P2-3：策略 JSON 只声明实际能生成的类型（exec）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const POLICIES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'policies')

/** 读取策略 JSON。id 限定小写/数字/连字符，防路径穿越。 */
export function loadPolicy(id = 'code-change', baseDir = POLICIES_DIR) {
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) throw new Error('policy id 非法')
  const data = JSON.parse(readFileSync(join(baseDir, `${id}.json`), 'utf8'))
  if (data.id !== id) throw new Error(`策略 id 不一致：${data.id} !== ${id}`)
  return data
}

/**
 * 把策略声明转成可执行的检查请求。
 * 只有契约显式给了 testCmd 才生成 exec；绝不使用默认命令。
 */
export function policyToChecks(policy, contract = {}) {
  const out = []
  const testCmd = typeof contract.testCmd === 'string' ? contract.testCmd.trim() : ''
  if (testCmd === '') return out
  for (const c of policy.checks ?? []) {
    if (c.type === 'exec') out.push({ id: c.id, type: 'exec', cmd: testCmd })
  }
  return out
}

/** 策略声明的检查 id 列表（供 P0-1 判断「策略是否被契约覆盖」）。 */
export function policyCheckIds(policy) {
  return (policy.checks ?? []).map((c) => c.id).filter((id) => typeof id === 'string')
}
