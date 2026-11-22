/**
 * D5/D6 · verify 核心（0.3.0 破坏性变更）。
 *
 * 变更点：
 *  - 契约按会话隔离：键 `${sessionId}:${contractId}`（与 runs 一致）
 *  - policy 仅当契约显式声明 policyId 且策略检查被契约 checkIds 全覆盖时才启用（P0-1）
 *  - 检查以 contract.workspaceRoot 为根、exec 受 contract.testCmd 白名单约束（P0-2/P0-4）
 *  - approve 必须携带 evidenceHash 自证；retry 置 stale 并保留上次放行信息（P0-6/P1-1）
 */
import { freezeContract } from './contract.js'
import { makeEvidence, evidenceHash } from './evidence.js'
import { decide } from './gate.js'
import { runChecks } from './checks.js'
import { loadPolicy, policyToChecks, policyCheckIds } from './policy.js'

const contracts = new Map()
const runs = new Map()

/** 运行状态键：`${sessionId}:${contractId}` */
export function runKey(contractId, sessionId = 'default') {
  return `${sessionId}:${contractId}`
}

/** 契约键：与 runKey 同构，保证契约和状态在同一会话维度 */
export function contractKey(contractId, sessionId = 'default') {
  return `${sessionId}:${contractId}`
}

function splitKey(key) {
  const idx = key.indexOf(':')
  return idx < 0 ? ['default', key] : [key.slice(0, idx), key.slice(idx + 1)]
}

/** verify_contract：冻结契约（按会话存），进入待确认状态。 */
export function verifyContract(input, sessionId = 'default', store = contracts, runStore = runs) {
  const c = freezeContract(input)
  store.set(contractKey(c.id, sessionId), { contract: c, frozenAt: c.frozenAt })
  const rk = runKey(c.id, sessionId)
  // 0.4.0：确认是状态不是内容——同一契约重复冻结不重置已确认
  if (!runStore.has(rk)) runStore.set(rk, { confirmed: false })
  return {
    contractId: c.id,
    pending: true,
    hint: `契约已冻结，等待用户确认：/gate-freeze ${c.id}`,
  }
}

/**
 * 0.4.0 · /gate-freeze：用户确认契约（模型无对应工具，H3 由结构保证）。
 * 确认状态与会话/契约绑定，不进入契约哈希。
 */
export function gateFreeze({ contractId, sessionId = 'default' }, store = contracts, runStore = runs) {
  const resolved = resolveContractId(contractId, sessionId, store)
  if (resolved.error) return { kind: 'error', text: resolved.error }
  const id = resolved.id
  const rk = runKey(id, sessionId)
  const prev = runStore.get(rk) ?? {}
  if (prev.confirmed === true) {
    return { kind: 'success', text: `契约 ${id} 已确认（${prev.confirmedAt}），无需重复` }
  }
  runStore.set(rk, { ...prev, confirmed: true, confirmedAt: new Date().toISOString(), confirmedBy: 'user' })
  return { kind: 'success', text: `契约 ${id} 已由用户确认（frozen），现在可以执行 verify_run` }
}

/**
 * P1-4 · 前缀解析：最短 4 位，范围限定本会话。
 * @returns {{id?:string, error?:string}}
 */
export function resolveContractId(input, sessionId = 'default', store = contracts) {
  const raw = String(input ?? '').trim()
  if (raw === '') return { error: '缺少契约 id' }
  if (raw.length < 4) return { error: '契约 id 前缀至少 4 位' }
  const ids = [...store.keys()]
    .filter((k) => splitKey(k)[0] === sessionId)
    .map((k) => splitKey(k)[1])
  if (ids.includes(raw)) return { id: raw }
  const hits = ids.filter((id) => id.startsWith(raw))
  if (hits.length === 1) return { id: hits[0] }
  if (hits.length === 0) return { error: `未知契约 ${raw}` }
  return { error: `前缀 ${raw} 命中多个契约：${hits.join(', ')}` }
}

/**
 * verify_run：执行检查请求 → 三态判定。
 * H1：没有检查请求时不判 GREEN（gate 的 R1 保证）。
 */
