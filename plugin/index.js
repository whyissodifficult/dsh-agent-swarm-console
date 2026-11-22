/**
 * Swarm Console —— 可安装的 DSH Host 插件骨架（阶段3A）。
 * 只做一件事：把一个任务交给一个外部 agent 执行一次，返回 stopReason / text / ms。
 * 画布与交付门禁尚未实现（见 docs/DETAIL.md）。
 *
 * 复用 plugin/lib/adapter.js 的 callChat —— 唯一实现在包内，不复制第二份。
 * src/external-agent-adapter.js 是反向 re-export 的兼容 shim。
 */
import { callChat } from './lib/adapter.js'
import { z } from './lib/core/mini-schema.js'
import { verifyContract, verifyRun, verifyStatus, guardCaller, gateApprove, gateRetry, gateStatus, gateFreeze } from './lib/core/verify.js'

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

  registerVerifyTools(ctx)
  registerGateCommands(ctx)
  // 卡片与 skill 是可选增强（仅在挂载 action-cards 的 profile 生效）；v1 默认入口是斜杠命令。
  // 两者都各自降级，任一失败都不阻塞 verify_* 三工具与斜杠命令。
  registerGateSkill(ctx)
  registerGateCard(ctx)
}

/**
 * C1/C2 · 门禁放行斜杠命令（v1 默认入口，用户触发，不走模型工具）。
 * commands 由 dsh base 自带；仍走 inject 保持挂载时机安全。
 * 命令名 kebab-case、不带斜杠；handler 返回 {kind:'success'|'error', text}。
 */
/** P0-4 · 从工具/命令调用上下文取 sessionId，拿不到用 default。 */
function sessionOf(invocation) {
  const id = invocation?.agent?.session?.id
  return typeof id === 'string' && id !== '' ? id : 'default'
}

function registerGateCommands(ctx) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['commands'], (ctx) => {
    const commands = ctx.commands
    if (!commands || typeof commands.register !== 'function') return
    const defs = [
      {
        name: 'gate-approve',
        description: '放行一个已 GREEN 的门禁契约（仅用户可触发）',
        input: { hint: '<contractId> <evidenceHash>' },
        // 可传第二参数 evidenceHash 做过期校验；不传时以 runs 里的为最新
        handler: ({ agent, rawInput }) => {
          const parts = String(rawInput ?? '').trim().split(/\s+/)
          // P0-6：第二个参数 evidenceHash 必填，不传时 gateApprove 会返回明确提示
          return gateApprove({
            contractId: parts[0] ?? '',
            sessionId: sessionOf({ agent }),
            expectedHash: parts[1],
          })
        },
      },
      {
        name: 'gate-freeze',
        description: '确认（冻结）一个任务契约，确认后才能执行 verify_run（仅用户可触发）',
        input: { hint: '<contractId|前缀>' },
        handler: ({ agent, rawInput }) => gateFreeze({ contractId: String(rawInput ?? '').trim(), sessionId: sessionOf({ agent }) }),
      },
      {
        name: 'gate-retry',
        description: '重跑某契约的门禁校验并刷新决定',
        input: { hint: '<contractId>' },
        handler: async ({ agent, rawInput }) => await gateRetry({ contractId: String(rawInput ?? '').trim(), sessionId: sessionOf({ agent }) }),
      },
      {
        name: 'gate-status',
        description: '查看门禁状态：不带参数列出本会话所有契约，带参数看单条（支持 id 前缀）',
        input: { hint: '[<contractId|前缀>]' },
        handler: ({ agent, rawInput }) => gateStatus({ contractId: String(rawInput ?? '').trim(), sessionId: sessionOf({ agent }) }),
      },
    ]
    for (const def of defs) ctx.effect(() => commands.register(def))
  })
}

/**
 * 必改1 · 注册运行期 skill，让门禁卡的 propose_action 可用。
 * DSH action-cards 的规则：根 Agent 必须先加载该种类声明的 Skill，propose_action 才会出现。
 * 宿主无 skills 服务或注册失败时静默跳过（只影响卡片，不影响三工具）。
 */
const GATE_SKILL_NAME = 'dsh-swarm-console-verify'
const GATE_SKILL_CONTENT = [
  '# Swarm Console 门禁',
  '',
  '当你需要把任务契约冻结、跑证据校验、或让用户对门禁结论做放行决定时使用本 skill。',
  '流程：verify_contract → verify_run → verify_status；结论为 GREEN/YELLOW/RED。',
  '',
  '- 先调用 verify_contract 冻结目标与验收条件，拿到 contractId。',
  '- 再调用 verify_run 得到判定。RED 的复现命令会随输出给出，可复制执行。',
  '- 需要用户决定时，用 propose_action 提议门禁卡（action: dsh-swarm-console/gate）。',
  '- approve = 用户放行，仅在 GREEN 时允许；非 GREEN 不得 approve，应 retry。',
  '- retry = 重跑校验并刷新卡片；只有用户可以操作卡片，agent 代批会被拒绝。',
  '',
  '不要用本 skill 承诺画布或多阶段状态机（尚未实现）。',
].join('\n')

