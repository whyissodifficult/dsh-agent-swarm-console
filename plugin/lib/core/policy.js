/**
 * P0-3 · 策略加载与转换（0.2.0）。
 * loadPolicy(id) 读 plugin/policies/<id>.json；
 * policyToChecks(policy, contract) 把描述性 checks 转成可执行的检查请求。
 * 说明：策略里的 file.exists / workspace.diff 需要具体输入，不能由策略层伪造，
 * 因此 policy runner 只生成能确定的 exec 检查（tests），其余留给调用方显式提供。
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

/** 把策略的 checks 描述转成可执行的检查请求（只生成能确定的 exec 检查）。 */
export function policyToChecks(policy, contract = {}) {
  const out = []
  for (const c of policy.checks ?? []) {
    if (c.type === 'exec') {
      const testCmd = (Array.isArray(contract.constraints) ? contract.constraints : [])
        .map((s) => String(s))
        .find((s) => s.startsWith('testCmd:'))
      const cmd = testCmd ? testCmd.slice('testCmd:'.length).trim() : 'npm test'
      out.push({ id: c.id, type: 'exec', cmd })
    }
    // file.exists / workspace.diff 需要路径或宿主 workspaceChanges，不在此伪造
  }
  return out
}
