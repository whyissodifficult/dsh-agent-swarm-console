/**
 * checks（0.3.0）：请求语义 + workspaceRoot + testCmd 白名单 + 不抛异常。
 * 全程注入 existsSync / exec，单测不碰真文件、不跑真命令。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runChecks } from '../lib/core/checks.js'

const ROOT = process.cwd() // 绝对路径即可，这里只用它拼路径

test('伪造 ok:true 的 file.exists（路径不存在）→ 实际 ok=false', () => {
  const r = runChecks([{ id: 'f', type: 'file.exists', path: 'nope.txt', ok: true }], {
    workspaceRoot: ROOT, existsSync: () => false,
  })
  assert.equal(r.checks[0].ok, false)
  assert.ok(r.warnings.some((w) => w.includes('自报 ok=true')))
})
test('伪造 ok:false 但文件存在 → 实际 ok=true', () => {
  const r = runChecks([{ id: 'f', type: 'file.exists', path: 'package.json', ok: false }], {
    workspaceRoot: ROOT, existsSync: (p) => p === ROOT + '/package.json' || p.endsWith('package.json'),
  })
  assert.equal(r.checks[0].ok, true)
})
test('file.exists 以 workspaceRoot 解析相对路径（绝对路径入参 → RED）', () => {
  let seen = null
  const rel = runChecks([{ id: 'f', type: 'file.exists', path: 'a/b.txt' }], {
    workspaceRoot: ROOT, existsSync: (p) => { seen = p; return true },
  })
  assert.equal(rel.checks[0].ok, true)
  assert.ok(seen.includes('a') && seen.includes('b.txt'), '应解析到 workspaceRoot 下')

  const abs = runChecks([{ id: 'f', type: 'file.exists', path: 'C:/Windows/win.ini' }], {
    workspaceRoot: ROOT, existsSync: () => true,
  })
  assert.equal(abs.checks[0].ok, false)
  assert.match(abs.checks[0].detail, /相对 workspaceRoot/)
})
test('P0-4: exec 命令不在 testCmd 白名单 → RED，且不执行', () => {
  let called = 0
  const r = runChecks([{ id: 'e', type: 'exec', cmd: 'exit 0' }], {
    workspaceRoot: ROOT, testCmd: 'npm run gate', exec: () => { called++; return { status: 0 } },
  })
  assert.equal(r.checks[0].ok, false)
  assert.match(r.checks[0].detail, /未在契约中声明为 testCmd/)
  assert.equal(called, 0, '被拒绝的命令不得执行')
})
test('exec 命中白名单 → 执行并把 cwd 设为 workspaceRoot', () => {
  let opts = null
  const r = runChecks([{ id: 'e', type: 'exec', cmd: 'npm run gate' }], {
    workspaceRoot: ROOT, testCmd: 'npm run gate',
    exec: (cmd, o) => { opts = o; return { status: 0, error: undefined } },
  })
  assert.equal(r.checks[0].ok, true)
  assert.equal(opts.cwd, ROOT)
})
test('exec 非 0 → ok=false 带 detail', () => {
  const r = runChecks([{ id: 'e', type: 'exec', cmd: 'npm test' }], {
    workspaceRoot: ROOT, testCmd: 'npm test', exec: () => ({ status: 1, stderr: 'boom' }),
  })
  assert.equal(r.checks[0].ok, false)
  assert.equal(r.checks[0].exitCode, 1)
  assert.match(r.checks[0].detail, /boom/)
})
test('P1-2: 非法请求不抛，返回 ok:false + 「检查请求非法」', () => {
  const r1 = runChecks([{ id: 'f', type: 'file.exists' }], { workspaceRoot: ROOT })
  assert.equal(r1.checks[0].ok, false)
  assert.match(r1.checks[0].detail, /检查请求非法/)

  const r2 = runChecks([{ id: 'e', type: 'exec' }], { workspaceRoot: ROOT, testCmd: 'x' })
  assert.equal(r2.checks[0].ok, false)
  assert.match(r2.checks[0].detail, /检查请求非法/)

  const r3 = runChecks([{ id: 'x', type: 'file.exsits', path: 'a' }], { workspaceRoot: ROOT })
  assert.equal(r3.checks[0].ok, false)
  assert.match(r3.checks[0].detail, /未知检查类型/)

  const r4 = runChecks('not-an-array', { workspaceRoot: ROOT })
  assert.equal(r4.checks[0].ok, false)
  assert.match(r4.checks[0].detail, /必须是数组/)
})
test('未自报 ok 时不产生 warning', () => {
  const r = runChecks([{ id: 'f', type: 'file.exists', path: 'x' }], { workspaceRoot: ROOT, existsSync: () => true })
  assert.equal(r.warnings.length, 0)
})
