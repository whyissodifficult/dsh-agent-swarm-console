/**
 * verify 流程（0.3.0）：三态、workspaceRoot 决定 cwd、会话隔离、非法请求不抛。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { verifyContract as __verifyContract, verifyRun, verifyStatus, newStores, resolveContractId, runKey, gateFreeze } from '../lib/core/verify.js'

function verifyContract(input, sessionId = 'default', store, runStore) {
  const r = __verifyContract(input, sessionId, store, runStore)
  gateFreeze({ contractId: r.contractId, sessionId }, store, runStore)
  return r
}
import { makeEvidence } from '../lib/core/evidence.js'

const ROOT = process.cwd()

function mk(stores, extra = {}) {
  return verifyContract({
    objective: '实现门禁', workspaceRoot: ROOT,
    criteria: [{ id: 'AC1', text: '测试通过', checkIds: ['tests'] }],
    ...extra,
  }, 'default', stores.contracts, stores.runs)
}

test('contract → run（全通过）→ GREEN，status 带证据 hash', async () => {
  const s = newStores()
  const { contractId } = mk(s, { testCmd: 'npm test' })
  const r = await verifyRun({
    contractId, sessionId: 'default',
    evidenceInput: { checks: [{ id: 'tests', type: 'exec', cmd: 'npm test' }] },
    checkDeps: { exec: () => ({ status: 0, error: undefined }) },
  }, s.contracts, s.runs)
  assert.equal(r.decision, 'GREEN')
  assert.match(r.evidenceHash, /^[0-9a-f]{12}$/)
  const st = verifyStatus({ contractId, sessionId: 'default' }, s.runs)
  assert.equal(st.decision, 'GREEN')
  assert.equal(st.evidenceHash, r.evidenceHash)
})

test('反证A: criterion 缺 checkIds → YELLOW', async () => {
  const s = newStores()
  const { contractId } = verifyContract({
    objective: '无检查绑定', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: '没绑', checkIds: [] }],
  }, 'default', s.contracts, s.runs)
  const r = await verifyRun({ contractId, sessionId: 'default', evidenceInput: { checks: [] } }, s.contracts, s.runs)
  assert.equal(r.decision, 'YELLOW')
})
test('反证B: check 失败 → RED 且 reproCmd 非空', async () => {
  const s = newStores()
  const { contractId } = mk(s, { testCmd: 'npm test' })
  const r = await verifyRun({
    contractId, sessionId: 'default',
    evidenceInput: { checks: [{ id: 'tests', type: 'exec', cmd: 'npm test' }] },
    checkDeps: { exec: () => ({ status: 1, stderr: 'exit 1' }) },
  }, s.contracts, s.runs)
  assert.equal(r.decision, 'RED')
  assert.equal(r.reproCmd, 'npm test')
})
test('P1-2: type 拼错 → RED 而非抛异常', async () => {
  const s = newStores()
  const { contractId } = verifyContract({
    objective: '拼错类型', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }],
  }, 'default', s.contracts, s.runs)
  // runChecks 不再抛异常，直接调用并断言返回 RED
  const r = await verifyRun({ contractId, sessionId: 'default', evidenceInput: { checks: [{ id: 'k', type: 'file.exsits', path: 'a' }] } }, s.contracts, s.runs)
  assert.equal(r.decision, 'RED')
  assert.ok(r.reasons.some((x) => x.includes('检查请求非法') || x.includes('未知检查类型')), r.reasons.join('|'))
})
test('P0-2 反证: 同一契约在仓库根与 tmp 下运行结果一致（cwd 来自契约）', async () => {
  const s = newStores()
  const { contractId } = verifyContract({
    objective: 'cwd 无关', workspaceRoot: ROOT,
    criteria: [{ id: 'AC1', text: 'package.json 存在', checkIds: ['f'] }],
  }, 'default', s.contracts, s.runs)

  const run = () => verifyRun({
    contractId, sessionId: 'default',
    evidenceInput: { checks: [{ id: 'f', type: 'file.exists', path: 'package.json' }] },
  }, s.contracts, s.runs)

  const a = await run()
  const prev = process.cwd()
  try {
    process.chdir(tmpdir())
    const b = await run()
    assert.equal(b.decision, a.decision, '换 cwd 不应改变结论')
  } finally {
    process.chdir(prev)
  }
  assert.equal(a.decision, 'GREEN')
})
test('P1-4: 1 位前缀 → error；4 位唯一 → 成功', async () => {
  const s = newStores()
  const { contractId } = mk(s)
  assert.match(resolveContractId(contractId.slice(0, 1), 'default', s.contracts).error, /至少 4 位/)
  assert.equal(resolveContractId(contractId.slice(0, 4), 'default', s.contracts).id, contractId)
})
test('P0-3: 契约按会话隔离，runKey 一致', async () => {
  const s = newStores()
  const id = 'abcdef123456'
  verifyContract({ objective: 'a', workspaceRoot: ROOT, frozenAt: 'x' }, 's1', s.contracts, s.runs)
  verifyContract({ objective: 'b', workspaceRoot: ROOT, frozenAt: 'x' }, 's2', s.contracts, s.runs)
  assert.equal(s.contracts.size, 2)
  // 同名 id 不同会话互不可见
  assert.equal(resolveContractId(id, 's3', s.contracts).error, `未知契约 ${id}`)
  assert.equal(runKey(id, 's1'), 's1:' + id)
})
test('H1: 无 evidence 不判 GREEN', async () => {
  const s = newStores()
  const { contractId } = mk(s)
  const r = await verifyRun({ contractId, sessionId: 'default' }, s.contracts, s.runs)
  assert.notEqual(r.decision, 'GREEN')
})
test('makeEvidence 仍可用（证据结构未破坏）', async () => {
  const e = makeEvidence({ contractId: 'abc', checks: [{ id: 't', type: 'x', ok: true }] })
  assert.equal(e.status, 'verified')
})
