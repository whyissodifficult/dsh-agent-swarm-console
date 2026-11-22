/**
 * P0-2 · 检查请求执行器（0.3.0：契约结构破坏性变更）。
 *
 * 变化：
 *  - 一切路径以 contract.workspaceRoot 为根；file.exists 只接受相对路径
 *  - exec 的 cwd 固定为 workspaceRoot（结论不由宿主 cwd 决定）
 *  - exec 命令必须与 contract.testCmd 完全相等（白名单），否则该检查判 RED
 *  - 非法请求不再 throw：返回 {ok:false, detail:'检查请求非法：…'}，由 gate 判 RED
 *
 * 模型传入的 ok 一律忽略，并记一条 warning。
 */
import { existsSync as fsExistsSync, realpathSync as fsRealpathSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { isAbsolute, relative, resolve } from 'node:path'

const EXEC_TIMEOUT_MS = 10000

/**
 * @param {Array} requests 检查请求
 * @param {{workspaceRoot:string, testCmd?:string, existsSync?:Function, exec?:Function}} deps
 * @returns {Promise<{checks:Array, warnings:string[]}>} 0.4.0 起异步（不再阻塞事件循环）
 */
export async function runChecks(requests, deps = {}) {
  const workspaceRoot = deps.workspaceRoot
  const existsSync = deps.existsSync ?? fsExistsSync
  const realpathSync = deps.realpathSync ?? fsRealpathSync
  const exec = deps.exec ?? runExecAsync

  const warnings = []
  // 顶层非法（不是数组）也不抛：整体记为一条失败检查，交 gate 判 RED
  if (!Array.isArray(requests)) {
    return {
      checks: [{ id: '__checks__', type: 'invalid', ok: false, detail: '检查请求非法：checks 必须是数组' }],
      warnings,
    }
  }

  const checks = []
  for (let i = 0; i < requests.length; i++) {
    const req = requests[i]
    const fallbackId = req && typeof req === 'object' && typeof req.id === 'string' ? req.id : `checks[${i}]`
    const invalid = (reason) => ({ id: fallbackId, type: String(req?.type ?? 'invalid'), ok: false, detail: `检查请求非法：${reason}` })

    if (!req || typeof req !== 'object') { checks.push(invalid('必须是对象')); continue }
    const { id, type } = req
    if (typeof id !== 'string' || id === '') { checks.push(invalid('id 必填')); continue }
    if (typeof type !== 'string' || type === '') { checks.push(invalid('type 必填')); continue }

    // 模型自报 ok 一律忽略，记 warning
    if (req.ok !== undefined) {
      warnings.push(`check ${id} 自报 ok=${req.ok} 已忽略，改由插件实际执行判定`)
    }

    if (type === 'file.exists') {
      if (typeof req.path !== 'string' || req.path === '') { checks.push(invalid('file.exists 必带 path')); continue }
      if (isAbsolute(req.path)) {
        checks.push({ id, type, ok: false, path: req.path, detail: '检查路径必须是相对 workspaceRoot 的相对路径' }); continue
      }
      if (typeof workspaceRoot !== 'string' || workspaceRoot === '') {
        checks.push(invalid('缺少 workspaceRoot，无法解析相对路径')); continue
      }
      const absPath = resolve(workspaceRoot, req.path)
      // P0-A：必须留在 workspaceRoot 内，`../` 不得越界
      const rel = relative(workspaceRoot, absPath)
      if (rel.startsWith('..') || isAbsolute(rel)) {
        checks.push({ id, type, ok: false, path: req.path, absPath, detail: `检查路径越出 workspaceRoot：${req.path}` }); continue
      }
      // P0-B：符号链接 / junction 挡不住词法校验——realpath 之后再比一次
      let realRoot = workspaceRoot
      let realPath = absPath
      try { realRoot = realpathSync(workspaceRoot) } catch { /* workspaceRoot 不可解析时按词法处理 */ }
      try { realPath = realpathSync(absPath) } catch { /* 路径不存在或链接断开：保持词法路径 */ }
      const relReal = relative(realRoot, realPath)
      if (relReal.startsWith('..') || isAbsolute(relReal)) {
        checks.push({ id, type, ok: false, path: req.path, absPath, detail: `检查路径经符号链接解析后越出 workspaceRoot：${req.path}` }); continue
      }
      const ok = existsSync(absPath) === true
      checks.push({ id, type, ok, path: req.path, absPath, detail: ok ? `文件存在：${req.path}` : `文件不存在：${req.path}` })
      continue
    }

    if (type === 'exec') {
      if (typeof req.cmd !== 'string' || req.cmd === '') { checks.push(invalid('exec 必带 cmd')); continue }
      if (typeof deps.testCmd !== 'string' || deps.testCmd === '' || req.cmd !== deps.testCmd) {
        checks.push({ id, type, ok: false, cmd: req.cmd, rejected: true, detail: 'exec 命令未在契约中声明为 testCmd，已拒绝' }); continue
      }
      const r = await exec(req.cmd, { cwd: workspaceRoot })
      const ok = r.error === undefined && r.status === 0
      const out = { id, type, ok, cmd: req.cmd, exitCode: r.status }
      if (!ok) {
        const msg = r.error?.message ?? r.stderr ?? r.stdout ?? `exit ${r.status}`
        out.detail = String(msg).slice(0, 300)
      }
      checks.push(out)
      continue
    }

    checks.push(invalid(`未知检查类型 ${type}`))
  }

  return { checks, warnings }
}


/** 0.4.0 · 默认异步 exec：spawn + 10s 超时 kill（不再阻塞事件循环）。 */
function runExecAsync(cmd, opts = {}) {
  return new Promise((resolvePromise) => {
    let child
    try {
      child = spawn(cmd, { shell: true, cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolvePromise({ status: null, error, stdout: '', stderr: '' })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (r) => { if (settled) return; settled = true; clearTimeout(timer); resolvePromise(r) }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      finish({ status: null, error: new Error(`执行超时（${EXEC_TIMEOUT_MS}ms）已终止`), stdout, stderr })
    }, EXEC_TIMEOUT_MS)

    child.stdout?.on('data', (d) => { stdout += String(d) })
    child.stderr?.on('data', (d) => { stderr += String(d) })
    child.on('error', (error) => finish({ status: null, error, stdout, stderr }))
    child.on('close', (code) => finish({ status: code, error: undefined, stdout, stderr }))
  })
}
