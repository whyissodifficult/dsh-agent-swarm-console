/**
 * C · 斜杠命令门禁入口测试（宿主无关，node --test）。
 * 用假 ctx 注入 commands，并直接驱动 verify.js 的命令核心。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import {
  verifyContract, verifyRun, newStores,
  gateApprove, gateRetry, gateStatus, runKey,
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

function makeContract(stores, decision = 'GREEN', objective = '命令测试') {
  const { contractId } = verifyContract({
    objective, criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }],
  }, stores.contracts)
  stores.runs.set(runKey(contractId), { decision, at: '2026-11-21T00:00:00Z', evidenceHash: 'x' })
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
  const before = s.runs.get(runKey(id)).at
  // 用不同时间避免时钟撞车：直接改旧时间戳
  s.runs.set(runKey(id), { ...s.runs.get(runKey(id)), at: '2020-01-01T00:00:00Z' })
  const r = gateRetry({ contractId: id }, s.contracts, s.runs)
  assert.equal(r.kind, 'success')
  assert.equal(s.runs.get(runKey(id)).decision, 'YELLOW')
  assert.notEqual(s.runs.get(runKey(id)).at, '2020-01-01T00:00:00Z')
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
  // 0.2.0：checks 是请求，自报 ok 被忽略；用注入 exec 造真实失败，不真跑命令
  const run = verifyRun({
    contractId,
    evidenceInput: { checks: [{ id: 'k', type: 'exec', cmd: 'npm test' }] },
    checkDeps: { exec: () => ({ status: 1, error: undefined, stderr: 'exit 1' }) },
  }, s.contracts, s.runs)
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

// ── P0-4 · 状态正确性 ────────────────────────────────────────────────
test('P0-4: approve 后 retry → status 显示 [stale]', () => {
  const s = newStores()
  const id = makeContract(s, 'GREEN')
  assert.equal(gateApprove({ contractId: id }, s.contracts, s.runs).kind, 'success')
  assert.match(gateStatus({ contractId: id }, s.contracts, s.runs).text, /已由 user 放行/)
  gateRetry({ contractId: id }, s.contracts, s.runs)
  const st = gateStatus({ contractId: id }, s.contracts, s.runs)
  assert.match(st.text, /\[stale\]/)
  assert.match(st.text, /已过期/, '旧放行应标记为过期')
  const rec = s.runs.get(runKey(id))
  assert.equal(rec.stale, true)
  assert.equal(rec.approvedAt, undefined, 'approvedAt 应被清掉')
})

test('P0-4: 篡改 evidenceHash 后 approve 被拒（证据已过期）', () => {
  const s = newStores()
  const id = makeContract(s, 'GREEN')
  // 最近 verify_run 的 hash 是 'x'；approve 时外部带上旧 hash → 不一致
  const r = gateApprove({ contractId: id, expectedHash: 'tampered-hash' }, s.contracts, s.runs)
  assert.equal(r.kind, 'error')
  assert.match(r.text, /证据已过期，请重新 verify_run/)
  assert.equal(s.runs.get(runKey(id)).approved, undefined, '被拒时不应写入 approved')
})

test('P0-4: 同 contractId 不同 session 状态隔离', () => {
  const s = newStores()
  const id = makeContract(s, 'GREEN')
  // 给 s1 会话单独放一条 GREEN 决定（default 键由 makeContract 建）
  s.runs.set(runKey(id, 's1'), { decision: 'GREEN', at: '2026-11-21T00:00:00Z', evidenceHash: 'x' })
  gateApprove({ contractId: id, sessionId: 's1' }, s.contracts, s.runs)
  const a = gateStatus({ contractId: id, sessionId: 's1' }, s.contracts, s.runs)
  const b = gateStatus({ contractId: id, sessionId: 's2' }, s.contracts, s.runs)
  assert.match(a.text, /已由 user 放行/)
  assert.match(b.text, /尚无门禁决定|尚未放行/)
  assert.notEqual(s.runs.get(runKey(id, 's1')), s.runs.get(runKey(id, 's2')))
})

test('gate-status 无参：列出当前会话全部契约', () => {
  const s = newStores()
  const a = makeContract(s, 'GREEN', '命令测试-甲')
  const b = makeContract(s, 'RED', '命令测试-乙')
  const r = gateStatus({}, s.contracts, s.runs)
  assert.equal(r.kind, 'success')
  assert.match(r.text, /当前会话契约（2）/)
  assert.ok(r.text.includes(a) && r.text.includes(b), '两条契约都应列出')
})

test('gate-status 支持 id 前缀（唯一命中）', () => {
  const s = newStores()
  const id = makeContract(s, 'GREEN')
  const r = gateStatus({ contractId: id.slice(0, 4) }, s.contracts, s.runs)
  assert.equal(r.kind, 'success')
  assert.match(r.text, new RegExp(`契约 ${id}`))
})

test('gate-status 前缀歧义 → error 并列出候选', () => {
  const s = newStores()
  // 构造两个同前缀契约：直接往 store 塞
  s.contracts.set('abcd11111111', { contract: {} })
  s.contracts.set('abcd22222222', { contract: {} })
  const r = gateStatus({ contractId: 'abcd' }, s.contracts, s.runs)
  assert.equal(r.kind, 'error')
  assert.match(r.text, /命中多个契约/)
})

test('gate-approve 也接受前缀', () => {
  const s = newStores()
  const id = makeContract(s, 'GREEN')
  const r = gateApprove({ contractId: id.slice(0, 6) }, s.contracts, s.runs)
  assert.equal(r.kind, 'success', JSON.stringify(r))
})
