/**
 * P1 适配层自测 —— 不依赖真实 API，用假响应验证全链路。
 * 跑法：node selftest.mjs
 */
import {
  buildPrompt,
  callChat,
  parsePlanFromOutput,
  parseTodos,
  parseResult,
  detectCapabilities,
  createAdapterRun,
} from './external-agent-adapter.js'

// 测试不需要真 key，但 callChat 会检查 env 是否存在
process.env.DEEPSEEK_API_KEY = 'sk-test-not-real'

function mkProfile() {
  return { name: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', models: ['deepseek-flash'], capabilities: ['reasoning'] }
}

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
  headers: { get: (k) => (k === 'content-type' ? 'text/event-stream' : null) },
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


console.log('\n=== ⑨ P0-3: 非 SSE 的 JSON 响应 ===')
{
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (k) => (k === 'content-type' ? 'application/json' : null) },
    json: async () => ({ choices: [{ message: { content: '这是JSON响应' } }] }),
  })
  const r = await callChat({ profile: mkProfile(), prompt: 'x' })
  ok('application/json 被正确解析', r === '这是JSON响应', `实际=${JSON.stringify(r)}`)
}

console.log('\n=== ⑩ P0-3: 不可解析的响应必须报错而非静默空串 ===')
{
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (k) => (k === 'content-type' ? 'text/html' : null) },
    json: async () => ({ unexpected: true }),
  })
  let threw = false
  try { await callChat({ profile: mkProfile(), prompt: 'x' }) } catch (e) { threw = true }
  ok('不可解析时抛错（不返回空串）', threw)
}

console.log('\n=== ⑪ P0-4: SSE 用 CRLF 分帧 ===')
{
  const crlf = 'data: {"choices":[{"delta":{"content":"A"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"B"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (k) => (k === 'content-type' ? 'text/event-stream' : null) },
    body: {
      getReader: () => {
        const bytes = new TextEncoder().encode(crlf)
        let i = 0
        return { read: async () => (i < bytes.length ? { done: false, value: bytes.slice(i, (i += bytes.length)) } : { done: true }) }
      },
    },
  })
  const r = await callChat({ profile: mkProfile(), prompt: 'x' })
  ok('CRLF 分帧内容完整', r === 'AB', `实际=${JSON.stringify(r)}`)
}

console.log('\n=== ⑫ P1-5: 取消应归为 cancelled 而非 error ===')
{
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    headers: { get: (k) => (k === 'content-type' ? 'text/event-stream' : null) },
    body: { getReader: () => ({ read: async () => { throw new Error('The operation was aborted') } }) },
  })
  const run = createAdapterRun(
    { id: 'c1', name: 'C', role: 'r', task: 't' },
    { sessionId: 's1', agentId: 'c1', swarm, profile: mkProfile() },
  )
  await run.dispose()
  const r = await run.result
  ok('stopReason=cancelled', r.stopReason === 'cancelled', JSON.stringify(r))
}

console.log('\n=== ⑬ P1-7: 计划状态由 TODO 回填，不伪造全 done ===')
{
  const out = '```json\n{"plan":[{"title":"A"},{"title":"B"},{"title":"C"}]}\n```\nTODO: [done] A\nTODO: [todo] B\nTODO: [todo] C\nRESULT: done'
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    headers: { get: (k) => (k === 'content-type' ? 'text/event-stream' : null) },
    body: {
      getReader: () => {
        const bytes = new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: out } }] }) + '\n\ndata: [DONE]\n\n')
        let i = 0
        return { read: async () => (i < bytes.length ? { done: false, value: bytes.slice(i, (i += bytes.length)) } : { done: true }) }
      },
    },
  })
  const patches = []
  const swarm2 = { emitSwarmEvent: () => {}, persist: () => {}, upsertAgent: (s, a, p) => patches.push(p) }
  const run = createAdapterRun(
    { id: 'p1', name: 'P', role: 'r', task: 't', outlinePlan: true },
    { sessionId: 's1', agentId: 'p1', swarm: swarm2, profile: mkProfile() },
  )
  await run.result
  const withPlan = patches.find((p) => Array.isArray(p.plan))
  const st = withPlan?.plan?.map((x) => x.status)
  ok('3步计划只有1步done', JSON.stringify(st) === '["done","todo","todo"]', JSON.stringify(st))
  const second = withPlan?.plan?.[1]
  ok('未完成步骤 maxProgress 不等于100', second && second.maxProgress < 100, JSON.stringify(second))
}

console.log('\n=== ⑭ P1-8: 并发创建 runId 不重号 ===')
{
  const ids = new Set()
  for (let i = 0; i < 50; i++) {
    const r = createAdapterRun(
      { id: 'x', name: 'X', role: 'r', task: 't' },
      { sessionId: 's1', agentId: 'x', swarm, profile: mkProfile() },
    )
    ids.add(r.id)
  }
  ok('50次创建 50个不同id', ids.size === 50, `实际=${ids.size}`)
}

console.log('\n=== ⑮ P1-6: 进度事件不刷屏 ===')
{
  let count = 0
  const swarm3 = { emitSwarmEvent: (s, t) => { if (t === 'swarm/agent/status') count++ }, persist: () => {}, upsertAgent: () => {} }
  const chunks = 'x'.repeat(6000)
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    headers: { get: (k) => (k === 'content-type' ? 'text/event-stream' : null) },
    body: {
      getReader: () => {
        const bytes = new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: chunks } }] }) + '\n\ndata: [DONE]\n\n')
        let i = 0
        return { read: async () => (i < bytes.length ? { done: false, value: bytes.slice(i, (i += bytes.length)) } : { done: true }) }
      },
    },
  })
  const run = createAdapterRun(
    { id: 'pr1', name: 'PR', role: 'r', task: 't' },
    { sessionId: 's1', agentId: 'pr1', swarm: swarm3, profile: mkProfile() },
  )
  await run.result
  ok('status事件 < 20 条', count < 20, `实际=${count}`)
}

console.log(`\n${'=' * 40}`)
console.log(`  通过 ${pass} / ${pass + fail}${fail ? `  失败 ${fail}` : '  全部通过 ✅'}`)
console.log(`${'=' * 40}\n`)
process.exit(fail > 0 ? 1 : 0)
