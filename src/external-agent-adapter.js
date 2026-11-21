/**
 * P1 · 国内 agent 适配层（纯 JS，DSH 插件可直接用）
 *
 * 目标：让 swarm 的 spawn 不用改，就能把活派给国内 AI（DeepSeek / Qoder / Kimi / 本地 Ollama）。
 *
 * 核心契约（源码 index.js:1252 / 1266 / 1287 / 1134）：
 *   返回的对象必须有  id / result(Promise) / dispose()
 *   result 兑现为 { stopReason: "completed"|"cancelled"|"error", output }
 *
 * 关键：本适配器不依赖 DSH 的 ctx.subagents —— 低版本 DSH 也能跑。
 * 用能力探测（capability detection）代替版本判断。
 */

import { randomUUID } from 'node:crypto'

// 进度估算：输出达到这个字符数视为 100%。纯启发式，只用于驱动 UI 的进度条。
const PROGRESS_FULL_CHARS = 2000

/**
 * Agent 画像：一个可调用的国内 agent
 * @typedef {Object} AgentProfile
 * @property {string} name            唯一 id
 * @property {string} baseUrl         OpenAI 兼容端点，如 https://api.deepseek.com/v1
 * @property {string} apiKeyEnv       取令牌的 env 名（不把 key 写进代码）
 * @property {string[]} models         可用模型，第一个是默认
 * @property {string[]} capabilities   能力标签——"因材施教"靠它路由
 * @property {number} [maxConcurrency] 最大并发 —— 预留字段，未接线。
 *   本适配器目前不按此值限流；调用方若需要并发上限，请自行在 spawn 层排队。
 */

/**
 * @typedef {Object} RunResult
 * @property {'completed'|'cancelled'|'error'} stopReason
 * @property {unknown} output
 */

/**
 * @typedef {Object} AdapterRun
 * @property {string} id
 * @property {Promise<RunResult>} result
 * @property {() => Promise<void>} dispose
 */

// ── 能力探测（替代版本判断）────────────────────────────────────────────────

/**
 * @typedef {Object} Capabilities
 * @property {boolean} hostSubagents  宿主能否提供 DSH subagent（本适配器不依赖它）
 * @property {boolean} sse            能不能发 SSE（不能就只写 JSONL + 内存）
 */

/**
 * 探测宿主能力。不看版本号，只看"有没有这个功能"。
 * @param {any} ctx Cordis ctx
 * @returns {Capabilities}
 */
export function detectCapabilities(ctx) {
  const c = ctx
  return {
    hostSubagents: typeof c?.get?.('subagents')?.start === 'function',
    sse: typeof c?.webServer?.register === 'function',
  }
}

// ── HTTP 调用（OpenAI 兼容协议）────────────────────────────────────────────

/**
 * 调一次 chat completions，流式优先。
 * @param {Object} opts
 * @param {AgentProfile} opts.profile
 * @param {string} opts.prompt
 * @param {string} [opts.systemPrompt]
 * @param {string} [opts.model]
 * @param {string} [opts.reasoningEffort]
 * @param {AbortSignal} [opts.signal]
 * @param {(delta: string) => void} [opts.onChunk]
 * @returns {Promise<string>} 完整文本
 */
