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
import { verifyContract, verifyRun, verifyStatus, newStores, gateFreeze, gateStatus, gateHistory } from '../lib/core/verify.js'
import { z } from '../lib/core/mini-schema.js'

const ROOT = process.cwd()

// ---------- contract.js ----------
test('contract: 生成 12 位十六进制 id', async () => {
  const c = freezeContract({ objective: '做一件事', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: '有证据', checkIds: ['t'] }] })
  assert.match(c.id, /^[0-9a-f]{12}$/)
})
test('contract: 同内容同 id', async () => {
  const a = freezeContract({ objective: 'x', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }] })
  const b = freezeContract({ objective: 'x', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }] })
  assert.equal(a.id, b.id)
})
test('contract: 改 objective 换 id', async () => {
  const a = freezeContract({ objective: 'x', workspaceRoot: ROOT })
  assert.notEqual(a.id, freezeContract({ objective: 'y', workspaceRoot: ROOT }).id)
})
test('contract: 缺 workspaceRoot / 相对路径 / 不存在 → throw', async () => {
  assert.throws(() => freezeContract({ objective: 'x' }), /workspaceRoot 必填/)
  assert.throws(() => freezeContract({ objective: 'x', workspaceRoot: 'relative/dir' }), /必须是绝对路径/)
  assert.throws(() => freezeContract({ objective: 'x', workspaceRoot: ROOT + '/__nope__' }), /不存在/)
})
test('contract: 空 objective → throw', async () => {
  assert.throws(() => freezeContract({ objective: '', workspaceRoot: ROOT }), /objective/)
})
test('P0-1 前提: policyId 不再默认填充', async () => {
  const c = freezeContract({ objective: 'x', workspaceRoot: ROOT })
  assert.equal(c.policyId, undefined)
  const d = freezeContract({ objective: 'x', workspaceRoot: ROOT, policyId: 'code-change' })
  assert.equal(d.policyId, 'code-change')
})
test('contract: validateContract 拦住缺 checkIds', async () => {
  const errs = validateContract({ id: 'abc123456789', objective: 'x', constraints: [], workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't' }] })
  assert.ok(errs.some((e) => e.includes('checkIds')))
})

// ---------- evidence.js ----------
test('evidence: E2 + verified', async () => {
  const e = makeEvidence({ contractId: 'abc', checks: [{ id: 't', type: 'exec', ok: true, cmd: 'npm test', exitCode: 0 }] })
  assert.equal(e.level, 'E2')
  assert.equal(e.status, 'verified')
})
test('evidence: 无 checks → E0 + partial', async () => {
  const e = makeEvidence({ contractId: 'abc' })
  assert.equal(e.level, 'E0')
  assert.equal(e.status, 'partial')
})
test('evidence: failed 由失败 check 推断', async () => {
  const e = makeEvidence({ contractId: 'abc', checks: [{ id: 't', type: 'exec', ok: false, cmd: 'npm test' }] })
  assert.equal(e.status, 'failed')
})
test('evidence: hash 稳定且随内容变化', async () => {
  const a = makeEvidence({ contractId: 'abc', checks: [{ id: 't', type: 'x', ok: true }] })
  const b = makeEvidence({ contractId: 'abc', checks: [{ id: 't', type: 'x', ok: false }] })
  assert.match(evidenceHash(a), /^[0-9a-f]{12}$/)
  assert.notEqual(evidenceHash(a), evidenceHash(b))
})
test('evidence: validateEvidence 拦住非布尔 ok', async () => {
  const e = makeEvidence({ contractId: 'abc' })
  e.checks = [{ id: 't', type: 'x', ok: 'yes' }]
  assert.ok(validateEvidence(e).some((x) => x.includes('ok 必须是布尔')))
})

