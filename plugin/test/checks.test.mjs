/**
 * P0-2 · checks 是请求不是结论：模型自报 ok 必须被忽略，实际执行判定。
 * 用注入 existsSync / exec，单测不碰真文件、不跑真命令。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runChecks } from '../lib/core/checks.js'

test('伪造 ok:true 的 file.exists（路径不存在）→ 实际 ok=false', () => {
  const r = runChecks([{ id: 'f', type: 'file.exists', path: '/nope', ok: true }], {
    existsSync: () => false,
  })
  assert.equal(r.checks[0].ok, false)
  assert.ok(r.warnings.some((w) => w.includes('自报 ok=true')))
})

test('伪造 ok:false 但文件存在 → 实际 ok=true（GREEN 依据）', () => {
  const r = runChecks([{ id: 'f', type: 'file.exists', path: '/exists', ok: false }], {
    existsSync: (p) => p === '/exists',
  })
  assert.equal(r.checks[0].ok, true)
  assert.ok(r.warnings.length > 0)
})

test('exec true → ok=true（status 0，无 error）', () => {
  const r = runChecks([{ id: 'e', type: 'exec', cmd: 'true' }], {
    exec: () => ({ status: 0, error: undefined, stdout: '', stderr: '' }),
  })
  assert.equal(r.checks[0].ok, true)
  assert.equal(r.checks[0].exitCode, 0)
})

test('exec false → ok=false（status 非 0）', () => {
  const r = runChecks([{ id: 'e', type: 'exec', cmd: 'false' }], {
    exec: () => ({ status: 1, error: undefined, stdout: '', stderr: 'boom' }),
  })
  assert.equal(r.checks[0].ok, false)
  assert.equal(r.checks[0].exitCode, 1)
  assert.match(r.checks[0].detail, /boom/)
})

test('exec 有 error 即使 status 0 → ok=false', () => {
  const r = runChecks([{ id: 'e', type: 'exec', cmd: 'whatever' }], {
    exec: () => ({ status: 0, error: new Error('spawn failed') }),
  })
  assert.equal(r.checks[0].ok, false)
})

test('file.exists 缺 path → 抛错（请求非法）', () => {
  assert.throws(() => runChecks([{ id: 'f', type: 'file.exists' }], { existsSync: () => true }), /path/)
})

test('exec 缺 cmd → 抛错（请求非法）', () => {
  assert.throws(() => runChecks([{ id: 'e', type: 'exec' }], { exec: () => ({ status: 0 }) }), /cmd/)
})

test('未自报 ok 时不产生 warning', () => {
  const r = runChecks([{ id: 'f', type: 'file.exists', path: '/x' }], { existsSync: () => true })
  assert.equal(r.warnings.length, 0)
})