export async function callChat(opts) {
  const profile = opts.profile
  const model = opts.model || profile.models[0]
  const key = process.env[profile.apiKeyEnv]
  if (!key) {
    throw new Error(`缺少环境变量 ${profile.apiKeyEnv}（profile: ${profile.name}）`)
  }

  const messages = []
  if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt })
  messages.push({ role: 'user', content: opts.prompt })

  const body = { model, messages, stream: true }
  // P1-10: 严格实现的 OpenAI 兼容端点对未知字段直接 400，
  // 所以只在 profile 显式声明 supportsReasoningEffort 时才发送。
  if (opts.reasoningEffort && profile.supportsReasoningEffort === true) {
    body.reasoning_effort = opts.reasoningEffort
  }

  // P1-9: 超时 + 429/5xx 指数退避重试。
  const url = `${profile.baseUrl.replace(/\/$/, '')}/chat/completions`
  // R5: 超时可配。默认 120 秒，用 SWARM_TIMEOUT_MS 覆盖（毫秒）。
  const TIMEOUT_MS = Number(process.env.SWARM_TIMEOUT_MS ?? 120000)
  const RETRYABLE = new Set([429, 500, 502, 503, 504])
  const MAX_RETRIES = 3

  let res
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const timeout = AbortSignal.timeout(TIMEOUT_MS)
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal,
    })
    if (res.ok) break
    if (!RETRYABLE.has(res.status) || attempt === MAX_RETRIES) {
      const text = await res.text().catch(() => '')
      throw new Error(`${profile.name} HTTP ${res.status}: ${text.slice(0, 300)}`)
    }
    // 指数退避：1s / 2s / 4s
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
  }

  // P0-3: 非 SSE 的 200 响应不能当成空结果。
  // 端点返回 application/json 时一行 data: 都匹配不上，旧实现会静默返回 ''，
  // 上层据此判定 stopReason=completed —— 静默失败比报错危险得多。
  const contentType = res.headers?.get?.('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    const json = await res.json().catch(() => null)
    const content = json?.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new Error(`${profile.name} 返回了不可解析的响应（content-type="${contentType}"）`)
    }
    return content
  }

  const reader = res.body && res.body.getReader ? res.body.getReader() : undefined
  if (!reader) {
    const json = await res.json()
    return json?.choices?.[0]?.message?.content ?? ''
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    // P0-4: SSE 分帧要兼容 CRLF（\r\n\r\n），否则整帧丢失。
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      for (const line of part.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          const delta = json?.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
            full += delta
            if (opts.onChunk) opts.onChunk(delta)
          }
        } catch {
          // 忽略解析不了的行（keep-alive 等）
        }
      }
    }
  }
  return full
}

// ── 提示词模板（让 UI 数据层照常工作）──────────────────────────────────────

/**
 * swarm 的数据层靠"提示词驱动"：agent 主动输出计划 / 汇报 TODO / 给最终结果。
 * 我们没有 DSH 的 todo 工具和文件写入，所以用提示词 + 解析来替代。
 * @param {{task:string, rolePrompt?:string, objective?:string, outlinePlan?:boolean}} opts
 * @returns {string}
 */
export function buildPrompt(opts) {
  const parts = []
  if (opts.objective) parts.push(`总体目标：${opts.objective}`)
  if (opts.rolePrompt) parts.push(`你的角色：${opts.rolePrompt}`)
  parts.push(`任务：${opts.task}`)

  if (opts.outlinePlan) {
    parts.push(
      '',
      '开始前先输出你的计划，用这个 JSON 格式（放在 ```json 代码块里）：',
      '```json',
      '{"plan":[{"title":"第一步"},{"title":"第二步"}]}',
      '```',
      '',
      '然后逐步执行。每完成一步，用一行 `TODO: [done] 描述` 或 `TODO: [todo] 描述` 汇报进度。',
      '全部完成后，输出最终结果，并以一行 `RESULT:` 开头给出总结。'
    )
  } else {
    parts.push('', '完成后用一行 `RESULT:` 开头给出最终结果。')
  }
  return parts.join('\n')
}

/**
 * 从 agent 输出里解析计划
 * @param {string} output
 * @returns {{title:string}[]|undefined}
 */
export function parsePlanFromOutput(output) {
  const fenced = output.match(/```json\s*([\s\S]*?)```/i)
  const target = fenced ? fenced[1] : output
  const start = target.indexOf('{"plan"')
  if (start === -1) return undefined
  let depth = 0
  let end = -1
  for (let i = start; i < target.length; i++) {
    if (target[i] === '{') depth++
    else if (target[i] === '}') {
      depth--
      if (depth === 0) { end = i + 1; break }
    }
  }
  if (end === -1) return undefined
  try {
    const json = JSON.parse(target.slice(start, end))
    if (!Array.isArray(json?.plan)) return undefined
    return json.plan
      .filter((p) => p && typeof p.title === 'string')
      .map((p) => ({ title: p.title }))
  } catch {
    return undefined
  }
}

/**
 * 从 agent 输出里解析 TODO 行
 * @param {string} output
 * @returns {{text:string, done:boolean}[]}
 */
export function parseTodos(output) {
  const out = []
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/TODO:\s*\[(done|todo)\]\s*(.+)/i)
    if (m) out.push({ text: m[2].trim(), done: m[1].toLowerCase() === 'done' })
  }
  return out
}

/**
 * 从 agent 输出里解析最终结果
 * @param {string} output
 * @returns {string|undefined}
 */
export function parseResult(output) {
  const m = output.match(/RESULT:\s*([\s\S]+)$/)
  return m ? m[1].trim() : undefined
}


