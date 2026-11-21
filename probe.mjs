// 回归探针：改完必须全 PASS。用法： node probe.mjs
// 可用 ADAPTER 环境变量指定被测模块（默认 ./src/external-agent-adapter.js）
const ADAPTER = process.env.ADAPTER || './src/external-agent-adapter.js'
const mod = await import(ADAPTER)
const { createAdapterRun, callChat } = mod

process.env.PROBE_KEY = 'sk-test'
const enc = new TextEncoder()
const profile = { name: 'probe', baseUrl: 'http://x/v1', apiKeyEnv: 'PROBE_KEY', models: ['m'], capabilities: [] }

let pass = 0
const fails = []
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? '  →  ' + detail : ''}`) }
}

/** 造一个 mock fetch：chunks 是字符串片段数组 */
function mockSSE(chunks, { honorAbort = false, delayMs = 0, contentType = 'text/event-stream' } = {}) {
  return async (url, opts) => ({
    ok: true,
    status: 200,
    headers: { get: () => contentType },
    body: {
      getReader: () => {
        let i = 0
        return {
          async read() {
            if (honorAbort && opts?.signal?.aborted) {
              const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e
            }
            if (i >= chunks.length) return { done: true }
            const v = chunks[i++]
            if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
            return { done: false, value: enc.encode(v) }
          },
        }
      },
    },
    async json() { return JSON.parse(chunks.join('')) },
  })
}

function sseFrame(text) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
}
function makeSwarm() {
  const events = [], patches = []
  return {
    events, patches,
    swarm: {
      emitSwarmEvent: (s, t, d) => events.push({ t, d }),
      persist() {},
      upsertAgent: (s, a, p) => patches.push(p),
    },
  }
}

console.log('\n=== 1. SSE 基本解析（LF）===')
{
  globalThis.fetch = mockSSE([sseFrame('你好'), sseFrame('世界'), 'data: [DONE]\n\n'])
  const out = await callChat({ profile, prompt: 'x' })
  check('LF 分帧能拼出完整文本', out === '你好世界', `实际「${out}」`)
}

console.log('\n=== 2. SSE 基本解析（CRLF）===')
{
  globalThis.fetch = mockSSE([
    'data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\n',
    'data: {"choices":[{"delta":{"content":"世界"}}]}\r\n\r\n',
    'data: [DONE]\r\n\r\n',
  ])
  const out = await callChat({ profile, prompt: 'x' })
  check('CRLF 分帧同样可用', out === '你好世界', `实际「${out}」`)
}

console.log('\n=== 3. 非 SSE 的 200（application/json）===')
{
  globalThis.fetch = mockSSE(['{"choices":[{"message":{"content":"完整答案"}}]}'], { contentType: 'application/json' })
  let out, err
  try { out = await callChat({ profile, prompt: 'x' }) } catch (e) { err = e }
  check('要么解出 JSON 里的 content，要么明确报错', out === '完整答案' || err !== undefined,
    `实际 out=${JSON.stringify(out)} err=${err ? err.message : '无'}`)
}

console.log('\n=== 4. 取消语义（dispose 应在契约上返回 cancelled）===')
{
  globalThis.fetch = mockSSE([sseFrame('a'), sseFrame('b'), 'data: [DONE]\n\n'], { honorAbort: true, delayMs: 15 })
  const { swarm } = makeSwarm()
  const run = createAdapterRun({ id: 'c1', role: 'r', task: 't' }, { sessionId: 's1', agentId: 'c1', swarm, profile })
  setTimeout(() => run.dispose(), 10)
  const r = await run.result
  check('stopReason === "cancelled"', r.stopReason === 'cancelled', `实际 ${r.stopReason}`)
}

console.log('\n=== 5. 进度事件不刷屏（300 个 chunk）===')
{
  globalThis.fetch = mockSSE(
    Array.from({ length: 300 }, () => sseFrame('x'.repeat(60))).concat(['data: [DONE]\n\n']),
  )
  const { swarm, events } = makeSwarm()
  const run = createAdapterRun({ id: 'p1', role: 'r', task: 't' }, { sessionId: 's1', agentId: 'p1', swarm, profile })
  await run.result
  const statuses = events.filter((e) => e.t === 'swarm/agent/status').map((e) => e.d.progress)
  const monotonic = statuses.every((v, i) => i === 0 || v >= statuses[i - 1])
  check('status 事件数 ≤ 30', statuses.length <= 30, `实际 ${statuses.length} 条`)
  check('progress 单调不减且 ≤ 100', monotonic && statuses.every((v) => v >= 0 && v <= 100),
    `尾部 ${statuses.slice(-5).join(',')}`)
}

console.log('\n=== 6. 计划状态不能无条件 done ===')
{
  const outText = [
    '```json',
    '{"plan":[{"title":"第一步"},{"title":"第二步"},{"title":"第三步"}]}',
    '```',
    'TODO: [todo] 第一步',
    'TODO: [todo] 第二步',
    'RESULT: 我只做了计划',
  ].join('\n')
  const frames = outText.match(/[\s\S]{1,40}/g).map(sseFrame).concat(['data: [DONE]\n\n'])
  globalThis.fetch = mockSSE(frames)
  const { swarm, patches } = makeSwarm()
  const run = createAdapterRun({ id: 'pl1', role: 'r', task: 't', outlinePlan: true },
    { sessionId: 's1', agentId: 'pl1', swarm, profile })
  await run.result
  const plan = (patches.find((p) => p.plan) || {}).plan || []
  check('TODO 全未完成时，plan 不能全是 done', plan.length === 0 || plan.some((i) => i.status !== 'done'),
    `实际 ${JSON.stringify(plan.map((i) => i.status))}`)
}

console.log('\n=== 7. runId 唯一（同毫秒并发创建）===')
{
  globalThis.fetch = mockSSE(['data: [DONE]\n\n'])
  const { swarm } = makeSwarm()
  const ids = new Set()
  for (let i = 0; i < 50; i++) {
    const run = createAdapterRun({ id: 'dup', role: 'r', task: 't' }, { sessionId: 's1', agentId: 'dup', swarm, profile })
    ids.add(run.id)
  }
  check('50 次创建得到 50 个不同 id', ids.size === 50, `实际 ${ids.size} 个`)
}

console.log('\n=== 8. 错误路径要能被观测（不静默）===')
{
  globalThis.fetch = async () => ({ ok: false, status: 500, headers: { get: () => 'application/json' }, text: async () => 'boom' })
  const { swarm, events } = makeSwarm()
  const run = createAdapterRun({ id: 'e1', role: 'r', task: 't' }, { sessionId: 's1', agentId: 'e1', swarm, profile })
  const r = await run.result
  const statuses = events.filter((e) => e.t === 'swarm/agent/status').map((e) => e.d.status)
  check('stopReason === "error"', r.stopReason === 'error', `实际 ${r.stopReason}`)
  check('错误时 UI 收到 error 状态事件', statuses.includes('error'), `实际 ${JSON.stringify(statuses)}`)
}

console.log('\n' + '='.repeat(46))
if (fails.length) {
  console.log(`  通过 ${pass} / ${pass + fails.length}   未通过 ${fails.length} 项`)
  fails.forEach((f) => console.log(`    - ${f}`))
  process.exit(1)
} else {
  console.log(`  全部通过 ${pass} 项 ✅`)
}