export async function verifyRun({ contractId, sessionId = 'default', evidenceInput, runPolicy, checkDeps, usePolicy }, store = contracts, runStore = runs) {
  const rk = runKey(contractId, sessionId)
  const entry = store.get(contractKey(contractId, sessionId))
  if (!entry) return { decision: 'RED', reasons: [`未知 contractId ${contractId}`], evidenceHash: '' }
  const contract = entry.contract

  // 0.4.0：契约必须由用户确认，否则不生成检查、不写 evidence
  const prevRun = runStore.get(rk)
  if (prevRun?.confirmed !== true) {
    return {
      decision: 'RED',
      reasons: [`契约尚未由用户确认，请先 /gate-freeze ${contractId}`],
      evidenceHash: '',
    }
  }

  // P0-1：只有契约显式声明 policyId，且策略的每个检查 id 都被契约 checkIds 覆盖，才启用策略
  let policyNote
  if (usePolicy === true && !evidenceInput && typeof runPolicy !== 'function' && typeof contract.policyId === 'string') {
    let policy
    try {
      policy = loadPolicy(contract.policyId)
    } catch {
      return { decision: 'RED', reasons: [`未知策略 ${contract.policyId}（可用策略见 plugin/policies）`], evidenceHash: '' }
    }
    const declared = policyCheckIds(policy)
    const covered = new Set(contract.criteria.flatMap((c) => c.checkIds))
    const uncovered = declared.filter((id) => !covered.has(id))
    if (declared.length > 0 && uncovered.length === 0) {
      evidenceInput = { checks: policyToChecks(policy, contract) }
    } else if (declared.length > 0) {
      policyNote = `策略未提供/未被契约覆盖的检查：${uncovered.join(', ')}`
    }
  }

  // H1：没有检查请求 → 不伪造证据
  if (!evidenceInput && typeof runPolicy !== 'function') {
    const d = decide(contract, { checks: [], artifacts: [] })
    const ev = makeEvidence({ contractId })
    const hash = evidenceHash(ev)
    runStore.set(rk, { ...confirmFlags(prevRun), decision: d.decision, at: new Date().toISOString(), evidenceHash: hash, missing: d.missing, reproCmd: d.reproCmd })
    return {
      decision: d.decision,
      reasons: policyNote ? [...d.reasons, policyNote] : d.reasons,
      evidenceHash: hash,
      missing: d.missing,
      ...(d.reproCmd ? { reproCmd: d.reproCmd } : {}),
    }
  }

  const evidence = typeof runPolicy === 'function'
    ? await runPolicy(contract, evidenceInput)
    : await (async () => {
        const executed = await runChecks(evidenceInput?.checks ?? [], {
          workspaceRoot: contract.workspaceRoot,
          testCmd: contract.testCmd,
          ...checkDeps,
        })
        return makeEvidence({
          contractId,
          ...evidenceInput,
          checks: executed.checks,
          warnings: [...(evidenceInput?.warnings ?? []), ...executed.warnings],
        })
      })()

  const d = decide(contract, evidence)
  const hash = evidenceHash(evidence)
  runStore.set(rk, { ...confirmFlags(prevRun), decision: d.decision, at: new Date().toISOString(), evidenceHash: hash, missing: d.missing, reproCmd: d.reproCmd })
  return {
    decision: d.decision,
    reasons: policyNote ? [...d.reasons, policyNote] : d.reasons,
    evidenceHash: hash,
    missing: d.missing,
    ...(Array.isArray(evidence.warnings) && evidence.warnings.length > 0 ? { warnings: evidence.warnings } : {}),
    ...(d.reproCmd ? { reproCmd: d.reproCmd } : {}),
  }
}

/** verify_status：最近决定 + 证据 hash + 放行/失效状态（P0-6 要求输出证据行）。 */
export function verifyStatus({ contractId, sessionId = 'default' }, runStore = runs) {
  const r = runStore.get(runKey(contractId, sessionId))
  if (!r) return { known: false }
  return {
    known: true,
    confirmed: r.confirmed === true,
    ...(r.confirmedAt ? { confirmedAt: r.confirmedAt } : {}),
    // 刚 freeze、还没跑过 verify_run 时这三个字段是 undefined；
    // 直接返回会让工具输出变成非法 JSON（not lossless JSON），必须省略
    ...(r.decision ? { decision: r.decision } : {}),
    ...(r.at ? { at: r.at } : {}),
    ...(r.evidenceHash ? { evidenceHash: r.evidenceHash } : {}),
    ...(r.reproCmd ? { reproCmd: r.reproCmd } : {}),
    ...(Array.isArray(r.missing) && r.missing.length > 0 ? { missing: r.missing } : {}),
    ...(r.approved === true ? { approved: true, approvedAt: r.approvedAt } : {}),
    ...(r.stale === true ? { stale: true, lastApprovedAt: r.lastApprovedAt, lastApprovedHash: r.lastApprovedHash } : {}),
  }
}

/**
 * H3 · 卡片 act 的调用者守卫（卡片为可选增强；v1 默认入口是斜杠命令）。
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

// ── 放行入口：斜杠命令核心（用户触发；模型无对应工具）─────────────────

/** /gate-approve：必须带 evidenceHash 自证；非 GREEN 拒绝；hash 不一致拒绝。 */
export function gateApprove({ contractId, sessionId = 'default', expectedHash }, store = contracts, runStore = runs) {
  const resolved = resolveContractId(contractId, sessionId, store)
  if (resolved.error) return { kind: 'error', text: resolved.error }
  const id = resolved.id
  const rk = runKey(id, sessionId)
  const r = runStore.get(rk)
  if (!r) return { kind: 'error', text: '尚无门禁决定，请先执行 verify_run' }
  if (typeof expectedHash !== 'string' || expectedHash.trim() === '') {
    return { kind: 'error', text: `缺少 evidenceHash：请先用 /gate-status ${id} 查看并复制「证据：<hash>」，再执行 /gate-approve ${id} <hash>` }
  }
  if (r.decision !== 'GREEN') {
    return { kind: 'error', text: `非 GREEN 不可放行，请先 /gate-retry ${id}` }
  }
  if (r.evidenceHash !== expectedHash.trim()) {
    return { kind: 'error', text: '证据已过期，请重新 verify_run' }
  }
  runStore.set(rk, {
    ...r,
    approved: true,
    approvedAt: new Date().toISOString(),
    approvedHash: r.evidenceHash,
    by: 'user',
    stale: false,
  })
  return { kind: 'success', text: `契约 ${id} 已由用户放行（approved）` }
}