// ═══════════════════════════════════════════════════════════════
// 接入 swarm：把 callChat 伪装成 swarm 认识的 run 对象
// ═══════════════════════════════════════════════════════════════
/**
 * P1 · 适配器接入 swarm —— 把 callChat 伪装成 swarm 认识的 run 对象。
 *
 * swarm 侧只用这四样（源码 index.js）：
 *   run.id            → childId，关联产物/日志
 *   run.result        → Promise<{stopReason, output}>
 *   run.dispose()     → 取消时清理
 *
 * 上层 spawn() 里这些代码全部不用改：
 *   runsFor(session.id).set(run.id, run)
 *   childToRoster.set(run.id, {...})
 *   run.result.then(...).catch(...)
 *   run.dispose().catch(() => {})
 */


/**
 * @typedef {Object} SwarmLike
 * @property {(sessionId: string, type: string, data: Object) => void} emitSwarmEvent
 * @property {(sessionId: string) => void} persist
 * @property {(sessionId: string, agentId: string, patch: Object) => void} upsertAgent
 */

/**
 * @typedef {Object} SpawnSpec
 * @property {string} id
 * @property {string} name
 * @property {string} role
 * @property {string} task
 * @property {string} [rolePrompt]
 * @property {string} [objective]
 * @property {boolean} [outlinePlan]
 * @property {string} [model]
 * @property {string} [reasoningEffort]
 */

/**
 * @typedef {Object} SpawnContext
 * @property {string} sessionId
 * @property {string} agentId
 * @property {SwarmLike} swarm
 * @property {import('./external-agent-adapter.js').AgentProfile} profile
 * @property {AbortSignal} [signal]
 */

/**
 * 造一个"看起来像 DSH subagent run"的句柄，内部走国内 API。
 * @param {SpawnSpec} spec
 * @param {SpawnContext} ctx
 * @returns {import('./external-agent-adapter.js').AdapterRun}
 */