// ---------- gate.js ----------
test('gate: 全通过 → GREEN', async () => {
  const c = freezeContract({ objective: 'x', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }] })
  const e = makeEvidence({ contractId: c.id, checks: [{ id: 'k', type: 'exec', ok: true, cmd: 'npm test' }] })
  assert.equal(decide(c, e).decision, 'GREEN')
})
test('P0-1: criteria=[] → RED 且理由含「不可判通过」', async () => {
  const c = freezeContract({ objective: 'x', workspaceRoot: ROOT, criteria: [] })
  const d = decide(c, makeEvidence({ contractId: c.id, checks: [] }))
  assert.equal(d.decision, 'RED')
  assert.ok(d.reasons.some((r) => r.includes('不可判通过')))
})
test('gate: checkIds 为空 → YELLOW', async () => {
  const c = freezeContract({ objective: 'x', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't', checkIds: [] }] })
  const d = decide(c, makeEvidence({ contractId: c.id, checks: [] }))
  assert.equal(d.decision, 'YELLOW')
  assert.ok(d.missing.some((m) => m.includes('未绑定 checkIds')))
})
test('gate: 缺对应 checks → YELLOW', async () => {
  const c = freezeContract({ objective: 'x', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }] })
  assert.equal(decide(c, makeEvidence({ contractId: c.id, checks: [] })).decision, 'YELLOW')
})
test('gate: check 失败 → RED，reproCmd 取 cmd', async () => {
  const c = freezeContract({ objective: 'x', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't', checkIds: ['k'] }] })
  const e = makeEvidence({ contractId: c.id, checks: [{ id: 'k', type: 'exec', ok: false, cmd: 'npm test', detail: 'exit 1' }] })
  const d = decide(c, e)
  assert.equal(d.decision, 'RED')
  assert.equal(d.reproCmd, 'npm test')
})
test('gate: 失败优先于缺证据', async () => {
  const c = freezeContract({ objective: 'x', workspaceRoot: ROOT, criteria: [{ id: 'AC1', text: 't', checkIds: [] }, { id: 'AC2', text: 'u', checkIds: ['k'] }] })
  const e = makeEvidence({ contractId: c.id, checks: [{ id: 'k', type: 'file.exists', ok: false }] })
  assert.equal(decide(c, e).decision, 'RED')
})
test('P1-3: file.exists 的 reproCmd 用 node -e，跨平台退出非 0', async () => {
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
test('schema: safeParse 通过 / 拒绝非法枚举', async () => {
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

test('H2: file.exists 复现命令用绝对路径（换 cwd 也指向同一文件）', async () => {
  const ws = process.cwd().replace(/\\/g, '/')
  const c = freezeContract({ objective: 'x', workspaceRoot: ws, criteria: [{ id: 'AC1', text: 't', checkIds: ['k1'] }] })
  const { runChecks } = require_checks()
  const { checks } = await runChecks([{ id: 'k1', type: 'file.exists', path: 'no/such/file.txt' }], { workspaceRoot: ws })
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

test('H2: exec 被白名单拒绝时，复现命令不是那条被拒的命令', async () => {
  const ws = process.cwd().replace(/\\/g, '/')
  const c = freezeContract({ objective: 'x', workspaceRoot: ws, criteria: [{ id: 'AC1', text: 't', checkIds: ['k1'] }] })
  const { checks } = await checksModule.runChecks([{ id: 'k1', type: 'exec', cmd: 'exit 0' }], { workspaceRoot: ws })
  const d = decide(c, makeEvidence({ contractId: c.id, checks }))
  assert.equal(d.decision, 'RED')
  assert.ok(!/复现：exit 0/.test('复现：' + d.reproCmd), '不能把被拒命令当复现：' + d.reproCmd)
  assert.match(d.reproCmd, /exit 1/, '应是可执行且退出非 0 的提示命令')
})

test('P0-A: file.exists 越出 workspaceRoot → RED', async () => {
  const { checks } = await checksModule.runChecks(
    [{ id: 'k1', type: 'file.exists', path: '../outside.txt' }],
    { workspaceRoot: process.cwd() })
  const c = freezeContract({ objective: 'x', workspaceRoot: process.cwd().replace(/\\/g, '/'),
    criteria: [{ id: 'AC1', text: 't', checkIds: ['k1'] }] })
  const d = decide(c, makeEvidence({ contractId: c.id, checks }))
  assert.equal(d.decision, 'RED')
  assert.match(d.reasons.join(''), /越出 workspaceRoot/)
})

test('P1-B: 未知 policyId → RED 且不泄露内部路径', async () => {
  const s = newStores()
  const { contractId } = verifyContract({ objective: 'x', policyId: 'nope',
    workspaceRoot: process.cwd().replace(/\\/g, '/'),
    criteria: [{ id: 'c1', text: 't', checkIds: ['tests'] }] }, 'default', s.contracts, s.runs)
  gateFreeze({ contractId, sessionId: 'default', confirm: true}, s.contracts, s.runs)
  const r = await verifyRun({ contractId, usePolicy: true }, s.contracts, s.runs)
  assert.equal(r.decision, 'RED')
  const text = r.reasons.join(' ')
  assert.match(text, /未知策略/)
  assert.ok(!/[A-Za-z]:\\/.test(text), '不得包含绝对路径：' + text)
})

test('P0: 刚 freeze、还没 verify_run 时 verifyStatus 可 JSON 序列化（无 undefined）', () => {
  const s = newStores()
  const { contractId } = verifyContract({ objective: 'x', workspaceRoot: process.cwd().replace(/\\/g, '/'),
    criteria: [{ id: 'c1', text: 't', checkIds: ['k1'] }] }, 'default', s.contracts, s.runs)
  gateFreeze({ contractId, confirm: true}, s.contracts, s.runs)
  const st = verifyStatus({ contractId }, s.runs)
  assert.equal(st.confirmed, true, JSON.stringify(st))
  // 关键：不能有「值为 undefined 的自有属性」——宿主序列化会因此报 not lossless JSON
  const bad = Object.entries(st).filter(([, v]) => v === undefined).map(([k]) => k)
  assert.deepEqual(bad, [], '这些字段值为 undefined：' + bad.join(', '))
  assert.equal('decision' in st, false, '尚未跑过时不应带 decision 字段')
})

test('P0-B: 符号链接/junction 指向工作区外 → RED（注入 realpath，不依赖系统权限）', async () => {
  // 用注入的 realpath 模拟「词法路径在 workspaceRoot 内、真实路径在外面」，避免 Windows 建链接权限问题
  const root = process.platform === 'win32' ? 'C:/ws' : '/ws'
  const { checks } = await checksModule.runChecks(
    [{ id: 'k1', type: 'file.exists', path: 'link/secret.txt' }],
    {
      workspaceRoot: root,
      existsSync: () => true,
      realpathSync: (p) => {
        const norm = (x) => x.replace(/[\\/]/g, '/').toLowerCase()
        if (norm(p) === norm(root)) return root
        return process.platform === 'win32' ? 'C:/outside/secret.txt' : '/outside/secret.txt'
      },
    })
  assert.equal(checks[0].ok, false, JSON.stringify(checks[0]))
  assert.match(checks[0].detail, /符号链接/, checks[0].detail)
})

test('P0-E: /gate-freeze 不带 --yes 只回显契约全文，不确认', () => {
  const s = newStores()
  const { contractId } = verifyContract({
    objective: '市场调研报告', workspaceRoot: process.cwd().replace(/\\\\/g, '/'),
    testCmd: 'npm test', testTimeoutMs: 60000, policyId: 'code-change',
    criteria: [{ id: 'c1', text: '报告完成', checkIds: ['tests'] }],
  }, 'default', s.contracts, s.runs)
  const preview = gateFreeze({ contractId }, s.contracts, s.runs)
  assert.equal(preview.kind, 'success')
  assert.match(preview.text, /市场调研报告/, '应回显 objective')
  assert.match(preview.text, /workspaceRoot|工作区/, '应回显 workspaceRoot')
  assert.match(preview.text, /npm test/, '应回显 testCmd')
  assert.match(preview.text, /--yes/, '应提示再次确认')
  assert.notEqual(verifyStatus({ contractId }, s.runs).confirmed, true, '未带 --yes 不应确认')
  const done = gateFreeze({ contractId, confirm: true }, s.contracts, s.runs)
  assert.match(done.text, /已由用户确认/)
  assert.equal(verifyStatus({ contractId }, s.runs).confirmed, true)
})

test('P1-A: 契约 testTimeoutMs 生效（超时按契约值终止，不是写死 10s）', async () => {
  const s = newStores()
  const { contractId } = verifyContract({
    objective: 'x', workspaceRoot: process.cwd().replace(/\\\\/g, '/'),
    testCmd: 'node -e "setTimeout(()=>{},3000)"', testTimeoutMs: 1200,
    criteria: [{ id: 'c1', text: 't', checkIds: ['tests'] }],
  }, 'default', s.contracts, s.runs)
  gateFreeze({ contractId, confirm: true }, s.contracts, s.runs)
  const started = Date.now()
  const r = await verifyRun({
    contractId,
    evidenceInput: { checks: [{ id: 'tests', type: 'exec', cmd: 'node -e "setTimeout(()=>{},3000)"' }] },
  }, s.contracts, s.runs)
  const elapsed = Date.now() - started
  assert.equal(r.decision, 'RED')
  assert.ok(elapsed < 2500, `应在 ~1200ms 被终止，实际 ${elapsed}ms`)
  assert.match(r.reasons.join(' '), /执行超时（1200ms）/, r.reasons.join(' '))
})

test('P1-B: 未确认时的 RED 会写状态，status 不显示 undefined', async () => {
  const s = newStores()
  const { contractId } = verifyContract({
    objective: 'x', workspaceRoot: process.cwd().replace(/\\\\/g, '/'),
    criteria: [{ id: 'c1', text: 't', checkIds: ['k1'] }],
  }, 'default', s.contracts, s.runs)
  await verifyRun({ contractId, evidenceInput: { checks: [] } }, s.contracts, s.runs)
  const st = verifyStatus({ contractId }, s.runs)
  assert.equal(st.decision, 'RED')
  const txt = gateStatus({ contractId }, s.contracts, s.runs).text
  assert.ok(!txt.includes('undefined'), txt)
})

test('Android/Termux: 无可用 shell → env-unavailable，门禁 YELLOW（不是 RED）', async () => {
  const root = process.cwd().replace(/\\\\/g, '/')
  const { checks } = await checksModule.runChecks(
    [{ id: 'k1', type: 'exec', cmd: 'npm test' }],
    { workspaceRoot: root, testCmd: 'npm test', resolveShell: () => null })
  assert.equal(checks[0].envUnavailable, true, JSON.stringify(checks[0]))
  assert.match(checks[0].detail, /无可用 shell/, checks[0].detail)
  const c = freezeContract({ objective: 'x', workspaceRoot: root, testCmd: 'npm test',
    criteria: [{ id: 'c1', text: 't', checkIds: ['k1'] }] })
  const d = decide(c, makeEvidence({ contractId: c.id, checks }))
  assert.equal(d.decision, 'YELLOW', d.decision)
  assert.match(d.reasons.join(' '), /环境限制|未能执行/, d.reasons.join(' '))
})

test('Android/Termux: 显式 shell 可用 → exec 正常执行并取 exitCode', async () => {
  const root = process.cwd().replace(/\\\\/g, '/')
  const shell = process.env.ComSpec || '/bin/sh'
  const { checks } = await checksModule.runChecks(
    [{ id: 'k1', type: 'exec', cmd: 'node -e "process.exit(0)"' }],
    { workspaceRoot: root, testCmd: 'node -e "process.exit(0)"', resolveShell: () => shell })
  assert.equal(checks[0].ok, true, JSON.stringify(checks[0]))
  assert.equal(checks[0].exitCode, 0)
  assert.equal(checks[0].envUnavailable, undefined)
})

test('环境不可用 + 真实失败并存 → 仍判 RED（真实失败优先）', async () => {
  const root = process.cwd().replace(/\\\\/g, '/')
  const c = freezeContract({ objective: 'x', workspaceRoot: root,
    criteria: [{ id: 'c1', text: 't', checkIds: ['k1', 'k2'] }] })
  const d = decide(c, makeEvidence({ contractId: c.id, checks: [
    { id: 'k1', type: 'exec', ok: false, envUnavailable: true, detail: '当前环境无可用 shell' },
    { id: 'k2', type: 'file.exists', ok: false, path: 'nope.txt', absPath: root + '/nope.txt' },
  ] }))
  assert.equal(d.decision, 'RED', d.decision)
})

test('0.6.0 持久化：写盘后重新打开能读到契约与判定', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { openPersistentStores } = await import('../lib/core/store.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-state-'))
  const file = path.join(dir, 'state.json')

  // 第一个进程：冻结 → 确认 → 跑检查
  const a = openPersistentStores(file)
  const { contractId } = verifyContract({
    objective: 'x', workspaceRoot: process.cwd().replace(/\\\\/g, '/'),
    criteria: [{ id: 'c1', text: 't', checkIds: ['k1'] }],
  }, 'default', a.contracts, a.runs)
  gateFreeze({ contractId, confirm: true }, a.contracts, a.runs)
  await verifyRun({ contractId, evidenceInput: { checks: [{ id: 'k1', type: 'file.exists', path: 'package.json' }] } }, a.contracts, a.runs)
  a.close()
  assert.equal(fs.existsSync(file), true, '状态文件应已写出')

  // 第二个进程：只打开文件，不重跑任何东西
  const b = openPersistentStores(file)
  const st = verifyStatus({ contractId }, b.runs)
  assert.equal(st.known, true, '重启后契约状态应可读')
  assert.equal(st.confirmed, true)
  assert.ok(st.decision, '重启后应有最近决定')
  assert.ok(st.evidenceHash, '重启后应保留证据 hash')
  const status = gateStatus({ contractId }, b.contracts, b.runs)
  assert.equal(status.kind, 'success', JSON.stringify(status).slice(0, 120))
  b.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('0.6.0 持久化：状态文件损坏 → 空状态启动且不抛', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { openPersistentStores } = await import('../lib/core/store.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-bad-'))
  const file = path.join(dir, 'state.json')
  fs.writeFileSync(file, '{ 这不是 JSON', 'utf8')
  const s = openPersistentStores(file)
  assert.equal(s.contracts.size, 0)
  assert.match(s.warnings.join(' '), /读取失败/, s.warnings.join(' '))
  s.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('0.6.0 持久化：超过上限按最旧淘汰', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { openPersistentStores } = await import('../lib/core/store.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-cap-'))
  const file = path.join(dir, 'state.json')
  const s = openPersistentStores(file)
  for (let i = 0; i < 620; i++) s.contracts.set('k' + i, { i })
  assert.equal(s.contracts.size, 500, '应裁到 500 条')
  assert.equal(s.contracts.has('k0'), false, '最旧的应被淘汰')
  assert.equal(s.contracts.has('k619'), true, '最新的应保留')
  s.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('0.6.1: 以 .. 开头的合法文件名不被误判越界（真 bug 回归）', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dotdot-'))
  fs.writeFileSync(path.join(root, '..foo'), 'x')
  fs.mkdirSync(path.join(root, '..dir'))
  fs.writeFileSync(path.join(root, '..dir', 'inside.txt'), 'x')

  const { checks } = await checksModule.runChecks(
    [{ id: 'k1', type: 'file.exists', path: '..foo' },
     { id: 'k2', type: 'file.exists', path: '..dir/inside.txt' }],
    { workspaceRoot: root })
  assert.equal(checks[0].ok, true, JSON.stringify(checks[0]))
  assert.equal(checks[1].ok, true, JSON.stringify(checks[1]))

  // 真越界仍然要拦
  const out = await checksModule.runChecks(
    [{ id: 'k3', type: 'file.exists', path: '../escape.txt' }], { workspaceRoot: root })
  assert.equal(out.checks[0].ok, false, JSON.stringify(out.checks[0]))
  assert.match(out.checks[0].detail, /越出 workspaceRoot/)
  fs.rmSync(root, { recursive: true, force: true })
})

test('0.6.1: 淘汰时保护已确认/已放行记录，删最旧的非关键记录', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { openPersistentStores } = await import('../lib/core/store.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-lru-'))
  const s = openPersistentStores(path.join(dir, 'state.json'))

  // 最旧的一条是「已放行」，必须活下来
  s.runs.set('old:approved', { approved: true, confirmed: true, decision: 'GREEN' })
  s.runs.set('old:plain', { decision: 'YELLOW' })
  for (let i = 0; i < 600; i++) s.runs.set('k' + i, { decision: 'YELLOW' })

  assert.equal(s.runs.size <= 501, true, '应控制在 500 附近，实际 ' + s.runs.size)
  assert.equal(s.runs.has('old:approved'), true, '已放行的旧记录不能被淘汰')
  assert.equal(s.runs.has('old:plain'), false, '最旧的非关键记录应被淘汰')
  s.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('0.6.1: 重复 set 会刷新顺序（LRU 而非纯插入序）', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { openPersistentStores } = await import('../lib/core/store.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-lru2-'))
  const s = openPersistentStores(path.join(dir, 'state.json'))

  s.contracts.set('a', { v: 1 })
  s.contracts.set('b', { v: 1 })
  for (let i = 0; i < 495; i++) s.contracts.set('o' + i, { v: 1 })   // 到 497
  s.contracts.set('a', { v: 2 })                                      // touch a → 排到最后
  for (let i = 0; i < 10; i++) s.contracts.set('x' + i, { v: 1 })     // 507 → 裁到 500

  assert.equal(s.contracts.size, 500, '应裁到 500，实际 ' + s.contracts.size)
  assert.equal(s.contracts.has('a'), true, '刚写过的 a 不应被淘汰')
  assert.equal(s.contracts.has('b'), false, 'b 更旧，应被淘汰')
  s.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('0.7.0 新检查：glob.exists 命中 / 落空', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glob-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src', 'a.test.mjs'), 'x')
  fs.writeFileSync(path.join(root, 'src', 'b.js'), 'x')

  const hit = await checksModule.runChecks(
    [{ id: 'k1', type: 'glob.exists', pattern: 'src/**/*.test.mjs' }], { workspaceRoot: root })
  assert.equal(hit.checks[0].ok, true, JSON.stringify(hit.checks[0]))
  assert.equal(hit.checks[0].matches.length, 1)

  const miss = await checksModule.runChecks(
    [{ id: 'k2', type: 'glob.exists', pattern: 'src/**/*.py' }], { workspaceRoot: root })
  assert.equal(miss.checks[0].ok, false)

  const escape = await checksModule.runChecks(
    [{ id: 'k3', type: 'glob.exists', pattern: '../*.js' }], { workspaceRoot: root })
  assert.equal(escape.checks[0].ok, false)
  fs.rmSync(root, { recursive: true, force: true })
})

test('0.7.0 新检查：text.contains 命中 / 落空 / 越界', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'text-'))
  fs.writeFileSync(path.join(root, 'README.md'), '# hi\n安装说明\n')

  const hit = await checksModule.runChecks(
    [{ id: 'k1', type: 'text.contains', path: 'README.md', text: '安装说明' }], { workspaceRoot: root })
  assert.equal(hit.checks[0].ok, true, JSON.stringify(hit.checks[0]))

  const miss = await checksModule.runChecks(
    [{ id: 'k2', type: 'text.contains', path: 'README.md', text: '不存在的词' }], { workspaceRoot: root })
  assert.equal(miss.checks[0].ok, false)

  const escape = await checksModule.runChecks(
    [{ id: 'k3', type: 'text.contains', path: '../x', text: 'a' }], { workspaceRoot: root })
  assert.equal(escape.checks[0].ok, false)
  assert.match(escape.checks[0].detail, /越出 workspaceRoot/)
  fs.rmSync(root, { recursive: true, force: true })
})

test('0.7.0 新检查：json.field 取值 / 等值断言 / 缺字段', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'json-'))
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', version: '1.2.3', deps: { a: 1 } }))

  const get = await checksModule.runChecks(
    [{ id: 'k1', type: 'json.field', path: 'package.json', field: 'version', equals: '1.2.3' }], { workspaceRoot: root })
  assert.equal(get.checks[0].ok, true, JSON.stringify(get.checks[0]))
  assert.equal(get.checks[0].value, '1.2.3')

  const nested = await checksModule.runChecks(
    [{ id: 'k2', type: 'json.field', path: 'package.json', field: 'deps.a', equals: 1 }], { workspaceRoot: root })
  assert.equal(nested.checks[0].ok, true)

  const wrong = await checksModule.runChecks(
    [{ id: 'k3', type: 'json.field', path: 'package.json', field: 'version', equals: '9.9.9' }], { workspaceRoot: root })
  assert.equal(wrong.checks[0].ok, false)

  const absent = await checksModule.runChecks(
    [{ id: 'k4', type: 'json.field', path: 'package.json', field: 'nope.deep' }], { workspaceRoot: root })
  assert.equal(absent.checks[0].ok, false)
  fs.rmSync(root, { recursive: true, force: true })
})

