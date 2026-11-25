/**
 * D3 · 三态门禁纯函数。
 * decide(contract, evidence) → { decision, reasons, missing, reproCmd? }
 *
 * R1 任一 criterion 的 checkIds 为空，或没有对应 evidence.checks → 最高 YELLOW
 * R2 任一 check.ok === false → RED，reasons 必须包含 reproCmd（可复制执行）
 * R3 全部 criteria 有证据且通过 → GREEN
 *
 * 优先级：RED > YELLOW > GREEN。纯函数，零副作用、零依赖。
 */

/**
 * @param {object} contract  TaskContract
 * @param {object} evidence  Evidence
 */
export function decide(contract, evidence) {
  const reasons = []
  const missing = []

  if (!contract || !Array.isArray(contract.criteria) || contract.criteria.length === 0) {
    return { decision: 'RED', reasons: ['契约没有任何验收条件，不可判通过'], missing: [] }
  }
  const checks = Array.isArray(evidence?.checks) ? evidence.checks : []
  const byId = new Map(checks.map((c) => [c.id, c]))

  // 环境缺失单独一档：不能当「代码没通过」
  const envBlocked = checks.filter((c) => c.envUnavailable === true)

  // R2 先行：任一 check 失败即 RED，并给出最小复现命令
  const failed = checks.filter((c) => c.ok === false && c.envUnavailable !== true)
  if (failed.length > 0) {
    const reproCmd = failed.map((c) => reproFor(c)).filter(Boolean).join(' && ')
    for (const c of failed) {
      reasons.push(`check "${c.id}" 失败：${c.detail || c.type}${c.cmd ? `（${c.cmd}）` : ''}`)
    }
    if (!reproCmd) reasons.push('未提供可复现命令（reproCmd 为空）')
    return { decision: 'RED', reasons, missing, reproCmd: reproCmd || undefined }
  }

  // 有检查因环境不可用而被跳过 → 最高 YELLOW（且明确写「环境不支持」而不是「你没交证据」）
  if (envBlocked.length > 0) {
    for (const c of envBlocked) reasons.push(`check "${c.id}" 未能执行：${c.detail}`)
    reasons.push('环境限制导致无法判定，不能算通过（不是测试失败）')
    for (const criterion of contract.criteria) {
      const ids = Array.isArray(criterion.checkIds) ? criterion.checkIds : []
      if (ids.some((id) => envBlocked.some((c) => c.id === id))) missing.push(`${criterion.id}: 环境无可用 shell，未能执行 ${ids.join(', ')}`)
    }
    return { decision: 'YELLOW', reasons, missing }
  }

  // R1：逐条 criterion 查证据覆盖
  for (const criterion of contract.criteria) {
    const ids = Array.isArray(criterion.checkIds) ? criterion.checkIds : []
    if (ids.length === 0) {
      missing.push(`${criterion.id}: 未绑定 checkIds`)
      continue
    }
    const hit = ids.filter((id) => byId.has(id))
    if (hit.length === 0) {
      missing.push(`${criterion.id}: 没有对应 evidence.checks（需要 ${ids.join(', ')}）`)
    } else if (hit.length < ids.length) {
      const absent = ids.filter((id) => !byId.has(id))
      missing.push(`${criterion.id}: 缺少检查 ${absent.join(', ')}`)
    }
  }

  if (missing.length > 0) {
    reasons.push(`${missing.length} 条验收条件缺少证据，不能判为通过`)
    return { decision: 'YELLOW', reasons, missing }
  }

  // R3：全部覆盖且全通过
  reasons.push(`全部 ${contract.criteria.length} 条验收条件均有通过证据`)
  return { decision: 'GREEN', reasons, missing }
}

/** 从失败 check 构造可复制执行的最小复现命令（按检查类型给对应命令）。 */
function reproFor(check) {
  // 被白名单拒绝的命令本身不能当复现（它可能退出 0），给可执行提示
  if (check.rejected === true) {
    return `echo "exec 命令未在契约 testCmd 中声明，已拒绝执行" && exit 1`
  }
  if (typeof check.cmd === 'string' && check.cmd.trim() !== '') return check.cmd
  // P1-3 · file.exists：用 node -e 判断，跨平台（不依赖 sh / test -f）；
  // 有 absPath 时写绝对路径，保证命令在任何 cwd 下都指向同一文件。
  if (check.type === 'file.exists') {
    const target = typeof check.absPath === 'string' && check.absPath !== '' ? check.absPath : check.path
    if (typeof target === 'string' && target !== '') {
      return `node -e "process.exit(require('node:fs').existsSync(process.argv[1])?0:1)" ${dq(target)}`
    }
  }
  // 0.7.0 扩展类型：给出可直接执行的复现命令
  if (check.type === 'text.contains' && typeof check.absPath === 'string') {
    const needle = JSON.stringify(String(check.contains ?? ''))
    return `node -e "const fs=require('node:fs');process.exit(fs.readFileSync(process.argv[1],'utf8').includes(${needle})?0:1)" ${dq(check.absPath)}`
  }
  if (check.type === 'json.field' && typeof check.absPath === 'string') {
    const field = check.field ?? ''
    const expect = JSON.stringify(check.value ?? null)
    return `node -e "const fs=require('node:fs');const o=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const v=${field ? `process.argv[2].split('.').reduce((a,k)=>a?.[k],o)` : 'o'};process.exit(JSON.stringify(v)===${JSON.stringify(expect)}?0:1)" ${dq(check.absPath)} ${dq(field)}`
  }
  if (check.type === 'file.sha256' && typeof check.absPath === 'string') {
    const want = String(check.sha256 ?? '')
    return `node -e "const c=require('node:crypto'),fs=require('node:fs');process.exit(c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex')===${JSON.stringify(want)}?0:1)" ${dq(check.absPath)}`
  }
  if (check.type === 'glob.exists' && typeof check.pattern === 'string') {
    return `node -e "const {execSync}=require('node:child_process');try{execSync('node --test',{stdio:'ignore'})}catch{};process.exit(1)" && echo "glob ${check.pattern} 未匹配到文件，请先确认路径"`
  }
  // 其余情况兜底：给一条可直接执行且退出非 0 的真命令，不是装饰性注释
  return `echo "check ${check.id} 无可执行复现命令（该检查类型未提供路径/命令）" && exit 1`
}

/** 双引号包裹（cmd 与 sh 都可解析），内部双引号转义 */
function dq(value) {
  return '"' + String(value).replace(/"/g, '\\"') + '"'
}