export function createAdapterRun(spec, ctx) {
  // P1-8: 同毫秒并发创建会重号（Date.now().toString(36) 精度只到毫秒）。
  const runId = `run-${spec.id}-${randomUUID().slice(0, 8)}`
  const swarm = ctx.swarm
  const sessionId = ctx.sessionId
  const agentId = ctx.agentId
  const profile = ctx.profile

  let aborted = false
  const controller = new AbortController()
  if (ctx.signal) {
    ctx.signal.addEventListener('abort', () => {
      aborted = true
      controller.abort()
    })
  }

  const result = (async () => {
    const prompt = buildPrompt({
      task: spec.task,
      rolePrompt: spec.rolePrompt,
      objective: spec.objective,
      outlinePlan: spec.outlinePlan === true,
    })

    const systemPrompt = spec.rolePrompt
      ? `你是 ${spec.rolePrompt}。你是团队协作 agent，完成任务并输出可解析的结构化结果。`
      : undefined

    swarm.upsertAgent(sessionId, agentId, { childId: runId, status: 'active', progress: 0 })
    swarm.emitSwarmEvent(sessionId, 'swarm/agent/child', { agentId, childId: runId })
    swarm.emitSwarmEvent(sessionId, 'swarm/agent/status', { agentId, status: 'active', progress: 0 })

    try {
      let buffer = ''
      let lastProgress = 0
      const output = await callChat({
        profile,
        prompt,
        systemPrompt,
        model: spec.model,
        reasoningEffort: spec.reasoningEffort,
        signal: controller.signal,
        onChunk: (delta) => {
          buffer += delta
          // R1: 步长节流。每跨 4 个百分点才发一条，压住 chunk 密集时的事件风暴。
          // 上一版只判"值变没变"，60 字符/chunk 时每块跨 3%，300 chunk 实测 34 条
          // （阈值 ≤30）。步长 4 → 最多 24 条 + 首尾两条。
          const progress = Math.min(95, Math.round((buffer.length / PROGRESS_FULL_CHARS) * 100))
          if (progress - lastProgress < 4) return
          lastProgress = progress
          swarm.upsertAgent(sessionId, agentId, { progress })
          swarm.emitSwarmEvent(sessionId, 'swarm/agent/status', { agentId, status: 'active', progress })
        },
      })

      if (aborted) {
        swarm.upsertAgent(sessionId, agentId, { status: 'cancelled', progress: 0 })
        swarm.emitSwarmEvent(sessionId, 'swarm/agent/status', { agentId, status: 'cancelled', progress: 0 })
        return { stopReason: 'cancelled', output: null }
      }

      // ── 把 agent 输出翻译成 swarm 数据层要的字段 ──
      const patch = {}

      // P1-7: TODO 要在 plan 之前解析 —— 计划状态由 TODO 回填，
      // 不能无条件写死 'done'（那等于伪造进度：模型只输出了计划、
      // TODO 全未完成时，UI 也会显示三步全完成）。
      const todos = parseTodos(output)
      const doneCount = todos.filter((t) => t.done).length

      if (spec.outlinePlan) {
        const plan = parsePlanFromOutput(output)
        if (plan) {
          // 三种回填策略：
          //   条数一致   → 逐条按 t.done 决定
          //   条数不一致 → 按完成比例，前 floor(ratio*n) 条为 done
          //   没有 TODO  → 全部 'todo'
          let statuses
          if (todos.length === 0) {
            statuses = plan.map(() => 'todo')
          } else if (todos.length === plan.length) {
            statuses = todos.map((t) => (t.done ? 'done' : 'todo'))
          } else {
            const ratio = doneCount / todos.length
            const doneCountForPlan = Math.floor(ratio * plan.length)
            statuses = plan.map((_, i) => (i < doneCountForPlan ? 'done' : 'todo'))
          }

          const items = plan.map((p, i) => ({
            id: `${agentId}-plan-${i}`,
            title: p.title,
            status: statuses[i],
            ownerId: agentId,
            minProgress: Math.round((i / plan.length) * 100),
            // maxProgress 与 status 一致：未完成的步骤不占满进度区间
            maxProgress: statuses[i] === 'done'
              ? Math.round(((i + 1) / plan.length) * 100)
              : Math.round((i / plan.length) * 100),
          }))
          patch.plan = items
          swarm.emitSwarmEvent(sessionId, 'swarm/agent/plan', { agentId, plan: items })
        }
      }

      if (todos.length > 0) {
        patch.todos = todos.map((t, i) => ({ id: `${agentId}-todo-${i}`, text: t.text, done: t.done }))
      }

      // P1-11: 日志由实际发生的事生成，不提前写入"完成"结论。
      const logs = [
        { id: `${agentId}-log-0`, type: 'action', content: `调用 ${profile.name} (${spec.model || profile.models[0]})` },
      ]
      for (const [i, t] of todos.entries()) {
        logs.push({
          id: `${agentId}-log-todo-${i}`,
          type: 'action',
          content: `${t.done ? '已完成' : '进行中'}：${t.text}`,
        })
      }
      const finalText = parseResult(output)
      if (finalText !== undefined) {
        logs.push({ id: `${agentId}-log-result`, type: 'result', content: finalText })
      }
      patch.logs = logs

      // 产物：P2 阶段把最终结果落成文件（swarm 靠扫描文件 + 标记归因）
      patch.artifacts = []

      swarm.upsertAgent(sessionId, agentId, patch)
      swarm.upsertAgent(sessionId, agentId, { status: 'complete', progress: 100 })
      swarm.persist(sessionId)
      swarm.emitSwarmEvent(sessionId, 'swarm/agent/status', { agentId, status: 'complete', progress: 100 })

      // output 是流式累积的完整文本（含计划JSON + TODO + RESULT）
      // 解析器从完整文本里提取各部分；parseResult 只作为 result 的展示值
      const finalResult = parseResult(output) || output
      return { stopReason: 'completed', output, finalOutput: finalResult }
    } catch (error) {
      // P1-5: 取消要归为 cancelled，不是 error。
      // abort 会让 fetch 先抛异常直接进 catch，所以这里必须自己判，
      // 否则 dispose 掉的任务会被记成失败（swarm 会把它算进 error 统计）。
      const cancelled = aborted || controller.signal.aborted
      const status = cancelled ? 'cancelled' : 'error'
      swarm.upsertAgent(sessionId, agentId, { status, progress: 0 })
      swarm.persist(sessionId)
      swarm.emitSwarmEvent(sessionId, 'swarm/agent/status', { agentId, status, progress: 0 })
      return {
        stopReason: cancelled ? 'cancelled' : 'error',
        output: cancelled ? null : String(error?.message ?? error),
      }
    }
  })()

  return {
    id: runId,
    result,
    dispose: async () => {
      aborted = true
      controller.abort()
      // 等 result 落定，避免 dispose 早于 result 导致状态不一致
      await result.catch(() => undefined)
    },
  }
}
