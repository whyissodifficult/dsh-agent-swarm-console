/**
 * D7-2/3 + 三反证 · verify v1 流程测试（宿主无关，node --test）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyContract, verifyRun, verifyStatus, guardCaller, newStores } from '../lib/core/verify.js'
import { makeEvidence } from '../lib/core/evidence.js'

function greenPolicy(contract, input) {
  const checks = contract.criteria.flatMap((c) => c.checkIds.map((id) => ({ id, type: 'exec', ok: true, cmd: 'npm test', exitCode: 0 })))
  return makeEvidence({ contractId: contract.id, checks })
}

test('verify: contract → run（全通过）→ GREEN，status 可查', () => {
  const { contracts, runs } = newStores()
  const { contractId } = verifyContract({
    objective: '实现门禁',
    criteria: [{ id: 'AC1', text: '测试通过', checkIds: ['tests'] }],
  }, contracts)
  const r = verifyRun({ contractId, runPolicy: greenPolicy }, contracts, runs)
  assert.equal(r.decision, 'GREEN')
  assert.match(r.evidenceHash, /^[0-9a-f]{12}$/)
  const s = verifyStatus({ contractId }, runs)
  assert.equal(s.decision, 'GREEN')
  assert.ok(s.at)
})

test('反证A: criterion 缺 checkIds → YELLOW', () => {
  const { contracts, runs } = newStores()
  const { contractId } = verifyContract({
    objective: '无检查绑定',
    criteria: [{ id: 'AC1', text: '没绑 checkIds', checkIds: [] }],
  }, contracts)
  const r = verifyRun({ contractId, runPolicy: greenPolicy }, contracts, runs)
  assert.equal(r.decision, 'YELLOW')
  assert.ok(r.reasons.length > 0)
})

test('反证B: check 置 false → RED 且 reproCmd 非空', () => {
  const { contracts, runs } = newStores()
  const { contractId } = verifyContract({
    objective: '失败检查',
    criteria: [{ id: 'AC1', text: '必须过', checkIds: ['tests'] }],
  }, contracts)
  const failPolicy = (c) => makeEvidence({
    contractId: c.id,
    checks: [{ id: 'tests', type: 'exec', ok: false, cmd: 'npm test', detail: 'exit 1' }],
  })
  const r = verifyRun({ contractId, runPolicy: failPolicy }, contracts, runs)
  assert.equal(r.decision, 'RED')
  assert.ok(r.reproCmd && r.reproCmd.length > 0)
  assert.match(r.reproCmd, /npm test/)
})

test('反证C: agent 身份调 act(approve) → refused 且留拒绝事件', () => {
  const events = []
  const record = (agent, d) => events.push({ agent: agent.id, d })
  const agent = { id: 'sub-1', callId: 'call-1', session: { header: { origin: 'subagent' } } }
  const r = guardCaller(agent, record)
  assert.equal(r.status, 'refused')
  assert.equal(r.reason, 'agent-initiated-not-user')
  assert.equal(events.length, 1)
  assert.equal(events[0].d.phase, 'refused')
})

test('H3 正向: 在线根用户放行不被拒', () => {
  const events = []
  const agent = { id: 'root', session: { header: { origin: 'main' } } }
  const r = guardCaller(agent, (a, d) => events.push(d))
  assert.equal(r, null)
  assert.equal(events.length, 0)
})

test('verify_status: 未知 contractId 返回 known:false（不落三态）', () => {
  const { contracts, runs } = newStores()
  const s = verifyStatus({ contractId: 'unknown' }, runs)
  assert.deepEqual(s, { known: false })
  assert.ok(!('decision' in s), '未知契约不应返回 decision')
})

test('H1: 无 evidence 的 contract 不判 GREEN', () => {
  const { contracts, runs } = newStores()
  const { contractId } = verifyContract({
    objective: '要有证据',
    criteria: [{ id: 'AC1', text: '需证据', checkIds: ['tests'] }],
  }, contracts)
  const r = verifyRun({ contractId, evidenceInput: undefined }, contracts, runs)
  assert.notEqual(r.decision, 'GREEN')
})
