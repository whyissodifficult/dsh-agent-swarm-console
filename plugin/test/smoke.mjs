/**
 * 形状测试：不需要装 DSH 就能跑。
 * 用假 ctx 捕获注册的工具定义，断言名字、render 形状、以及错误配置会 throw。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { apply } from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(here, '..')

let pass = 0
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

const validConfig = {} // 0.5.0：只做门禁，不再需要 externalAgents

const registered = new Map()
const fakeCtx = {
  effect: (fn) => fn(),
  get: () => undefined, // 宿主未装 action-cards 服务 → 卡片注册跳过
  tools: {
    register: (def) => { registered.set(def.name, def); return () => {} },
  },
}

apply(fakeCtx, validConfig)
console.log('\n=== 工具注册（0.5.0 只做门禁）===')
ok('注册了三个 verify_* 工具', () => {
  for (const n of ['verify_contract', 'verify_run', 'verify_status']) assert.ok(registered.has(n), '缺少 ' + n)
})
ok('不再注册 swarm_run', () => {
  assert.equal(registered.has('swarm_run'), false, 'swarm_run 应已移除')
})

console.log('\n=== 包自包含（blocker 永久回归）===')
ok('package.json files 含 lib', () => {
  const pkg = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
  assert.ok(pkg.files.includes('lib'), 'files 缺少 lib')
})
ok("index.js 不含 from '../'", () => {
  const src = readFileSync(join(pluginRoot, 'index.js'), 'utf8')
  assert.ok(!/from\s+['"]\.\.\//.test(src), '发现越界相对路径 import')
})

console.log('\n=== P1-5 消重 ===')
ok('wiring 适配层只剩 re-export（无第二份实现）', () => {
  const wiring = readFileSync(join(pluginRoot, '..', 'wiring', 'external-agent-adapter.js'), 'utf8')
  assert.match(wiring, /export \* from '\.\.\/plugin\/lib\/adapter\.js'/)
  assert.ok(!wiring.includes('export async function callChat'), '不应再有实现代码')
})

console.log(`\n通过 ${pass} 项 ✅\n`)
