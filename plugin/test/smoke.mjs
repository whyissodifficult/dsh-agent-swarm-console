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

const validConfig = {
  externalAgents: {
    deepseek: {
      baseUrl: 'https://api.deepseek.com/v1',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      models: ['deepseek-flash'],
      capabilities: ['reasoning'],
    },
  },
  capabilityRouting: true,
}

const registered = new Map()
const fakeCtx = {
  effect: (fn) => fn(),
  get: () => undefined, // 宿主未装 action-cards 服务 → 卡片注册跳过
  tools: {
    register: (def) => { registered.set(def.name, def); return () => {} },
  },
}

console.log('\n=== swarm_run 形状 ===')
ok('apply 注册了工具', () => {
  apply(fakeCtx, validConfig)
  assert.ok(registered.size >= 1, '没有注册任何工具')
})
ok("注册了 swarm_run", () => assert.ok(registered.has('swarm_run')))
ok('swarm_run.parameters.required 含 task', () => {
  assert.ok(registered.get('swarm_run').parameters.required.includes('task'))
})
ok('output.render 返回 text 块', () => {
  const blocks = registered.get('swarm_run').output.render({}, { stopReason: 'completed', text: 'hi', ms: 1 })
  assert.equal(blocks[0].type, 'text')
  assert.equal(blocks[0].text, '[completed] hi')
})

console.log('\n=== verify 三工具已注册 ===')
for (const name of ['verify_contract', 'verify_run', 'verify_status']) {
  ok(`注册了 ${name}`, () => assert.ok(registered.has(name), `缺少 ${name}`))
}

console.log('\n=== 错误配置必须 throw（反证）===')
ok('config.externalAgents 传字符串 → throw', () => {
  assert.throws(() => apply(fakeCtx, { externalAgents: 'bad' }), /必须是对象/)
})
ok('画像缺 apiKeyEnv → throw', () => {
  assert.throws(() => apply(fakeCtx, {
    externalAgents: { bad: { baseUrl: 'http://x', models: ['m'] } },
  }), /apiKeyEnv/)
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
