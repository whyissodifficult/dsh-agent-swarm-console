/**
 * Swarm Console —— 可安装的 DSH Host 插件骨架（阶段3A）。
 * 只做一件事：把一个任务交给一个外部 agent 执行一次，返回 stopReason / text / ms。
 * 画布与交付门禁尚未实现（见 docs/DETAIL.md）。
 *
 * 复用 plugin/lib/adapter.js 的 callChat —— 唯一实现在包内，不复制第二份。
 * src/external-agent-adapter.js 是反向 re-export 的兼容 shim。
 */
import { callChat } from './lib/adapter.js'

export const inject = ['tools']

/**
 * 校验画像表。每个条目必须有 baseUrl / apiKeyEnv / models 三项，
 * 缺一就 throw —— 激活即失败，不静默跳过。
 */
function validateAgents(agents) {
  if (typeof agents !== 'object' || agents === null || Array.isArray(agents)) {
    throw new Error('externalAgents 必须是对象')
  }
  for (const [name, p] of Object.entries(agents)) {
    if (typeof p !== 'object' || p === null) {
      throw new Error(`externalAgents.${name} 必须是对象`)
    }
    for (const key of ['baseUrl', 'apiKeyEnv', 'models']) {
      const v = p[key]
      const bad = key === 'models' ? !Array.isArray(v) || v.length === 0 : typeof v !== 'string' || v.trim() === ''
      if (bad) throw new Error(`externalAgents.${name}.${key} 缺失或格式不对（必须是 ${key === 'models' ? '非空数组' : '非空字符串'}）`)
    }
  }
}

/** 选一个画像：显式 agent → 唯一条目 → 报错。 */
function pickAgent(agents, requested) {
  if (typeof requested === 'string' && requested !== '') {
    if (agents[requested] === undefined) throw new Error(`未知的 agent "${requested}"`)
    return { name: requested, profile: agents[requested] }
  }
  const names = Object.keys(agents)
  if (names.length === 1) return { name: names[0], profile: agents[names[0]] }
  if (names.length === 0) throw new Error('没有配置任何 externalAgents')
  throw new Error('指定了多个 externalAgents，请用 agent 参数指明用哪一个')
}

/**
 * 跑一次外部 agent。取消时返回 cancelled，不抛。
 * signal 从 exec 透传给 callChat；callChat 内部会把 abort 转成异常，这里捕获后归一化。
 */
async function runExternal(agents, args, signal) {
  const { profile } = pickAgent(agents, args.agent)
  const prompt = typeof args.task === 'string' ? args.task : ''
  if (prompt.trim() === '') throw new Error('task 不能为空')

  try {
    const text = await callChat({
      profile,
      prompt,
      model: typeof args.model === 'string' && args.model !== '' ? args.model : undefined,
      signal,
    })
    return { stopReason: 'completed', text }
  } catch (error) {
    // 取消：exec.signal 触发，或底层 AbortError —— 不抛，归一化成 cancelled
    const aborted = (signal && signal.aborted) || error?.name === 'AbortError' ||
      /abort/i.test(String(error?.message ?? ''))
    if (aborted) return { stopReason: 'cancelled', text: '' }
    return { stopReason: 'error', text: String(error?.message ?? error) }
  }
}

export function apply(ctx, config) {
  const agents = config?.externalAgents ?? {}
  validateAgents(agents)

  ctx.effect(() => ctx.tools.register({
    name: 'swarm_run',
    description: '把一个任务交给一个外部 agent 执行一次，返回 stopReason 与文本结果。',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'externalAgents 里的键；省略则用唯一的那个' },
        task: { type: 'string' },
        model: { type: 'string' },
      },
      required: ['task'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          stopReason: { type: 'string' },
          text: { type: 'string' },
          ms: { type: 'number' },
        },
        required: ['stopReason', 'text', 'ms'],
      },
      render: (args, value) => [{ type: 'text', text: `[${value.stopReason}] ${value.text}` }],
    },
    async execute(args, exec) {
      const t0 = Date.now()
      const { stopReason, text } = await runExternal(agents, args, exec?.signal)
      return { stopReason, text, ms: Date.now() - t0 }
    },
  }))
}
