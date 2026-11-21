/**
 * D5/D6 · verify v1 的宿主无关核心。
 * 三工具的纯逻辑 + 卡片 act 的调用者判定，便于不装 DSH 就能单测。
 * 状态用进程内 Map（v1，不做持久化；D8 明确不做多阶段状态机）。
 */
import { freezeContract } from './contract.js'
import { makeEvidence, evidenceHash } from './evidence.js'
import { decide } from './gate.js'

const contracts = new Map()
const runs = new Map()

/** verify_contract：冻结契约，返回 id。 */
export function verifyContract(input, store = contracts) {
  const c = freezeContract(input)
  store.set(c.id, { contract: c, frozenAt: c.frozenAt })
  return { contractId: c.id }
}

/**
 * verify_run：跑策略 → 三态判定。
 * H1 证据先于验收：evidence 缺失时不判 GREEN（gate 的 R1 已保证）。
 * policy runner 由调用方注入（composePolicy），这里只做编排与落盘。
 */
export function verifyRun({ contractId, evidenceInput, runPolicy }, store = contracts, runStore = runs) {
  const entry = store.get(contractId)
  if (!entry) return { decision: 'RED', reasons: [`未知 contractId ${contractId}`], evidenceHash: '' }

  // H1：既没有证据输入、也没有策略来产出证据 → 直接判 YELLOW，不伪造证据
  if (!evidenceInput && typeof runPolicy !== 'function') {
    const d = decide(entry.contract, { checks: [], artifacts: [] })
    const ev = makeEvidence({ contractId })
    const hash = evidenceHash(ev)
    runStore.set(contractId, { decision: d.decision, at: new Date().toISOString(), evidenceHash: hash })
    return { decision: d.decision, reasons: d.reasons, evidenceHash: hash, reproCmd: d.reproCmd }
  }

  const evidence = typeof runPolicy === 'function'
    ? runPolicy(entry.contract, evidenceInput)
    : makeEvidence({ contractId, ...evidenceInput })

  const d = decide(entry.contract, evidence)
  const hash = evidenceHash(evidence)
  runStore.set(contractId, { decision: d.decision, at: new Date().toISOString(), evidenceHash: hash })
  return {
    decision: d.decision,
    reasons: d.reasons,
    evidenceHash: hash,
    ...(d.reproCmd ? { reproCmd: d.reproCmd } : {}),
  }
}

/** verify_status：最近一次 decision 与时间。 */
export function verifyStatus({ contractId }, runStore = runs) {
  const r = runStore.get(contractId)
  if (!r) return { decision: 'NONE', at: null }
  return { decision: r.decision, at: r.at }
}

/**
 * H3 · act() 的调用者守卫。
 * 非用户（subagent / 代码发起 / 无 session）→ refused + 记拒绝事件。
 * @returns {{status:'refused',reason}|null} null 表示允许继续
 */
export function guardCaller(agent, record) {
  const origin = agent?.session?.header?.origin
  const fromAgent = origin === 'subagent' || agent?.fromAgent === true || agent?.origin === 'subagent'
  const live = agent && typeof agent === 'object' && !agent.disposed
  if (!live || fromAgent) {
    const reason = !live ? 'not-live-root' : 'agent-initiated-not-user'
    if (typeof record === 'function') {
      record(agent, { callId: agent?.callId ?? 'unknown', action: 'dsh-swarm-console/gate', phase: 'refused', data: { reason } })
    }
    return { status: 'refused', reason }
  }
  return null
}

/** 供测试隔离用的空 store。 */
export function newStores() {
  return { contracts: new Map(), runs: new Map() }
}
