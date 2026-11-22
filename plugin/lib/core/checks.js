/**
 * P0-2 · 检查请求执行器（0.2.0：checks 语义从「自报结论」改为「检查请求」）。
 *
 * 模型传入的 ok 一律忽略 —— 由插件真实执行后判定，并记一条 warning。
 * 纯函数 + 可注入 existsSync / exec，单测不必真的碰文件或跑命令。
 */
import { existsSync as fsExistsSync } from 'node:fs'
import { spawnSync as cpSpawnSync } from 'node:child_process'

/**
 * @param {Array} requests 检查请求：[{id, type:'file.exists'|'exec', path|cmd, ok?}]
 * @param {{existsSync?:Function, exec?:Function}} deps 可注入的执行实现
 * @returns {{checks:Array, warnings:string[]}}
 */
export function runChecks(requests, deps = {}) {
  if (!Array.isArray(requests)) throw new Error('checks 必须是数组')
  const existsSync = deps.existsSync ?? fsExistsSync
  const exec = deps.exec ?? ((cmd) => cpSpawnSync(cmd, {
    shell: true,
    timeout: 120000,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }))

  const warnings = []
  const checks = requests.map((req, i) => {
    if (!req || typeof req !== 'object') throw new Error(`checks[${i}] 必须是对象`)
    const { id, type } = req
    if (typeof id !== 'string' || id === '') throw new Error(`checks[${i}].id 必填`)
    if (typeof type !== 'string' || type === '') throw new Error(`checks[${i}].type 必填`)

    // 模型自报 ok 一律忽略，记 warning，不因此判 RED/GREEN
    if (req.ok !== undefined) {
      warnings.push(`check ${id} 自报 ok=${req.ok} 已忽略，改由插件实际执行判定`)
    }

    if (type === 'file.exists') {
      if (typeof req.path !== 'string' || req.path === '') {
        throw new Error(`check ${id} file.exists 必带 path`)
      }
      const ok = existsSync(req.path) === true
      return { id, type, ok, path: req.path, detail: ok ? `文件存在：${req.path}` : `文件不存在：${req.path}` }
    }

    if (type === 'exec') {
      if (typeof req.cmd !== 'string' || req.cmd === '') {
        throw new Error(`check ${id} exec 必带 cmd`)
      }
      const r = exec(req.cmd)
      // 关键：ok 只看真实退出码，不看模型自报，也不看 stdout 内容
      const ok = r.error === undefined && r.status === 0
      const out = { id, type, ok, cmd: req.cmd, exitCode: r.status }
      if (!ok) {
        const msg = r.error?.message ?? r.stderr ?? r.stdout ?? `exit ${r.status}`
        out.detail = String(msg).slice(0, 300)
      }
      return out
    }

    throw new Error(`check ${id} 未知检查类型 ${type}`)
  })

  return { checks, warnings }
}
