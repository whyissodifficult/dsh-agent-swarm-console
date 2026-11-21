/**
 * D7-1 · core 三件套单测（node --test）。
 * contract / evidence / gate 各 ≥4 条断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freezeContract, validateContract } from '../lib/core/contract.js'
import { makeEvidence, validateEvidence, evidenceHash } from '../lib/core/evidence.js'
import { decide } from '../lib/core/gate.js'
import { z } from '../lib/core/mini-schema.js'

// ---------- contract.js ----------
test('contract: freeze 生成 12 位十六进制 id', () => {
  const c = freezeContract({ objective: '做一件事', criteria: [{ id: 'AC1', text: '有证据', checkIds: ['t'] }] })
  assert.match(c.id, /^[0-9a-f]{12}$/)
  assert.equal(c.policyId, 'code-change')
})
test('contract: 同内容同 id（规范化稳定）', () => {
  const a = freezeContract({ objective: 'x', constraints: ['c1'], criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }] })
  const b = freezeContract({ objective: 'x', constraints: ['c1'], criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }] })
  assert.equal(a.id, b.id)
})
test('contract: 改一个字 id 就变（冻结语义）', () => {
  const a = freezeContract({ objective: 'x' })
  const b = freezeContract({ objective: 'y' })
  assert.notEqual(a.id, b.id)
})
test('contract: 空 objective 抛错', () => {
  assert.throws(() => freezeContract({ objective: '' }), /objective/)
})
test('contract: validateContract 拦住坏 checkIds', () => {
  const errs = validateContract({ id: 'abc123456789', objective: 'x', constraints: [], criteria: [{ id: 'AC1', text: 't' }] })
  assert.ok(errs.some((e) => e.includes('checkIds')))
})

// ---------- evidence.js ----------
test('evidence: makeEvidence 推断 E2 与 verified', () => {
  const e = makeEvidence({ contractId: 'abc', checks: [{ id: 't', type: 'exec', ok: true, cmd: 'npm test', exitCode: 0 }] })
  assert.equal(e.level, 'E2')
  assert.equal(e.status, 'verified')
})
test('evidence: 无 checks 推断 E0 与 partial', () => {
  const e = makeEvidence({ contractId: 'abc' })
  assert.equal(e.level, 'E0')
  assert.equal(e.status, 'partial')
})
test('evidence: failed 状态由失败 check 推断', () => {
  const e = makeEvidence({ contractId: 'abc', checks: [{ id: 't', type: 'exec', ok: false, cmd: 'npm test' }] })
  assert.equal(e.status, 'failed')
})
test('evidence: evidenceHash 稳定且随内容变化', () => {
  const a = makeEvidence({ contractId: 'abc', checks: [{ id: 't', type: 'x', ok: true }] })
  const b = makeEvidence({ contractId: 'abc', checks: [{ id: 't', type: 'x', ok: false }] })
  assert.match(evidenceHash(a), /^[0-9a-f]{12}$/)
  assert.notEqual(evidenceHash(a), evidenceHash(b))
})
test('evidence: validateEvidence 拦住非布尔 ok', () => {
  const e = makeEvidence({ contractId: 'abc' })
  e.checks = [{ id: 't', type: 'x', ok: 'yes' }]
  assert.ok(validateEvidence(e).some((x) => x.includes('ok 必须是布尔')))
})

// ---------- gate.js ----------
test('gate: R3 全通过 → GREEN', () => {
  const c = freezeContract({ objective: 'x', criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }] })
  const e = makeEvidence({ contractId: c.id, checks: [{ id: 'k', type: 'exec', ok: true, cmd: 'npm test' }] })
  const d = decide(c, e)
  assert.equal(d.decision, 'GREEN')
  assert.equal(d.missing.length, 0)
})
test('gate: R1 checkIds 为空 → YELLOW', () => {
  const c = freezeContract({ objective: 'x', criteria: [{ id: 'AC1', text: 't', checkIds: [] }] })
  const e = makeEvidence({ contractId: c.id, checks: [] })
  const d = decide(c, e)
  assert.equal(d.decision, 'YELLOW')
  assert.ok(d.missing.some((m) => m.includes('未绑定 checkIds')))
})
test('gate: R1 缺对应 checks → YELLOW', () => {
  const c = freezeContract({ objective: 'x', criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }] })
  const e = makeEvidence({ contractId: c.id, checks: [] })
  assert.equal(decide(c, e).decision, 'YELLOW')
})
test('gate: R2 check 失败 → RED 且 reproCmd 非空', () => {
  const c = freezeContract({ objective: 'x', criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }] })
  const e = makeEvidence({ contractId: c.id, checks: [{ id: 'k', type: 'exec', ok: false, cmd: 'npm test', detail: 'exit 1' }] })
  const d = decide(c, e)
  assert.equal(d.decision, 'RED')
  assert.ok(d.reproCmd && d.reproCmd.length > 0)
  assert.ok(d.reasons.some((r) => r.includes('npm test')))
})
test('gate: R2 失败优先于 R1 缺证据', () => {
  const c = freezeContract({ objective: 'x', criteria: [{ id: 'AC1', text: 't', checkIds: [] }, { id: 'AC2', text: 'u', checkIds: ['k'] }] })
  const e = makeEvidence({ contractId: c.id, checks: [{ id: 'k', type: 'exec', ok: false }] })
  assert.equal(decide(c, e).decision, 'RED')
})

// ---------- mini-schema（卡片 details 鸭子类型）----------
test('schema: safeParse 通过返回 data', () => {
  const s = z.object({ decision: z.enum(['GREEN', 'YELLOW', 'RED']), reasons: z.array(z.string()) })
  const r = s.safeParse({ decision: 'GREEN', reasons: ['ok'] })
  assert.equal(r.success, true)
  assert.deepEqual(r.data.reasons, ['ok'])
})
test('schema: safeParse 拒绝非法枚举', () => {
  const s = z.object({ decision: z.enum(['GREEN', 'YELLOW', 'RED']) })
  assert.equal(s.safeParse({ decision: 'PURPLE' }).success, false)
})
