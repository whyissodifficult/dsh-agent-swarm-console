/**
 * 必改1/2 回归：运行期 skill 注册 + verify_run 输出带复现命令。
 * 用假 ctx 捕获注册，不依赖 DSH 宿主。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import { verifyContract, verifyRun, newStores } from '../lib/core/verify.js'

const cfg = {
  externalAgents: { a: { baseUrl: 'http://x', apiKeyEnv: 'K', models: ['m'] } },
}

function fakeCtx(services = {}) {
  const registered = { tools: new Map(), skills: [], cards: [] }
  const base = {
    effect: (fn) => fn(),
    get: (name) => services[name],
    tools: { register: (d) => { registered.tools.set(d.name, d); return () => {} } },
  }
  // 模拟宿主 inject：服务已在 services 里时，回调拿到含该服务的子 ctx 并立即触发
  base.inject = (names, cb) => {
    const sub = { ...base }
    for (const n of names) if (services[n] !== undefined) sub[n] = services[n]
    if (names.every((n) => sub[n] !== undefined)) cb(sub)
  }
  return { ctx: base, registered }
}

test('必改1: 注册了 dsh-swarm-console-verify skill，invocation 可模型调用', () => {
  const skills = { register: (s) => { captured = s; return () => {} } }
  let captured = null
  const { ctx } = fakeCtx({ skills })
  apply(ctx, cfg)
  assert.ok(captured, 'skills.register 未被调用')
  assert.equal(captured.name, 'dsh-swarm-console-verify')
  assert.equal(captured.invocation.modelInvocable, true)
  assert.equal(captured.invocation.userInvocable, true)
})

test('时机: 服务缺席时 apply 不抛，服务出现后 register 被调用（ctx.inject）', () => {
  const pending = []
  let skillsReg = 0, cardsReg = 0
  const ctx = {
    effect: (fn) => fn(),
    get: () => undefined, // apply 阶段取不到任何服务
    inject: (names, cb) => pending.push({ names, cb }),
    tools: { register: () => () => {} },
  }
  assert.doesNotThrow(() => apply(ctx, cfg))
  assert.ok(pending.length >= 2, '应通过 inject 等待 skills 与 actionCards')

  // 模拟两个 bundle 晚挂载：把服务放进 ctx，触发之前登记的回调
  ctx.skills = { register: () => { skillsReg++; return () => {} } }
  ctx.actionCards = { register: () => { cardsReg++; return () => {} } }
  for (const p of pending) p.cb(ctx)
  assert.equal(skillsReg, 1, 'skills 出现后应注册')
  assert.equal(cardsReg, 1, 'actionCards 出现后应注册')
})

test('必改1补: source 为非空字符串且为 runtime（缺它 skill 加载失败）', () => {
  let captured = null
  const skills = { register: (s) => { captured = s; return () => {} } }
  apply(fakeCtx({ skills }).ctx, cfg)
  assert.equal(typeof captured.source, 'string')
  assert.ok(captured.source.trim() !== '', 'source 不能为空')
  assert.equal(captured.source, 'runtime')
})

test('必改1: skill content 写明 approve 仅 GREEN、retry、非用户代批拒绝', () => {
  let captured = null
  const skills = { register: (s) => { captured = s; return () => {} } }
  apply(fakeCtx({ skills }).ctx, cfg)
  assert.match(captured.content, /approve/)
  assert.match(captured.content, /GREEN/)
  assert.match(captured.content, /retry/)
  assert.match(captured.content, /只有用户/)
})

test('必改1: skill 与卡片 kind 指向同名（propose_action 可达）', () => {
  let skillName = null
  let cardAction = null
  const skills = { register: (s) => { skillName = s.name; return () => {} } }
  const cards = { register: (k) => { cardAction = k.skill; return () => {} } }
  apply(fakeCtx({ skills, actionCards: cards }).ctx, cfg)
  assert.ok(skillName, 'skill 未注册')
  assert.ok(cardAction, '卡片种类未注册')
  assert.equal(cardAction, skillName)
})

test('必改1: skills 服务缺失时 verify_* 三工具仍注册（不阻塞）', () => {
  const { ctx, registered } = fakeCtx() // 无 skills、无 cards
  assert.doesNotThrow(() => apply(ctx, cfg))
  for (const n of ['swarm_run', 'verify_contract', 'verify_run', 'verify_status']) {
    assert.ok(registered.tools.has(n), `缺少 ${n}`)
  }
})

test('必改1: skills.register 抛错时不阻塞三工具', () => {
  const skills = { register: () => { throw new Error('boom') } }
  const { ctx, registered } = fakeCtx({ skills })
  assert.doesNotThrow(() => apply(ctx, cfg))
  assert.ok(registered.tools.has('verify_contract'))
})

test('必改2: verify_run RED 输出含可复制复现命令', () => {
  const def = collectVerifyRun()
  const { contracts, runs } = newStores()
  const { contractId } = verifyContract({ objective: 'x', workspaceRoot: process.cwd(), criteria: [{ id: 'AC1', text: 't', checkIds: ['k1'] }] }, 'default', contracts)
  const failPolicy = (c) => ({ contractId: c.id, checks: [{ id: 'k1', type: 'exec', ok: false, cmd: 'npm test' }], artifacts: [], level: 'E2', status: 'failed', at: '' })
  const r = verifyRun({ contractId, runPolicy: failPolicy }, contracts, runs)
  const text = def.output.render({}, r)[0].text
  assert.match(text, /^门禁 RED/)
  assert.match(text, /复现：npm test/)
})

test('必改2: RED 输出必带可执行的复现命令（file.exists → node -e；无路径 → 兜底命令）', () => {
  const def = collectVerifyRun()
  const { contracts, runs } = newStores()

  // 有 path：应给出 test -f <path>，而不是装饰性注释
  const a = verifyContract({ objective: 'x', workspaceRoot: process.cwd(), criteria: [{ id: 'AC1', text: 't', checkIds: ['k1'] }] }, 'default', contracts)
  const withPath = (c) => ({ contractId: c.id, checks: [{ id: 'k1', type: 'file.exists', ok: false, path: 'no/such/file' }], artifacts: [], level: 'E1', status: 'failed', at: '' })
  const ra = verifyRun({ contractId: a.contractId, runPolicy: withPath }, contracts, runs)
  const ta = def.output.render({}, ra)[0].text
  assert.match(ta, /复现：node -e /, 'file.exists 应给 node -e 形式（跨平台）')
  assert.ok(!/未提供 cmd/.test(ta), '不应再出现「未提供 cmd」')

  // 没有 path：无法构造针对性命令，但必须是可执行且退出非 0 的真命令
  const b = verifyContract({ objective: 'y', workspaceRoot: process.cwd(), criteria: [{ id: 'AC1', text: 't', checkIds: ['k1'] }] }, 'default', contracts)
  const noPath = (c) => ({ contractId: c.id, checks: [{ id: 'k1', type: 'file.exists', ok: false }], artifacts: [], level: 'E1', status: 'failed', at: '' })
  const rb = verifyRun({ contractId: b.contractId, runPolicy: noPath }, contracts, runs)
  const tb = def.output.render({}, rb)[0].text
  assert.match(tb, /复现：echo "check k1 无可执行复现命令/)
  assert.match(tb, /&& exit 1/)
})

test('必改2: YELLOW 输出附 missing 摘要', () => {
  const def = collectVerifyRun()
  const { contracts, runs } = newStores()
  const { contractId } = verifyContract({ objective: 'x', workspaceRoot: process.cwd(), criteria: [{ id: 'AC1', text: 't', checkIds: [] }] }, 'default', contracts)
  const r = verifyRun({ contractId, evidenceInput: { checks: [], artifacts: [] } }, contracts, runs)
  const text = def.output.render({}, r)[0].text
  assert.match(text, /^门禁 YELLOW/)
  assert.match(text, /缺失证据：/)
})

// helpers：从 apply 里拿到 verify_run 定义；用隔离 store 跑 verifyRun
function collectVerifyRun() {
  const { ctx, registered } = fakeCtx()
  apply(ctx, cfg)
  return registered.tools.get('verify_run')
}