function registerGateSkill(ctx) {
  // 可选服务走 inject：apply 阶段同步 get 时，晚挂载的服务还没就绪。
  // 服务缺席时 inject 不触发回调，不抛错，verify_* 三工具照常注册。
  try {
    if (typeof ctx.inject !== 'function') return
    ctx.inject(['skills'], (ctx) => {
      try {
        const skills = ctx.skills
        if (!skills || typeof skills.register !== 'function') return
        ctx.effect(() => skills.register({
          name: GATE_SKILL_NAME,
          description: 'Swarm Console 交付门禁：冻结契约、跑证据校验、由用户 approve/retry。',
          content: GATE_SKILL_CONTENT,
          source: 'runtime', // SkillRegistration 必填；缺它 skill 能注册但加载失败
          invocation: { modelInvocable: true, userInvocable: true },
        }))
      } catch {
        // 注册失败不阻塞三工具
      }
    })
  } catch {
    // inject 本身失败也不阻塞
  }
}

/** D5 · 三个 verify 工具。核心逻辑在 lib/core/verify.js，这里只做薄封装。 */
function registerVerifyTools(ctx) {
  const defs = [
    {
      name: 'verify_contract',
      description: '冻结一个任务契约（目标/约束/验收条件），返回 contract.id。契约内容变化会换 id。',
      parameters: {
        type: 'object',
        properties: {
          objective: { type: 'string' },
          workspaceRoot: { type: 'string', description: '检查的根目录（绝对路径，必须存在）' },
          testCmd: { type: 'string', description: 'exec 检查唯一允许的命令（白名单）；不填则拒绝一切 exec' },
          policyId: { type: 'string', description: '显式声明才启用策略（如 code-change）' },
          constraints: { type: 'array', items: { type: 'string' } },
          criteria: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
                checkIds: { type: 'array', items: { type: 'string' } },
              },
              required: ['id', 'text'],
            },
          },
        },
        required: ['objective', 'workspaceRoot'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { contractId: { type: 'string' }, pending: { type: 'boolean' }, hint: { type: 'string' } }, required: ['contractId'] },
        render: (args, v) => [{ type: 'text', text: `contract ${v.contractId} 已冻结（待确认）\n${v.hint ?? `等待用户确认：/gate-freeze ${v.contractId}`}` }],
      },
      execute: async (args, exec) => verifyContract(args, sessionOf(exec)),
    },
    {
      name: 'verify_run',
      description: '按策略跑一次证据校验，返回 GREEN/YELLOW/RED 三态与可复现命令。',
      parameters: {
        type: 'object',
        properties: {
          contractId: { type: 'string' },
          checks: { type: 'array', items: { type: 'object' } },
        },
        required: ['contractId'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            decision: { type: 'string' }, reasons: { type: 'array', items: { type: 'string' } },
            evidenceHash: { type: 'string' }, reproCmd: { type: 'string' },
            missing: { type: 'array', items: { type: 'string' } },
          },
          required: ['decision', 'reasons', 'evidenceHash'],
        },
        render: (args, v) => {
          const lines = [`门禁 ${v.decision}：${v.reasons.join('；')}`]
          // 必改2：RED 必带可复制复现命令；YELLOW 附缺失证据摘要
          if (v.decision === 'RED') {
            if (v.reproCmd) lines.push(`复现：${v.reproCmd}`)
          }
          if (v.decision === 'YELLOW' && Array.isArray(v.missing) && v.missing.length > 0) {
            lines.push(`缺失证据：${v.missing.join('；')}`)
          }
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      execute: async (args, exec) => {
        // D4: diff 取宿主 workspaceChanges，不自建 diff
        const wc = exec?.workspaceChanges ?? {}
        const diffEvidence = typeof wc.summary === 'string' ? wc.summary : (typeof wc.diff === 'string' ? wc.diff : undefined)
        const evidenceInput = args.checks ? { checks: args.checks, diff: diffEvidence } : undefined
        // 0.2.0 P0-3：未显式给 checks 时按 code-change 策略生成检查请求
        return await verifyRun({ contractId: args.contractId, sessionId: sessionOf(exec), evidenceInput, usePolicy: !evidenceInput })
      },
    },
    {
      name: 'verify_status',
      description: '查某个契约最近一次门禁决定与时间。',
      parameters: {
        type: 'object',
        properties: { contractId: { type: 'string' } },
        required: ['contractId'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            known: { type: 'boolean' },
            confirmed: { type: 'boolean' },
            confirmedAt: { type: 'string' },
            decision: { type: 'string' },
            at: { type: 'string' },
            reproCmd: { type: 'string' },
            missing: { type: 'array', items: { type: 'string' } },
            approved: { type: 'boolean' },
            approvedAt: { type: 'string' },
            evidenceHash: { type: 'string' },
            stale: { type: 'boolean' },
            lastApprovedAt: { type: 'string' },
          },
          required: ['known'],
        },
        render: (args, v) => {
          if (!v.known) return [{ type: 'text', text: '未知 contractId，尚无门禁记录' }]
          const confirmText = v.confirmed ? `已确认${v.confirmedAt ? ' @ ' + v.confirmedAt : ''}` : '待确认（/gate-freeze）'
          const lines = [`${confirmText}；最近决定 ${v.decision}${v.at ? ' @ ' + v.at : ''}${v.approved ? `；已由用户放行 @ ${v.approvedAt}` : '；尚未放行'}`]
          if (v.evidenceHash) lines.push(`证据：${v.evidenceHash}`)
          if (v.stale) lines.push(`[stale] 上次放行已失效${v.lastApprovedAt ? `（${v.lastApprovedAt}）` : ''}`)
          if (v.reproCmd) lines.push(`复现：${v.reproCmd}`)
          if (Array.isArray(v.missing) && v.missing.length > 0) lines.push(`缺失证据：${v.missing.join('；')}`)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      execute: async (args, exec) => verifyStatus({ contractId: args.contractId, sessionId: sessionOf(exec) }),
    },
  ]
  for (const def of defs) ctx.effect(() => ctx.tools.register(def))
}

