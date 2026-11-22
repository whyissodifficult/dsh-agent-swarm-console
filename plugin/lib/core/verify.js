/**
 * D5/D6 · verify v1 的宿主无关核心。
 * 三工具的纯逻辑 + 卡片 act 的调用者判定，便于不装 DSH 就能单测。
 * 状态用进程内 Map（v1，不做持久化；D8 明确不做多阶段状态机）。
 */
import { freezeContract } from './contract.js'
import { makeEvidence, evidenceHash } from './evidence.js'
import { decide } from './gate.js'
import { runChecks } from './checks.js'
import { loadPolicy, policyToChecks } from './policy.js'

const contracts = new Map()
const runs = new Map()

/**
 * P0-4 · 运行状态键 = `${sessionId}:${contractId}`，隔离不同会话的同号契约。
 * sessionId 缺省 'default'（宿主拿不到时用）。
 */
export function runKey(contractId, sessionId = 'default') {
  return `${sessionId}:${contractId}`
}

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
export function verifyRun({ contractId, sessionId, evidenceInput, runPolicy, checkDeps, usePolicy }, store = contracts, runStore = runs) {
  const rk = runKey(contractId, sessionId)
  const entry = store.get(contractId)
  if (!entry) return { decision: 'RED', reasons: [`未知 contractId ${contractId}`], evidenceHash: '' }

  // 0.2.0 P0-3：显式要求用策略且未给 checks 时，按 policy 生成检查请求
  if (usePolicy === true && !evidenceInput && typeof runPolicy !== 'function') {
    const policy = loadPolicy(entry.contract.policyId || 'code-change')
    evidenceInput = { checks: policyToChecks(policy, entry.contract) }
  }

  // H1：既没有证据输入、也没有策略来产出证据 → 直接判 YELLOW，不伪造证据
  if (!evidenceInput && typeof runPolicy !== 'function') {
    const d = decide(entry.contract, { checks: [], artifacts: [] })
    const ev = makeEvidence({ contractId })
    const hash = evidenceHash(ev)
    runStore.set(rk, { decision: d.decision, at: new Date().toISOString(), evidenceHash: hash, missing: d.missing, reproCmd: d.reproCmd })
    return {
      decision: d.decision, reasons: d.reasons, evidenceHash: hash,
      missing: d.missing,
      ...(d.reproCmd ? { reproCmd: d.reproCmd } : {}),
    }
  }

  // 0.2.0：checks 是请求，由插件真实执行（模型自报 ok 被忽略并记 warning）
  const evidence = typeof runPolicy === 'function'
    ? runPolicy(entry.contract, evidenceInput)
    : (() => {
        const executed = runChecks(evidenceInput?.checks ?? [], checkDeps)
        return makeEvidence({
          contractId,
          ...evidenceInput,
          checks: executed.checks,
          warnings: [...(evidenceInput?.warnings ?? []), ...executed.warnings],
        })
      })()

  const d = decide(entry.contract, evidence)
  const hash = evidenceHash(evidence)
  runStore.set(rk, { decision: d.decision, at: new Date().toISOString(), evidenceHash: hash, missing: d.missing, reproCmd: d.reproCmd })
  return {
    decision: d.decision,
    reasons: d.reasons,
    evidenceHash: hash,
    missing: d.missing,
    ...(Array.isArray(evidence.warnings) && evidence.warnings.length > 0 ? { warnings: evidence.warnings } : {}),
    ...(d.reproCmd ? { reproCmd: d.reproCmd } : {}),
  }
}

