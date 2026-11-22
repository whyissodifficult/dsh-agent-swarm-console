/**
 * 0.4.0 · 契约确认机制 + 异步 exec。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyContract, verifyRun, verifyStatus, newStores, gateFreeze, gateStatus, runKey } from '../lib/core/verify.js'
import { runChecks } from '../lib/core/checks.js'

const ROOT = process.cwd()
const okExec = { exec: () => ({ status: 0, error: undefined }) }

function mk(s, sessionId = 'default', extra = {}) {
  return verifyContract({
    objective: '确认机制', workspaceRoot: ROOT, testCmd: 'npm test',
    criteria: [{ id: 'AC1', text: '测试通过', checkIds: ['tests'] }],
    ...extra,
  }, sessionId, s.contracts, s.runs)
}

test('未确认时 verify_run → RED，且不写 evidence', async () => {
  const s = newStores()
  const { contractId } = mk(s)
  const r = await verifyRun({
    contractId, evidenceInput: { checks: [{ id: 'tests', type: 'exec', cmd: 'npm test' }] }, checkDeps: okExec,
  }, s.contracts, s.runs)
  assert.equal(r.decision, 'RED')
  assert.match(r.reasons.join(' '), /尚未由用户确认/)
  assert.equal(r.evidenceHash, '')
  // 只有 pending 记录，没有任何 decision/evidence
  assert.equal(s.runs.get(runKey(contractId)).decision, undefined)
})

test('gate-freeze 后 verify_run → 正常三态（GREEN）', async () => {
  const s = newStores()
  const { contractId } = mk(s)
  const f = gateFreeze({ contractId }, s.contracts, s.runs)
  assert.equal(f.kind, 'success')
  const r = await verifyRun({
    contractId, evidenceInput: { checks: [{ id: 'tests', type: 'exec', cmd: 'npm test' }] }, checkDeps: okExec,
  }, s.contracts, s.runs)
  assert.equal(r.decision, 'GREEN')
  assert.match(r.evidenceHash, /^[0-9a-f]{12}$/)
})

test('重复 freeze → 提示无需重复', () => {
  const s = newStores()
  const { contractId } = mk(s)
  gateFreeze({ contractId }, s.contracts, s.runs)
  const again = gateFreeze({ contractId }, s.contracts, s.runs)
  assert.equal(again.kind, 'success')
  assert.match(again.text, /无需重复/)
})

test('确认不改契约哈希（确认是状态不是内容）', () => {
  const s = newStores()
  const { contractId } = mk(s)
  const before = s.contracts.get('default:' + contractId).contract.id
  gateFreeze({ contractId }, s.contracts, s.runs)
  const after = s.contracts.get('default:' + contractId).contract.id
  assert.equal(after, before)
})

test('跨会话：A 确认后，B 的 verify_run 仍判未确认', async () => {
  const s = newStores()
  // 两个会话各冻结同一份契约（id 相同），只在 A 确认
  const { contractId } = mk(s, 'sA')
  mk(s, 'sB')
  gateFreeze({ contractId, sessionId: 'sA' }, s.contracts, s.runs)
  // A 可以跑
  const a = await verifyRun({ contractId, sessionId: 'sA',
    evidenceInput: { checks: [{ id: 'tests', type: 'exec', cmd: 'npm test' }] }, checkDeps: okExec }, s.contracts, s.runs)
  assert.equal(a.decision, 'GREEN')
  const r = await verifyRun({ contractId, sessionId: 'sB',
    evidenceInput: { checks: [{ id: 'tests', type: 'exec', cmd: 'npm test' }] }, checkDeps: okExec }, s.contracts, s.runs)
  assert.equal(r.decision, 'RED')
  assert.match(r.reasons.join(' '), /尚未由用户确认/)
})

test('gate-status：待确认 / 已确认 两种文案', () => {
  const s = newStores()
  const { contractId } = mk(s)
  assert.match(gateStatus({ contractId }, s.contracts, s.runs).text, /待确认/)
  gateFreeze({ contractId }, s.contracts, s.runs)
  assert.match(gateStatus({ contractId }, s.contracts, s.runs).text, /已确认/)
  const st = verifyStatus({ contractId }, s.runs)
  assert.equal(st.confirmed, true)
  assert.ok(st.confirmedAt)
})

test('0.4.0 异步：runChecks 返回 Promise，且等待期间事件循环不被阻塞', async () => {
  let ticked = false
  const p = runChecks([{ id: 'e', type: 'exec', cmd: 'slow' }], {
    workspaceRoot: ROOT,
    testCmd: 'slow',
    // 模拟 100ms 异步执行（同步实现会阻塞事件循环）
    exec: () => new Promise((resolve) => setTimeout(() => resolve({ status: 0, error: undefined }), 100)),
  })
  assert.ok(p instanceof Promise, 'runChecks 必须返回 Promise')
  setTimeout(() => { ticked = true }, 20)
  const r = await p
  assert.equal(r.checks[0].ok, true)
  assert.equal(ticked, true, '等待 exec 期间事件循环应继续运转')
})
