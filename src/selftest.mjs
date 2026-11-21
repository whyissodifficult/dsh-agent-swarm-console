/**
 * P1 适配层自测 —— 不依赖真实 API，用假响应验证全链路。
 * 跑法：node selftest.mjs
 */
import { buildPrompt, parsePlanFromOutput, parseTodos, parseResult, detectCapabilities } from './adapter.js'
import { createAdapterRun } from './spawn-adapter.js'

let pass = 0, fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}

console.log('\n=== ① 提示词构造 ===')
const p = buildPrompt({
  task: '总结镜头章法',
  rolePrompt: '资深影像分析师',
  objective: '分析一批视频',
  outlinePlan: true,
})
ok('含任务', p.includes('总结镜头章法'))
ok('含角色', p.includes('资深影像分析师'))
ok('含目标', p.includes('分析一批视频'))
ok('含计划 JSON 格式说明', p.includes('"plan"'))
ok('含 TODO 协议', p.includes('TODO:'))

console.log('\n=== ② 计划解析（agent 输出带 ```json 代码块）===')
const withFence = `好的，我先规划：
\`\`\`json
{"plan":[{"title":"下载视频"},{"title":"抽关键帧"},{"title":"写报告"}]}
\`\`\`
开始执行。`
const plan = parsePlanFromOutput(withFence)
ok('解析出3条计划', Array.isArray(plan) && plan.length === 3, JSON.stringify(plan))
ok('标题正确', plan?.[0]?.title === '下载视频')

console.log('\n=== ③ 计划解析（无代码块，纯 JSON）===')
const plain = '{"plan":[{"title":"A"},{"title":"B"}]}'
const plan2 = parsePlanFromOutput(plain)
ok('无代码块也能解析', Array.isArray(plan2) && plan2.length === 2)

console.log('\n=== ④ TODO 解析 ===')
const withTodo = `TODO: [done] 下载视频
TODO: [todo] 抽关键帧
TODO: [done] 写报告`
const todos = parseTodos(withTodo)
ok('解析出3条todo', todos.length === 3)
ok('done状态正确', todos[0].done === true && todos[1].done === false)
ok('文本正确', todos[1].text === '抽关键帧')

console.log('\n=== ⑤ RESULT 解析 ===')
const withResult = `干完了。
RESULT: 视频共12个镜头，其中3个长镜头转场精彩。`
const res = parseResult(withResult)
ok('提取到结果', res !== undefined && res.includes('12个镜头'))

console.log('\n=== ⑥ 能力探测（替代版本判断）===')
const caps = detectCapabilities({ get: () => undefined, webServer: { register: () => {} } })
ok('无subagents时不报错', caps.hostSubagents === false)
ok('有webServer时sse=true', caps.sse === true)
const caps2 = detectCapabilities({ get: (n) => (n === 'subagents' ? { start: () => {} } : undefined) })
ok('有subagents时识别为true', caps2.hostSubagents === true)

console.log('\n=== ⑦ run 契约形状（swarm 只认这四样）===')
const events = []
const swarm = {
  emitSwarmEvent: (sid, type, data) => events.push({ sid, type, data }),
  persist: () => {},
  upsertAgent: () => {},
}

// mock fetch：返回一段 SSE 流
const fakeSSE = [
  'data: {"choices":[{"delta":{"content":"TODO: [done] 第一步\\n"}}]}',
  'data: {"choices":[{"delta":{"content":"TODO: [todo] 第二步\\n"}}]}',
  'data: {"choices":[{"delta":{"content":"RESULT: 干完了\\n"}}]}',
  'data: [DONE]',
  '',
].join('\n\n')

process.env.TEST_KEY = 'sk-test'

globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  body: {
    getReader: () => {
      const bytes = new TextEncoder().encode(fakeSSE)
      let i = 0
      return {
        read: async () => (i < bytes.length ? { done: false, value: bytes.slice(i, (i += bytes.length)) } : { done: true }),
      }
    },
  },
})

const run = createAdapterRun(
  { id: 'a1', name: 'DeepSeek', role: 'reasoning', task: '测试任务', outlinePlan: true },
  {
    sessionId: 's1',
    agentId: 'a1',
    swarm,
    profile: { name: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'TEST_KEY', models: ['deepseek-v4-pro'], capabilities: ['reasoning'] },
  },
)

ok('有 id', typeof run.id === 'string' && run.id.length > 0)
ok('有 result (Promise)', run.result instanceof Promise)
ok('有 dispose (函数)', typeof run.dispose === 'function')

const r = await run.result
ok('stopReason=completed', r.stopReason === 'completed', JSON.stringify(r))
ok('output 含最终结果', String(r.output).includes('干完了'))

const types = events.map(e => e.type)
ok('发了 swarm/agent/child', types.includes('swarm/agent/child'), types.join(','))
ok('发了 swarm/agent/status', types.includes('swarm/agent/status'))
ok('status事件带 progress', events.some(e => e.type === 'swarm/agent/status' && typeof e.data.progress === 'number'))

console.log('\n=== ⑧ dispose 能取消 ===')
const run2 = createAdapterRun(
  { id: 'a2', name: 'X', role: 'r', task: 't' },
  { sessionId: 's1', agentId: 'a2', swarm, profile: { name: 'x', baseUrl: 'https://x/v1', apiKeyEnv: 'TEST_KEY', models: ['m'], capabilities: [] } },
)
await run2.dispose()
const r2 = await run2.result
ok('dispose 后不报错', r2 !== undefined)

console.log(`\n${'=' * 40}`)
console.log(`  通过 ${pass} / ${pass + fail}${fail ? `  失败 ${fail}` : '  全部通过 ✅'}`)
console.log(`${'=' * 40}\n`)
process.exit(fail > 0 ? 1 : 0)