test('0.7.0 新检查：file.sha256 一致 / 不一致', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const crypto = await import('node:crypto')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sha-'))
  const file = path.join(root, 'a.txt')
  fs.writeFileSync(file, 'hello')
  const digest = crypto.createHash('sha256').update('hello').digest('hex')

  const ok = await checksModule.runChecks(
    [{ id: 'k1', type: 'file.sha256', path: 'a.txt', sha256: digest }], { workspaceRoot: root })
  assert.equal(ok.checks[0].ok, true, JSON.stringify(ok.checks[0]))

  const bad = await checksModule.runChecks(
    [{ id: 'k2', type: 'file.sha256', path: 'a.txt', sha256: '0'.repeat(64) }], { workspaceRoot: root })
  assert.equal(bad.checks[0].ok, false)
  fs.rmSync(root, { recursive: true, force: true })
})

test('0.7.0 新检查：RED 时复现命令可执行（非装饰）', async () => {
  const { decide } = await import('../lib/core/gate.js')
  const { makeEvidence } = await import('../lib/core/evidence.js')
  const c = freezeContract({ objective: 'x', workspaceRoot: process.cwd().replace(/\\\\/g, '/'),
    criteria: [{ id: 'c1', text: 't', checkIds: ['k1'] }] })
  const checks = [{ id: 'k1', type: 'text.contains', ok: false, path: 'README.md',
    absPath: process.cwd().replace(/\\\\/g, '/') + '/README.md', contains: '绝不存在的词' }]
  const d = decide(c, makeEvidence({ contractId: c.id, checks }))
  assert.equal(d.decision, 'RED')
  assert.match(d.reproCmd, /node -e/, d.reproCmd)
  assert.ok(!d.reproCmd.includes('无可执行复现命令'), d.reproCmd)
})