/** verify_status：最近一次 decision 与时间。 */
export function verifyStatus({ contractId, sessionId }, runStore = runs) {
  const r = runStore.get(runKey(contractId, sessionId))
  // 未知契约返回 known:false，不落进 GREEN/YELLOW/RED 三态（评审必改3）
  if (!r) return { known: false }
  return {
    known: true,
    decision: r.decision,
    at: r.at,
    ...(r.reproCmd ? { reproCmd: r.reproCmd } : {}),
    ...(Array.isArray(r.missing) && r.missing.length > 0 ? { missing: r.missing } : {}),
    ...(r.approved === true ? { approved: true, approvedAt: r.approvedAt } : {}),
    ...(r.stale === true ? { stale: true } : {}),
  }
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

// ── v1 放行入口：斜杠命令核心（宿主无关）─────────────────────────────
// 命令只能由用户触发（斜杠命令不走模型工具），H3 由结构保证，不靠 act 守卫。
// 状态与 verify 同源：契约在 contracts，最近决定在 runs，approved 也写回 runs。

/** /gate-approve：非 GREEN 拒绝；证据过期拒绝；GREEN 记 approved 返回成功。 */
export function gateApprove({ contractId, sessionId, expectedHash }, store = contracts, runStore = runs) {
  if (!store.has(contractId)) return { kind: 'error', text: `未知契约 ${contractId}` }
  const rk = runKey(contractId, sessionId)
  const r = runStore.get(rk)
  if (!r) return { kind: 'error', text: '尚无门禁决定，请先执行 verify_run' }
  if (r.decision !== 'GREEN') {
    return { kind: 'error', text: `非 GREEN 不可放行，请先 /gate-retry ${contractId}` }
  }
  // P0-4：evidenceHash 与最近一次 verify_run 不一致 → 证据已过期
  if (expectedHash !== undefined && r.evidenceHash !== expectedHash) {
    return { kind: 'error', text: '证据已过期，请重新 verify_run' }
  }
  runStore.set(rk, { ...r, approved: true, approvedAt: new Date().toISOString(), by: 'user', stale: false })
  return { kind: 'success', text: `契约 ${contractId} 已由用户放行（approved）` }
}

/** /gate-retry：空证据重算 → YELLOW；保留 approved 但置 stale、清 approvedAt。 */
export function gateRetry({ contractId, sessionId }, store = contracts, runStore = runs) {
  if (!store.has(contractId)) return { kind: 'error', text: `未知契约 ${contractId}` }
  const rk = runKey(contractId, sessionId)
  const before = runStore.get(rk)
  const wasApproved = before?.approved === true
  const r = verifyRun({ contractId, sessionId, evidenceInput: undefined }, store, runStore)
  // verifyRun 覆盖了整条记录，把旧的 approved/stale 语义补回来
  const after = runStore.get(rk)
  if (wasApproved) runStore.set(rk, { ...after, approved: true, stale: true, approvedAt: undefined, by: before.by })
  else runStore.set(rk, { ...after, stale: true })
  const now = verifyStatus({ contractId, sessionId }, runStore)
  return {
    kind: 'success',
    text: `契约 ${contractId} 已重算：${r.decision} @ ${now.at}${wasApproved ? ' [stale]（原放行已失效）' : ''}。需重新执行 verify_run 补证据后才可能转 GREEN。`,
  }
}

/** /gate-status：最近决定 + 时间 + 是否 approved / stale；未知契约 error。 */
export function gateStatus({ contractId, sessionId }, store = contracts, runStore = runs) {
  if (!store.has(contractId)) return { kind: 'error', text: `未知契约 ${contractId}` }
  const r = runStore.get(runKey(contractId, sessionId))
  if (!r) return { kind: 'success', text: `契约 ${contractId} 尚无门禁决定` }
  const approved = r.approved === true
  const stale = r.stale === true
  const head = `契约 ${contractId}：最近决定 ${r.decision} @ ${r.at}${stale ? ' [stale]' : ''}${approved ? `；已由 ${r.by ?? 'user'} 放行${stale ? '（已过期）' : ` @ ${r.approvedAt}`}` : '；尚未放行'}`
  // H2 可见性：RED 必须把复现命令亮给用户，YELLOW 必须把缺失证据亮出来
  const extra = []
  if (r.reproCmd) extra.push(`复现：${r.reproCmd}`)
  if (Array.isArray(r.missing) && r.missing.length > 0) extra.push(`缺失证据：${r.missing.join('；')}`)
  return { kind: 'success', text: [head, ...extra].join('\n') }
}
