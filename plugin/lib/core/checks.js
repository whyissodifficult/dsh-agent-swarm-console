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
import { existsSync as fsExistsSync } from 'node:fs'
import { spawnSync as cpSpawnSync } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'

/**
 * @param {Array} requests 检查请求
 * @param {{workspaceRoot:string, testCmd?:string, existsSync?:Function, exec?:Function}} deps
 * @returns {{checks:Array, warnings:string[]}}
 */
export function runChecks(requests, deps = {}) {
  const workspaceRoot = deps.workspaceRoot
  const existsSync = deps.existsSync ?? fsExistsSync
  const exec = deps.exec ?? ((cmd, opts) => cpSpawnSync(cmd, {
    shell: true,
    cwd: opts?.cwd,
    timeout: 120000,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }))

  const warnings = []
  // 顶层非法（不是数组）也不抛：整体记为一条失败检查，交 gate 判 RED
  if (!Array.isArray(requests)) {
    return {
      checks: [{ id: '__checks__', type: 'invalid', ok: false, detail: '检查请求非法：checks 必须是数组' }],
      warnings,
    }
  }

  const checks = requests.map((req, i) => {
    const fallbackId = req && typeof req === 'object' && typeof req.id === 'string' ? req.id : `checks[${i}]`
    const invalid = (reason) => ({ id: fallbackId, type: String(req?.type ?? 'invalid'), ok: false, detail: `检查请求非法：${reason}` })

    if (!req || typeof req !== 'object') return invalid('必须是对象')
    const { id, type } = req
    if (typeof id !== 'string' || id === '') return invalid('id 必填')
    if (typeof type !== 'string' || type === '') return invalid('type 必填')

    // 模型自报 ok 一律忽略，记 warning
    if (req.ok !== undefined) {
      warnings.push(`check ${id} 自报 ok=${req.ok} 已忽略，改由插件实际执行判定`)
    }

    if (type === 'file.exists') {
      if (typeof req.path !== 'string' || req.path === '') return invalid('file.exists 必带 path')
      // P0-2：路径必须是相对 workspaceRoot 的相对路径，绝对路径直接判 RED
      if (isAbsolute(req.path)) {
        return { id, type, ok: false, path: req.path, detail: '检查路径必须是相对 workspaceRoot 的相对路径' }
      }
      if (typeof workspaceRoot !== 'string' || workspaceRoot === '') {
        return invalid('缺少 workspaceRoot，无法解析相对路径')
      }
      const absPath = resolve(workspaceRoot, req.path)
      const ok = existsSync(absPath) === true
      return { id, type, ok, path: req.path, absPath, detail: ok ? `文件存在：${req.path}` : `文件不存在：${req.path}` }
    }

    if (type === 'exec') {
      if (typeof req.cmd !== 'string' || req.cmd === '') return invalid('exec 必带 cmd')
      // P0-4：命令白名单——必须与契约 testCmd 完全相等
      if (typeof deps.testCmd !== 'string' || deps.testCmd === '' || req.cmd !== deps.testCmd) {
        return { id, type, ok: false, cmd: req.cmd, rejected: true, detail: 'exec 命令未在契约中声明为 testCmd，已拒绝' }
      }
      const r = exec(req.cmd, { cwd: workspaceRoot })
      const ok = r.error === undefined && r.status === 0
      const out = { id, type, ok, cmd: req.cmd, exitCode: r.status }
      if (!ok) {
        const msg = r.error?.message ?? r.stderr ?? r.stdout ?? `exit ${r.status}`
        out.detail = String(msg).slice(0, 300)
      }
      return out
    }

    return invalid(`未知检查类型 ${type}`)
  })

  return { checks, warnings }
}
