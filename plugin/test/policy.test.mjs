/**
 * policy runner（0.3.0）：不猜命令、只在契约显式声明且覆盖时启用。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPolicy, policyToChecks, policyCheckIds } from '../lib/core/policy.js'
import { verifyContract as __verifyContract, verifyRun, newStores, gateFreeze } from '../lib/core/verify.js'

// 0.4.0：建契约后必须用户确认；测试里默认自动确认（确认机制本身另有反证）
function verifyContract(input, sessionId = 'default', store, runStore) {
  const r = __verifyContract(input, sessionId, store, runStore)
  gateFreeze({ contractId: r.contractId, sessionId }, store, runStore)
  return r
}

const ROOT = process.cwd()

test('loadPolicy 读到 code-change，且只声明 exec', async () => {
  const p = loadPolicy('code-change')
  assert.equal(p.id, 'code-change')
  assert.deepEqual(policyCheckIds(p), ['tests'])
  assert.equal(policyToChecks(p, { testCmd: 'npm test' }).length, 1)
})
test('policyToChecks 不再有 npm test 兜底（无 testCmd → 空）', async () => {
  const p = loadPolicy('code-change')
  assert.deepEqual(policyToChecks(p, {}), [])
  assert.deepEqual(policyToChecks(p, { constraints: ['testCmd: npm run x'] }), [], '不再从 constraints 猜命令')
})
test('policyToChecks 命令只来自 contract.testCmd', async () => {
  const p = loadPolicy('code-change')
  const checks = policyToChecks(p, { testCmd: 'npm run mytest' })
  assert.deepEqual(checks, [{ id: 'tests', type: 'exec', cmd: 'npm run mytest' }])
})
test('P0-1 反证：无关契约 + checkIds=[tests] + 无 checks → YELLOW（不得 GREEN）', async () => {
  const s = newStores()
  const { contractId } = verifyContract({
    objective: '跟这个仓库毫无关系的任务',
    workspaceRoot: ROOT,
    criteria: [{ id: 'AC1', text: '测试通过', checkIds: ['tests'] }],
  }, 'default', s.contracts, s.runs)
  const r = await verifyRun({ contractId, sessionId: 'default', usePolicy: true }, s.contracts, s.runs)
  assert.equal(r.decision, 'YELLOW')
})
test('显式 policyId + testCmd + 契约覆盖 → 策略生效（注入 exec）', async () => {
  const s = newStores()
  const seen = []
  const { contractId } = verifyContract({
    objective: '策略生效', workspaceRoot: ROOT, policyId: 'code-change', testCmd: 'npm test',
    criteria: [{ id: 'AC1', text: '测试通过', checkIds: ['tests'] }],
  }, 'default', s.contracts, s.runs)
  const r = await verifyRun({
    contractId, sessionId: 'default', usePolicy: true,
    checkDeps: { exec: (cmd) => { seen.push(cmd); return { status: 0, error: undefined } } },
  }, s.contracts, s.runs)
  assert.deepEqual(seen, ['npm test'])
  assert.equal(r.decision, 'GREEN')
})
test('P2-3 反证：checkIds 指向已删除的 exists → YELLOW 且 reason 提示策略覆盖问题', async () => {
  const s = newStores()
  const { contractId } = verifyContract({
    objective: '引用已删除检查', workspaceRoot: ROOT, policyId: 'code-change', testCmd: 'npm test',
    criteria: [{ id: 'AC1', text: '文件存在', checkIds: ['exists'] }],
  }, 'default', s.contracts, s.runs)
  const r = await verifyRun({ contractId, sessionId: 'default', usePolicy: true }, s.contracts, s.runs)
  assert.equal(r.decision, 'YELLOW')
  assert.ok(r.reasons.some((x) => x.includes('策略未提供')), r.reasons.join('|'))
})
test('loadPolicy 拒绝路径穿越 id', async () => {
  assert.throws(() => loadPolicy('../evil'), /非法/)
})