test('0.8.0 模板：readme-install 展开成 2 条条件且自带检查', async () => {
  const s = newStores()
  const { contractId } = verifyContract({
    objective: 'README 有安装节', workspaceRoot: process.cwd().replace(/\\\\/g, '/'),
    template: 'readme-install',
  }, 'default', s.contracts, s.runs)
  gateFreeze({ contractId, confirm: true }, s.contracts, s.runs)
  const r = await verifyRun({ contractId }, s.contracts, s.runs)
  assert.ok(['GREEN', 'RED'].includes(r.decision), r.decision)
  assert.ok(r.evidenceHash, '应有证据')
})

test('0.8.0 模板：tests-green 需要 testCmd，缺了直接报错', async () => {
  const s = newStores()
  assert.throws(() => verifyContract({
    objective: 'x', workspaceRoot: process.cwd().replace(/\\\\/g, '/'), template: 'tests-green',
  }, 'default', s.contracts, s.runs), /需要先声明 testCmd/)
})

test('0.8.0 模板：未知模板报错并列出可用模板', () => {
  const s = newStores()
  assert.throws(() => verifyContract({
    objective: 'x', workspaceRoot: process.cwd().replace(/\\\\/g, '/'), template: 'nope',
  }, 'default', s.contracts, s.runs), /未知模板.*readme-install/)
})

test('0.8.0 模板：template 与 criteria 同时给 → 报错', () => {
  const s = newStores()
  assert.throws(() => verifyContract({
    objective: 'x', workspaceRoot: process.cwd().replace(/\\\\/g, '/'),
    template: 'readme-install', criteria: [{ id: 'c1', text: 't', checkIds: ['k1'] }],
  }, 'default', s.contracts, s.runs), /二选一/)
})

test('0.8.0 /gate-history：列出落盘契约并按时间倒序', async () => {
  const s = newStores()
  const root = process.cwd().replace(/\\\\/g, '/')
  const a = verifyContract({ objective: '第一个', workspaceRoot: root, template: 'readme-install' }, 'default', s.contracts, s.runs)
  const b = verifyContract({ objective: '第二个', workspaceRoot: root, template: 'readme-install' }, 'default', s.contracts, s.runs)
  gateFreeze({ contractId: b.contractId, confirm: true }, s.contracts, s.runs)
  const h = gateHistory({}, s.contracts, s.runs)
  assert.equal(h.kind, 'success')
  assert.ok(h.text.includes(a.contractId) && h.text.includes(b.contractId), h.text)
  assert.match(h.text, /已确认待校验|GREEN|RED/, h.text)
})
