/**
 * 接线集成测试（离线）：验证打进 dsh-agent-swarm 之后的形态。
 *  1. pickExternalProfile 的路由规则（与 swarm-index.patch 里的实现一致）
 *  2. createAdapterRun 的 run 契约 + 事件流 + 产物落 roster
 * 用 mock fetch，不打真 API、不花钱。
 *
 * 用法：在装好接线的 swarm 插件目录里跑
 *   node integration-test.mjs
 * 本仓库内跑（用 wiring/ 里的适配器副本）：
 *   npm run wiring:test
 */
// 测试文件与 external-agent-adapter.js 同目录（本仓库 wiring/；装好后插件 lib/）
import { createAdapterRun } from './external-agent-adapter.js'
import { dryRunPatch } from './patch-dryrun.mjs'

let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`)) }

// 与 swarm-index.patch 里 pickExternalProfile 同一套规则
function makePicker(cfg) {
  return (spec) => {
    const table = cfg.externalAgents ?? {}
    const names = Object.keys(table)
    if (names.length === 0) return undefined
    if (typeof spec.agent === 'string' && table[spec.agent] !== undefined) return { name: spec.agent, profile: table[spec.agent] }
    if (typeof spec.role === 'string' && spec.role.trim() !== '') {
      const h = names.find((n) => table[n].role === spec.role)
      if (h) return { name: h, profile: table[h] }
    }
    if (cfg.capabilityRouting === true && Array.isArray(spec.capabilities)) {
      const need = spec.capabilities.filter((c) => typeof c === 'string')
      if (need.length > 0) {
        const h = names.find((n) => {
          const caps = Array.isArray(table[n].capabilities) ? table[n].capabilities : []
          return need.every((c) => caps.includes(c))
        })
        if (h) return { name: h, profile: table[h] }
      }
    }
    if (names.length === 1) return { name: names[0], profile: table[names[0]] }
    return undefined
  }
}

const cfg = {
  externalAgents: {
    deepseek: { role: 'reasoning', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'WIRING_TEST_KEY', models: ['mock'], capabilities: ['reasoning', 'chinese', 'summary'] },
    qoder: { role: 'vision', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'WIRING_TEST_KEY', models: ['mock'], capabilities: ['vision', 'code'] },
    ollama: { role: 'local', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'WIRING_TEST_KEY', models: ['mock'], capabilities: ['local', 'free'] },
  },
  capabilityRouting: true,
}
const pick = makePicker(cfg)

console.log('\n=== ① 路由规则 ===')
ok('spec.agent 显式指定 → deepseek', pick({ agent: 'deepseek' })?.name === 'deepseek')
ok('spec.role 匹配 → qoder', pick({ role: 'vision' })?.name === 'qoder')
ok('capabilities 能力路由 → ollama(local)', pick({ capabilities: ['local'] })?.name === 'ollama')
ok('capabilities 多项 → deepseek', pick({ capabilities: ['reasoning', 'chinese'] })?.name === 'deepseek')
ok('不匹配 → undefined（走原生）', pick({ role: 'nonexistent' }) === undefined)
ok('空表 → undefined', makePicker({ externalAgents: {} })({ role: 'x' }) === undefined)

console.log('\n=== ② run 契约 + 事件流（mock fetch）===')
process.env.WIRING_TEST_KEY = 'sk-wiring-test'
const enc = new TextEncoder()
const frame = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`
const output = [
  '```json',
  '{"plan":[{"title":"第一步"},{"title":"第二步"}]}',
  '```',
  'TODO: [done] 第一步',
  'TODO: [todo] 第二步',
  'RESULT: 演示完成',
].join('\n')
globalThis.fetch = async () => ({
  ok: true, status: 200,
  headers: { get: (k) => (k === 'content-type' ? 'text/event-stream' : null) },
  body: {
    getReader: () => {
      const bytes = enc.encode(output.match(/[\s\S]{1,40}/g).map(frame).join('') + 'data: [DONE]\n\n')
      let i = 0
      return { read: async () => (i < bytes.length ? { done: false, value: bytes.slice(i, (i += 400)) } : { done: true }) }
    },
  },
})

const events = [], patches = []
const swarm = {
  emitSwarmEvent: (sid, type, data) => events.push({ type, data }),
  persist: () => {},
  upsertAgent: (sid, aid, patch) => patches.push(patch),
}
const picked = pick({ capabilities: ['reasoning', 'chinese'] })
const run = createAdapterRun(
  { id: 'a1', name: 'DeepSeek', role: 'reasoning', task: '演示', outlinePlan: true },
  {
    sessionId: 's-int', agentId: 'a1', swarm,
    profile: { name: picked.name, baseUrl: picked.profile.baseUrl, apiKeyEnv: picked.profile.apiKeyEnv, models: picked.profile.models, capabilities: picked.profile.capabilities },
  },
)
ok('run 有 id', typeof run.id === 'string' && run.id.length > 0)
ok('run 有 result Promise', run.result instanceof Promise)
ok('run 有 dispose', typeof run.dispose === 'function')

const r = await run.result
ok('stopReason=completed', r.stopReason === 'completed', JSON.stringify(r).slice(0, 120))
ok('output 非空', String(r.output || '').length > 10)
const types = events.map((e) => e.type)
ok('发 child 事件', types.includes('swarm/agent/child'))
ok('发 status 事件', types.includes('swarm/agent/status'))
ok('发 plan 事件', types.includes('swarm/agent/plan'))
ok('事件数合理（节流生效）', events.length < 30, `实际 ${events.length}`)
ok('status 推进到 complete', events.some((e) => e.type === 'swarm/agent/status' && e.data.status === 'complete'))

console.log('\n=== ③ 解析产物进了 roster ===')
const withPlan = patches.find((p) => Array.isArray(p.plan))
ok('plan 已写入', withPlan !== undefined)
ok('plan 状态由 TODO 回填', withPlan !== undefined && withPlan.plan.some((p) => p.status === 'done') && withPlan.plan.some((p) => p.status !== 'done'))
ok('logs 已写入', patches.some((p) => Array.isArray(p.logs)))

console.log('\n=== ④ 补丁真实性（dry-run，不测复制品）===')
{
  const r = dryRunPatch()
  ok('git apply --check 命中 hunk', r.ok, r.problems.join('; '))
  ok('spawnExternal 恰好 2 处', r.stats?.spawnExternal === 2, `实际 ${r.stats?.spawnExternal}`)
  ok('node --check 通过', r.stats?.syntax === 'ok', `实际 ${r.stats?.syntax}`)
}

console.log(`\n${'='.repeat(40)}\n  通过 ${pass}/${pass + fail}${fail ? `  失败 ${fail}` : '  全部通过 ✅'}\n${'='.repeat(40)}\n`)
process.exit(fail > 0 ? 1 : 0)
