/**
 * P0-3 · policy runner：未显式给 checks 时按 code-change 策略生成检查请求。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPolicy, policyToChecks } from '../lib/core/policy.js'
import { verifyContract, verifyRun, newStores } from '../lib/core/verify.js'

test('loadPolicy 读到 code-change 策略', () => {
  const p = loadPolicy('code-change')
  assert.equal(p.id, 'code-change')
  assert.ok(Array.isArray(p.checks))
})

test('policyToChecks 生成 exec 请求，默认 npm test', () => {
  const p = loadPolicy('code-change')
  const checks = policyToChecks(p, { constraints: [] })
  assert.equal(checks.length, 1)
  assert.equal(checks[0].type, 'exec')
  assert.equal(checks[0].cmd, 'npm test')
})

test('policyToChecks 尊重 constraints 里的 testCmd', () => {
  const p = loadPolicy('code-change')
  const checks = policyToChecks(p, { constraints: ['testCmd: npm run mytest'] })
  assert.equal(checks[0].cmd, 'npm run mytest')
})

test('verifyRun usePolicy 时执行策略生成的检查（注入 exec 记录 cmd）', () => {
  const s = newStores()
  const seen = []
  const { contractId } = verifyContract({ objective: '策略生效', criteria: [{ id: 'k', text: 't', checkIds: ['tests'] }] }, s.contracts)
  const r = verifyRun({
    contractId, usePolicy: true,
    checkDeps: { exec: (cmd) => { seen.push(cmd); return { status: 0, error: undefined } } },
  }, s.contracts, s.runs)
  assert.deepEqual(seen, ['npm test'])
  assert.equal(r.decision, 'GREEN')
})

test('未给 usePolicy 且无 checks → 仍 YELLOW（不偷偷跑策略）', () => {
  const s = newStores()
  const { contractId } = verifyContract({ objective: 'x', criteria: [{ id: 'k', text: 't', checkIds: ['tests'] }] }, s.contracts)
  const r = verifyRun({ contractId }, s.contracts, s.runs)
  assert.equal(r.decision, 'YELLOW')
})

test('loadPolicy 拒绝路径穿越 id', () => {
  assert.throws(() => loadPolicy('../evil'), /非法/)
})
