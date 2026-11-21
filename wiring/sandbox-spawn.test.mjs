/**
 * 沙箱降级单元测试：注入 mock spawn，验证 EPERM 三级降级路径。
 * 不依赖真实 DSH 沙箱，也不断言复制品——直接驱动 sandbox-spawn.mjs 的降级代码。
 */
import assert from 'node:assert/strict'
import { writeSync } from 'node:fs'
import { makeSafeSpawn, spawnErrorText } from './sandbox-spawn.mjs'

let pass = 0
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

const eperm = Object.assign(new Error('spawn git EPERM'), { code: 'EPERM' })
const enoent = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })

console.log('\n=== 沙箱 pipe EPERM 降级 ===')
{
  const calls = []
  const mock = (cmd, args, opts) => {
    calls.push(opts?.stdio ? (Array.isArray(opts.stdio) ? 'fd' : 'inherit') : 'pipe')
    if (!opts?.stdio) return { status: null, error: eperm }
    if (Array.isArray(opts.stdio)) {
      writeSync(opts.stdio[1], 'git version 2.47.0\n')
      return { status: 0, error: null }
    }
    return { status: 0, error: null }
  }
  const r = makeSafeSpawn(mock)('git', ['--version'])
  ok('第一次走 pipe，第二次降级 fd', () => assert.deepEqual(calls, ['pipe', 'fd']))
  ok('mode = fd', () => assert.equal(r.mode, 'fd'))
  ok('status = 0（不假红）', () => assert.equal(r.status, 0))
  ok('捕获到 stdout', () => assert.match(r.stdout, /2\.47\.0/))
  ok('error 已清空', () => assert.equal(r.error, null))
}

console.log('\n=== fd 也失败 → inherit 兜底 ===')
{
  const calls = []
  const mock = (cmd, args, opts) => {
    if (!opts?.stdio) return { status: null, error: eperm }
    if (Array.isArray(opts.stdio)) return { status: null, error: eperm }
    calls.push('inherit')
    return { status: 0, error: null }
  }
  const r = makeSafeSpawn(mock)('git', ['apply', 'x'])
  ok('最终走 inherit', () => assert.deepEqual(calls, ['inherit']))
  ok('mode = inherit', () => assert.equal(r.mode, 'inherit'))
  ok('status = 0（仍不假红）', () => assert.equal(r.status, 0))
  ok('note 明确说明降级', () => assert.match(r.note, /inherit/))
}

console.log('\n=== ENOENT 不被误判为 EPERM ===')
{
  const mock = () => ({ status: null, error: enoent })
  const r = makeSafeSpawn(mock)('git', ['--version'])
  ok('mode 保持 pipe（不降级）', () => assert.equal(r.mode, 'pipe'))
  ok('error.code = ENOENT', () => assert.equal(r.error.code, 'ENOENT'))
  ok('诊断说"未找到"，不说"沙箱"', () => {
    const t = spawnErrorText(r, 'git')
    assert.match(t, /未找到/)
    assert.doesNotMatch(t, /沙箱/)
  })
}

console.log('\n=== EPERM 诊断文案 ===')
{
  const r = makeSafeSpawn(() => ({ status: null, error: eperm }))('git', [])
  ok('诊断说"沙箱禁止管道"', () => assert.match(spawnErrorText(r, 'git'), /沙箱禁止管道/))
  ok('提示宿主终端', () => assert.match(spawnErrorText(r, 'git'), /宿主终端/))
}

console.log(`\n通过 ${pass} 项 ✅\n`)
