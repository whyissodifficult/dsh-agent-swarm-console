/**
 * core 三件套 + adapter 解析（0.3.0 语义）。
 * 重点覆盖：workspaceRoot 必填、policyId 不默认、空 criteria RED、reproCmd 跨平台。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { freezeContract, validateContract } from '../lib/core/contract.js'
import { makeEvidence, validateEvidence, evidenceHash } from '../lib/core/evidence.js'
import { decide } from '../lib/core/gate.js'
import * as checksModule from '../lib/core/checks.js'
import { z } from '../lib/core/mini-schema.js'

const ROOT = process.cwd()

// ---------- contract.js ----------
test('contract: 生成 12 位十六进制 id', () => {
  const c = freezeContract({ objective: '做一件事', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: '有证据', checkIds: ['t'] }] })
  assert.match(c.id, /^[0-9a-f]{12}$/)
})
test('contract: 同内容同 id', () => {
  const a = freezeContract({ objective: 'x', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }] })
  const b = freezeContract({ objective: 'x', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }] })
  assert.equal(a.id, b.id)
})
test('contract: 改 objective 换 id', () => {
  const a = freezeContract({ objective: 'x', workspaceRoot: ROOT })
  assert.notEqual(a.id, freezeContract({ objective: 'y', workspaceRoot: ROOT }).id)
})
test('contract: 缺 workspaceRoot / 相对路径 / 不存在 → throw', () => {
  assert.throws(() => freezeContract({ objective: 'x' }), /workspaceRoot 必填/)
  assert.throws(() => freezeContract({ objective: 'x', workspaceRoot: 'relative/dir' }), /必须是绝对路径/)
  assert.throws(() => freezeContract({ objective: 'x', workspaceRoot: ROOT + '/__nope__' }), /不存在/)
})
test('contract: 空 objective → throw', () => {
  assert.throws(() => freezeContract({ objective: '', workspaceRoot: ROOT }), /objective/)
})
test('P0-1 前提: policyId 不再默认填充', () => {
  const c = freezeContract({ objective: 'x', workspaceRoot: ROOT })
  assert.equal(c.policyId, undefined)
  const d = freezeContract({ objective: 'x', workspaceRoot: ROOT, policyId: 'code-change' })
  assert.equal(d.policyId, 'code-change')
})
test('contract: validateContract 拦住缺 checkIds', () => {
  const errs = validateContract({ id: 'abc123456789', objective: 'x', constraints: [], workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't' }] })
  assert.ok(errs.some((e) => e.includes('checkIds')))
})

// ---------- evidence.js ----------
test('evidence: E2 + verified', () => {
  const e = makeEvidence({ contractId: 'abc', checks: [{ id: 't', type: 'exec', ok: true, cmd: 'npm test', exitCode: 0 }] })
  assert.equal(e.level, 'E2')
  assert.equal(e.status, 'verified')
})
test('evidence: 无 checks → E0 + partial', () => {
  const e = makeEvidence({ contractId: 'abc' })
  assert.equal(e.level, 'E0')
  assert.equal(e.status, 'partial')
})
test('evidence: failed 由失败 check 推断', () => {
  const e = makeEvidence({ contractId: 'abc', checks: [{ id: 't', type: 'exec', ok: false, cmd: 'npm test' }] })
  assert.equal(e.status, 'failed')
})
test('evidence: hash 稳定且随内容变化', () => {
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
test('gate: 全通过 → GREEN', () => {
  const c = freezeContract({ objective: 'x', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }] })
  const e = makeEvidence({ contractId: c.id, checks: [{ id: 'k', type: 'exec', ok: true, cmd: 'npm test' }] })
  assert.equal(decide(c, e).decision, 'GREEN')
})
test('P0-1: criteria=[] → RED 且理由含「不可判通过」', () => {
  const c = freezeContract({ objective: 'x', workspaceRoot: ROOT, criteria: [] })
  const d = decide(c, makeEvidence({ contractId: c.id, checks: [] }))
  assert.equal(d.decision, 'RED')
  assert.ok(d.reasons.some((r) => r.includes('不可判通过')))
})
test('gate: checkIds 为空 → YELLOW', () => {
  const c = freezeContract({ objective: 'x', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't', checkIds: [] }] })
  const d = decide(c, makeEvidence({ contractId: c.id, checks: [] }))
  assert.equal(d.decision, 'YELLOW')
  assert.ok(d.missing.some((m) => m.includes('未绑定 checkIds')))
})
test('gate: 缺对应 checks → YELLOW', () => {
  const c = freezeContract({ objective: 'x', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }] })
  assert.equal(decide(c, makeEvidence({ contractId: c.id, checks: [] })).decision, 'YELLOW')
})
test('gate: check 失败 → RED，reproCmd 取 cmd', () => {
  const c = freezeContract({ objective: 'x', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }] })
  const e = makeEvidence({ contractId: c.id, checks: [{ id: 'k', type: 'exec', ok: false, cmd: 'npm test', detail: 'exit 1' }] })
  const d = decide(c, e)
  assert.equal(d.decision, 'RED')
  assert.equal(d.reproCmd, 'npm test')
})
test('gate: 失败优先于缺证据', () => {
  const c = freezeContract({ objective: 'x', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't', checkIds: [] }, { id: 'AC2', text: 'u', checkIds: ['k'] }] })
  const e = makeEvidence({ contractId: c.id, checks: [{ id: 'k', type: 'file.exists', ok: false }] })
  assert.equal(decide(c, e).decision, 'RED')
})
test('P1-3: file.exists 的 reproCmd 用 node -e，跨平台退出非 0', () => {
  const c = freezeContract({ objective: 'x', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't', checkIds: ['k1'] }] })
  const e = makeEvidence({
    contractId: c.id,
    checks: [{ id: 'k1', type: 'file.exists', ok: false, path: 'no-such-file-xyz', absPath: ROOT + '/no-such-file-xyz' }],
  })
  const d = decide(c, e)
  assert.equal(d.decision, 'RED')
  assert.ok(d.reproCmd.includes('node -e'), '应是 node -e 命令')
  assert.ok(!d.reproCmd.trim().startsWith('#'))
  const m = d.reproCmd.match(/^node -e "([\s\S]*)" "(.+)"$/)
  assert.ok(m, '命令形状应可解析')
  const r = spawnSync(process.execPath, ['-e', m[1].replace(/\\"/g, '"'), m[2]], { encoding: 'utf8' })
  assert.equal(r.error, undefined)
  assert.notEqual(r.status, 0)
})

// ---------- mini-schema ----------
test('schema: safeParse 通过 / 拒绝非法枚举', () => {
  const s = z.object({ decision: z.enum(['GREEN', 'YELLOW', 'RED']), reasons: z.array(z.string()) })
  assert.equal(s.safeParse({ decision: 'GREEN', reasons: ['ok'] }).success, true)
  assert.equal(s.safeParse({ decision: 'PURPLE' }).success, false)
})

// ---------- P1-4 / P2-4 adapter ----------
test('P1-4: 两个 json 块取后者', async () => {
  const { parsePlanFromOutput } = await import('../lib/adapter.js')
  const out = ['```json', '{"plan":[{"title":"旧"}]}', '```', '中间', '```json', '{"plan":[{"title":"新"},{"title":"收尾"}]}', '```'].join('\n')
  assert.deepEqual(parsePlanFromOutput(out), [{ title: '新' }, { title: '收尾' }])
})
test('P1-4: buildPrompt 不再内嵌示例 plan', async () => {
  const { buildPrompt } = await import('../lib/adapter.js')
  const p = buildPrompt({ task: 'x', outlinePlan: true })
  assert.ok(!p.includes('第一步'))
  assert.match(p, /json 代码块|json 块|plan 数组/)
})
test('P2-4: parseResult 只取 RESULT 后第一行', async () => {
  const { parseResult } = await import('../lib/adapter.js')
  assert.equal(parseResult('RESULT: ok\n补充说明\n更多'), 'ok')
})

test('H2: file.exists 复现命令用绝对路径（换 cwd 也指向同一文件）', () => {
  const ws = process.cwd().replace(/\\/g, '/')
  const c = freezeContract({ objective: 'x', workspaceRoot: ws, criteria: [{ id: 'AC1', text: 't', checkIds: ['k1'] }] })
  const { runChecks } = require_checks()
  const { checks } = runChecks([{ id: 'k1', type: 'file.exists', path: 'no/such/file.txt' }], { workspaceRoot: ws })
  const e = makeEvidence({ contractId: c.id, checks })
  const d = decide(c, e)
  assert.equal(d.decision, 'RED')
  const norm = (v) => String(v).split('\\').join('/')
  assert.ok(norm(d.reproCmd).includes(norm(ws)), '复现命令必须含绝对路径 ' + ws)
  const r = spawnSync(d.reproCmd, { shell: true, encoding: 'utf8' })
  if (r.error === undefined) assert.notEqual(r.status, 0, '文件不存在时应退出非 0')
})

function require_checks() {
  return checksModule
}

test('H2: exec 被白名单拒绝时，复现命令不是那条被拒的命令', () => {
  const ws = process.cwd().replace(/\\/g, '/')
  const c = freezeContract({ objective: 'x', workspaceRoot: ws, criteria: [{ id: 'AC1', text: 't', checkIds: ['k1'] }] })
  const { checks } = checksModule.runChecks([{ id: 'k1', type: 'exec', cmd: 'exit 0' }], { workspaceRoot: ws })
  const d = decide(c, makeEvidence({ contractId: c.id, checks }))
  assert.equal(d.decision, 'RED')
  assert.ok(!/复现：exit 0/.test('复现：' + d.reproCmd), '不能把被拒命令当复现：' + d.reproCmd)
  assert.match(d.reproCmd, /exit 1/, '应是可执行且退出非 0 的提示命令')
})