/**
 * D5 · 门禁卡片种类。
 * 用 ctx.get('actionCards') 可选获取 —— 宿主未装 action-cards 服务时跳过（不阻塞 swarm_run）。
 * details 用零依赖 mini-schema 满足 safeParse 鸭子类型。
 */
function registerGateCard(ctx) {
  // 仅在挂载 action-cards 的 profile 生效；v1 默认放行入口是斜杠命令（见 registerGateCommands）。
  // 可选服务走 inject：actionCards 来自另一层 bundle，晚于本插件挂载，apply 时 get 取不到。
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['actionCards'], (ctx) => {
    const cards = ctx.actionCards
    if (!cards || typeof cards.register !== 'function') return

    const details = z.object({
      decision: z.enum(['GREEN', 'YELLOW', 'RED']),
      reasons: z.array(z.string()),
      contractId: z.string({ nonempty: true }),
      reproCmd: z.optional(z.string()),
    })

    ctx.effect(() => cards.register({
      action: 'dsh-swarm-console/gate',
      skill: GATE_SKILL_NAME,
      invitation: '验收结论已出。请查看门禁卡片并选择 approve 放行或 retry 重跑。',
      details,
      verbs: { approve: { writes: true }, retry: { writes: true } },
      openPhases: ['proposed', 'refused'],
      async act(agent, proposal, verb, payload) {
        // H3：放行只能由用户触发。非用户（subagent / 代码发起）拒绝并记事件。
        const guard = guardCaller(agent, (a, decision) => cards.record(a, decision))
        if (guard) return guard

        const { contractId, decision } = proposal.details
        if (verb === 'approve') {
          if (decision !== 'GREEN') {
            cards.record(agent, { callId: proposal.callId, action: proposal.action, phase: 'refused', data: { reason: '非 GREEN 不可放行' } })
            return { status: 'refused', reason: '非 GREEN 不可放行' }
          }
          const d = { callId: proposal.callId, action: proposal.action, phase: 'approved', data: { contractId } }
          cards.record(agent, d)
          return { status: 'settled', decision: d }
        }
        if (verb === 'retry') {
          const r = await verifyRun({ contractId, sessionId: sessionOf({ agent }), evidenceInput: payload?.evidence })
          const d = {
            callId: proposal.callId, action: proposal.action, phase: 'proposed',
            data: { contractId, decision: r.decision, reasons: r.reasons, ...(r.reproCmd ? { reproCmd: r.reproCmd } : {}) },
          }
          cards.record(agent, d)
          return { status: 'settled', decision: d }
        }
        return { status: 'refused', reason: `未知操作 ${verb}` }
        },
    }))
  })
}
