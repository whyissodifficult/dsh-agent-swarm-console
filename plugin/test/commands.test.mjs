/**
 * C · 斜杠命令门禁入口测试（宿主无关，node --test）。
 * 用假 ctx 注入 commands，并直接驱动 verify.js 的命令核心。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import {
  verifyContract, verifyRun, newStores,
  gateApprove, gateRetry, gateStatus,
} from '../lib/core/verify.js'

const cfg = { externalAgents: { a: { baseUrl: 'http://x', apiKeyEnv: 'K', models: ['m'] } } }

function fakeCtx(services = {}) {
  const registered = new Map()
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
  return { ctx: base, registered }
}

function makeContract(stores, decision = 'GREEN') {
  const { contractId } = verifyContract({
    objective: '命令测试', criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }],
  }, stores.contracts)
  stores.runs.set(contractId, { decision, at: '2026-11-21T00:00:00Z', evidenceHash: 'x' })
  return contractId
}

test('注册出 3 条命令且名字正确（kebab-case 不带斜杠）', () => {
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

test('gate-approve 对 RED 返回 error 且文案含“非 GREEN”', () => {
  const s = newStores()
  const id = makeContract(s, 'RED')
  const r = gateApprove({ contractId: id }, s.contracts, s.runs)
  assert.equal(r.kind, 'error')
  assert.match(r.text, /非 GREEN/)
})

test('gate-approve 对 GREEN success，随后 gate-status 显示 approved', () => {
  const s = newStores()
  const id = makeContract(s, 'GREEN')
  const a = gateApprove({ contractId: id }, s.contracts, s.runs)
  assert.equal(a.kind, 'success')
  assert.match(a.text, /放行/)
  const st = gateStatus({ contractId: id }, s.contracts, s.runs)
  assert.equal(st.kind, 'success')
  assert.match(st.text, /已由 user 放行/)
})

test('gate-retry 更新 decision 时间戳（空证据重算为 YELLOW）', () => {
  const s = newStores()
  const id = makeContract(s, 'RED')
  const before = s.runs.get(id).at
  // 用不同时间避免时钟撞车：直接改旧时间戳
  s.runs.set(id, { ...s.runs.get(id), at: '2020-01-01T00:00:00Z' })
  const r = gateRetry({ contractId: id }, s.contracts, s.runs)
  assert.equal(r.kind, 'success')
  assert.equal(s.runs.get(id).decision, 'YELLOW')
  assert.notEqual(s.runs.get(id).at, '2020-01-01T00:00:00Z')
  assert.match(r.text, /需重新执行 verify_run 补证据/)
})

test('gate-status 对未知 contractId 返回 error', () => {
  const s = newStores()
  const r = gateStatus({ contractId: 'nope' }, s.contracts, s.runs)
  assert.equal(r.kind, 'error')
  assert.match(r.text, /未知契约/)
})

test('gate-status 在 RED 时带复现命令（H2 可见性）', () => {
  const s = newStores()
  const { contractId } = verifyContract({
    objective: 'H2 可见性', criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }],
  }, s.contracts)
  const run = verifyRun({ contractId, evidenceInput: { checks: [{ id: 'k', type: 'exec', ok: false, cmd: 'npm test' }] } }, s.contracts, s.runs)
  assert.equal(run.decision, 'RED')
  const st = gateStatus({ contractId }, s.contracts, s.runs)
  assert.equal(st.kind, 'success')
  assert.match(st.text, /RED/)
  assert.match(st.text, /复现：npm test/, 'RED 的 gate-status 必须把复现命令亮出来')
})

test('gate-status 在 YELLOW 时带缺失证据（H1 可见性）', () => {
  const s = newStores()
  const { contractId } = verifyContract({
    objective: 'H1 可见性', criteria: [{ id: 'AC1', text: '缺绑定的验收条件' }],
  }, s.contracts)
  verifyRun({ contractId, evidenceInput: { checks: [] } }, s.contracts, s.runs)
  const st = gateStatus({ contractId }, s.contracts, s.runs)
  assert.equal(st.kind, 'success')
  assert.match(st.text, /YELLOW/)
  assert.match(st.text, /缺失证据：/, 'YELLOW 的 gate-status 必须列出缺失证据')
})