/** /gate-retry：重算 → YELLOW；approved=false、stale=true，保留上次放行信息。 */
export async function gateRetry({ contractId, sessionId = 'default' }, store = contracts, runStore = runs) {
  const resolved = resolveContractId(contractId, sessionId, store)
  if (resolved.error) return { kind: 'error', text: resolved.error }
  const id = resolved.id
  const rk = runKey(id, sessionId)
  const before = runStore.get(rk)
  const wasApproved = before?.approved === true
  const lastApprovedAt = wasApproved ? before.approvedAt : before?.lastApprovedAt
  const lastApprovedHash = wasApproved ? before.approvedHash : before?.lastApprovedHash

  const r = await verifyRun({ contractId: id, sessionId, evidenceInput: undefined }, store, runStore)

  // verifyRun 覆盖整条记录，这里补回 stale 语义
  const after = runStore.get(rk) ?? {}
  runStore.set(rk, {
    ...after,
    approved: false,
    stale: true,
    ...(lastApprovedAt !== undefined ? { lastApprovedAt } : {}),
    ...(lastApprovedHash !== undefined ? { lastApprovedHash } : {}),
  })

  const now = verifyStatus({ contractId: id, sessionId }, runStore)
  const staleNote = lastApprovedAt ? ` [stale] 上次放行已失效（${lastApprovedAt}）` : ' [stale]'
  return {
    kind: 'success',
    text: `契约 ${id} 已重算：${r.decision} @ ${now.at}${staleNote}。需重新执行 verify_run 补证据后才可能转 GREEN。`,
  }
}

/** /gate-status：无参列出本会话契约；有参（支持 ≥4 位前缀）看单条。 */
export function gateStatus({ contractId, sessionId = 'default' } = {}, store = contracts, runStore = runs) {
  const raw = String(contractId ?? '').trim()

  if (raw === '') {
    const ids = [...store.keys()].filter((k) => splitKey(k)[0] === sessionId).map((k) => splitKey(k)[1])
    if (ids.length === 0) return { kind: 'success', text: '当前会话还没有冻结任何契约（先执行 verify_contract）' }
    const rows = ids.map((id) => ({ id, run: runStore.get(runKey(id, sessionId)) }))
    rows.sort((a, b) => String(b.run?.at ?? '').localeCompare(String(a.run?.at ?? '')))
    const lines = rows.map(({ id, run }) => {
      if (!run) return `- ${id}  未跑校验`
      const flags = [run.confirmed === true ? '已确认' : '待确认', run.decision]
      if (run.stale === true) flags.push('[stale]')
      flags.push(run.approved === true ? '已放行' : '尚未放行')
      return `- ${id}  ${flags.join(' ')}  @ ${run.at ?? '-'}`
    })
    return { kind: 'success', text: [`当前会话契约（${rows.length}）：`, ...lines].join('\n') }
  }

  const resolved = resolveContractId(raw, sessionId, store)
  if (resolved.error) return { kind: 'error', text: resolved.error }
  const id = resolved.id
  const r = runStore.get(runKey(id, sessionId))
  if (!r) return { kind: 'success', text: `契约 ${id} 尚无门禁决定` }

  const approved = r.approved === true
  const stale = r.stale === true
  const confirmed = r.confirmed === true
  const head = `契约 ${id}：${confirmed ? `已确认 @ ${r.confirmedAt}` : '待确认（/gate-freeze）'}；最近决定 ${r.decision} @ ${r.at}` +
    (stale ? ` [stale] 上次放行已失效${r.lastApprovedAt ? `（${r.lastApprovedAt}）` : ''}` : '') +
    (approved ? `；已由 ${r.by ?? 'user'} 放行 @ ${r.approvedAt}` : (stale ? '' : '；尚未放行'))

  const extra = [`证据：${r.evidenceHash ?? '-'}`]
  if (r.reproCmd) extra.push(`复现：${r.reproCmd}`)
  if (Array.isArray(r.missing) && r.missing.length > 0) extra.push(`缺失证据：${r.missing.join('；')}`)
  return { kind: 'success', text: [head, ...extra].join('\n') }
}


/** 写新决定时保留确认状态（确认是状态，不是内容）。 */
function confirmFlags(prev) {
  if (prev?.confirmed === true) {
    return { confirmed: true, confirmedAt: prev.confirmedAt, confirmedBy: prev.confirmedBy }
  }
  return { confirmed: false }
}
