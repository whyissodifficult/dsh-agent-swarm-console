/**
 * 斜杠命令（0.3.0）：hash 自证、stale 语义、会话隔离。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import {
  verifyContract, verifyRun, newStores, verifyStatus,
  gateApprove, gateRetry, gateStatus, runKey, resolveContractId,
} from '../lib/core/verify.js'

const ROOT = process.cwd()
const cfg = { externalAgents: { a: { baseUrl: 'http://x', apiKeyEnv: 'K', models: ['m'] } } }

function fakeCtx(services = {}) {
  const base = {
    effect: (fn) => fn(),
    get: () => undefined,
    tools: { register: () => () => {} },
    inject: (names, cb) => {
      const sub = { ...base }
      for (const n of names) if (services[n] !== undefined) sub[n] = services[n]
      if (names.every((n) => sub[n] !== undefined)) cb(sub)
    },
  }
  return { ctx: base }
}

/** 造一条契约 + 一条指定 decision 的 run 记录，返回 {id, hash} */
function mk(s, decision = 'GREEN', sessionId = 'default', objective = '命令测试') {
  const { contractId } = verifyContract({
    objective, workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }],
  }, sessionId, s.contracts)
  const hash = 'hash-' + contractId.slice(0, 4)
  s.runs.set(runKey(contractId, sessionId), { decision, at: '2026-11-22T00:00:00Z', evidenceHash: hash })
  return { id: contractId, hash }
}

test('注册 3 条命令且 kebab-case', () => {
  const registered = new Map()
  const commands = { register: (d) => { registered.set(d.name, d); return () => {} } }
  apply(fakeCtx({ commands }).ctx, cfg)
  assert.deepEqual([...registered.keys()].sort(), ['gate-approve', 'gate-retry', 'gate-status'])
  for (const d of registered.values()) {
    assert.match(d.name, /^[a-z][a-z0-9-]*$/)
    assert.equal(typeof d.handler, 'function')
    assert.ok(d.input && typeof d.input.hint === 'string')
  }
})

test('gate-approve 对 RED 返回 error 且文案含「非 GREEN」', () => {
  const s = newStores()
  const { id, hash } = mk(s, 'RED')
  const r = gateApprove({ contractId: id, expectedHash: hash }, s.contracts, s.runs)
  assert.equal(r.kind, 'error')
  assert.match(r.text, /非 GREEN/)
})

test('P0-6: gate-approve 缺 hash → error 并提示先看 /gate-status', () => {
  const s = newStores()
  const { id } = mk(s, 'GREEN')
  const r = gateApprove({ contractId: id }, s.contracts, s.runs)
  assert.equal(r.kind, 'error')
  assert.match(r.text, /gate-status/)
  assert.match(r.text, /evidenceHash|证据/)
})

test('P0-6: hash 不一致 → 证据已过期', () => {
  const s = newStores()
  const { id } = mk(s, 'GREEN')
  const r = gateApprove({ contractId: id, expectedHash: 'tampered' }, s.contracts, s.runs)
  assert.equal(r.kind, 'error')
  assert.match(r.text, /证据已过期/)
  assert.equal(s.runs.get(runKey(id)).approved, undefined)
})

test('GREEN + 正确 hash → success，status 显示放行与证据行', () => {
  const s = newStores()
  const { id, hash } = mk(s, 'GREEN')
  const a = gateApprove({ contractId: id, expectedHash: hash }, s.contracts, s.runs)
  assert.equal(a.kind, 'success')
  const st = gateStatus({ contractId: id }, s.contracts, s.runs)
  assert.match(st.text, /已由 user 放行/)
  assert.match(st.text, new RegExp(`证据：${hash}`))
})

test('P1-1: approve → retry → approved=false 且 lastApprovedAt 存在、显示 [stale]', () => {
  const s = newStores()
  const { id, hash } = mk(s, 'GREEN')
  gateApprove({ contractId: id, expectedHash: hash }, s.contracts, s.runs)
  const r = gateRetry({ contractId: id }, s.contracts, s.runs)
  assert.equal(r.kind, 'success')
  const rec = s.runs.get(runKey(id))
  assert.equal(rec.approved, false)
  assert.equal(rec.stale, true)
  assert.ok(rec.lastApprovedAt, 'lastApprovedAt 应保留')
  assert.equal(rec.approvedAt, undefined)
  const st = gateStatus({ contractId: id }, s.contracts, s.runs)
  assert.match(st.text, /\[stale\] 上次放行已失效/)
})

test('gate-retry 刷新决定为 YELLOW 并推进时间戳', () => {
  const s = newStores()
  const { id } = mk(s, 'RED')
  s.runs.set(runKey(id), { ...s.runs.get(runKey(id)), at: '2020-01-01T00:00:00Z' })
  gateRetry({ contractId: id }, s.contracts, s.runs)
  assert.equal(s.runs.get(runKey(id)).decision, 'YELLOW')
  assert.notEqual(s.runs.get(runKey(id)).at, '2020-01-01T00:00:00Z')
})

test('gate-status 未知契约 → error；1 位前缀 → error', () => {
  const s = newStores()
  assert.match(gateStatus({ contractId: 'nope' }, s.contracts, s.runs).text, /未知契约/)
  const { id } = mk(s)
  assert.match(gateStatus({ contractId: id.slice(0, 1) }, s.contracts, s.runs).text, /至少 4 位/)
})

test('P0-3/P2-2 反证: A 会话 /gate-status 只列本会话 1 条', () => {
  const s = newStores()
  mk(s, 'GREEN', 's1', '甲的契约')
  mk(s, 'RED', 's2', '乙的契约')
  const a = gateStatus({ sessionId: 's1' }, s.contracts, s.runs)
  assert.match(a.text, /当前会话契约（1）/, a.text)
  const b = gateStatus({ sessionId: 's2' }, s.contracts, s.runs)
  assert.match(b.text, /当前会话契约（1）/, b.text)
})

test('gate-status RED 带复现命令、YELLOW 带缺失证据', () => {
  const s = newStores()
  const r1 = mk(s, 'RED')
  s.runs.set(runKey(r1.id), { ...s.runs.get(runKey(r1.id)), reproCmd: 'npm test' })
  assert.match(gateStatus({ contractId: r1.id }, s.contracts, s.runs).text, /复现：npm test/)

  const r2 = mk(s, 'YELLOW')
  s.runs.set(runKey(r2.id), { ...s.runs.get(runKey(r2.id)), missing: ['AC1: 没有对应 evidence.checks'] })
  assert.match(gateStatus({ contractId: r2.id }, s.contracts, s.runs).text, /缺失证据：/)
})

test('4 位唯一前缀可放行', () => {
  const s = newStores()
  const { id, hash } = mk(s, 'GREEN')
  const r = gateApprove({ contractId: id.slice(0, 4), expectedHash: hash }, s.contracts, s.runs)
  assert.equal(r.kind, 'success')
})

test('verify_status 返回 evidenceHash 与 stale 字段', () => {
  const s = newStores()
  const { id, hash } = mk(s, 'GREEN')
  const st = verifyStatus({ contractId: id }, s.runs)
  assert.equal(st.evidenceHash, hash)
  assert.equal(st.known, true)
  assert.equal(resolveContractId(id, 'default', s.contracts).id, id)
})
