/**
 * 沙箱安全的 spawnSync。
 *
 * 问题：DSH 沙箱里 spawnSync 默认用 pipe 捕获输出会 EPERM（禁止管道）。
 * 旧代码把 EPERM 误报成"未找到 git"，且 wiring:test / wiring:dryrun 假红。
 *
 * 三级降级：
 *   1. pipe 正常尝试（宿主终端走这条，行为不变）
 *   2. EPERM → fd 重定向到临时文件重跑（仍能捕获 stdout/stderr，最完整）
 *   3. fd 也失败 → stdio:'inherit' 重跑（只判断 status，输出直落终端）
 *
 * 返回 { status, stdout, stderr, error, mode, note }，mode 标明实际走了哪条路。
 * ENOENT（真没装 git）与 EPERM（沙箱禁管道）分开，不再混为一谈。
 */
import { spawnSync as nodeSpawnSync } from 'node:child_process'
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function makeSafeSpawn(spawn = nodeSpawnSync) {
  return function safeSpawn(cmd, args, opts = {}) {
    const { timeout } = opts

    // 1) 正常 pipe
    const first = spawn(cmd, args, { ...opts, encoding: 'utf8' })
    if (first.error?.code !== 'EPERM') {
      return {
        status: first.status,
        stdout: first.stdout ?? '',
        stderr: first.stderr ?? '',
        error: first.error ?? null,
        mode: 'pipe',
        note: null,
      }
    }

    // 2) fd 重定向（绕开管道，仍能捕获输出）
    const dir = mkdtempSync(join(tmpdir(), 'wiring-spawn-'))
    try {
      const outPath = join(dir, 'out')
      const errPath = join(dir, 'err')
      const outFd = openSync(outPath, 'w')
      const errFd = openSync(errPath, 'w')
      let second
      try {
        second = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, timeout, stdio: ['ignore', outFd, errFd] })
      } finally {
        closeSync(outFd)
        closeSync(errFd)
      }
      if (!second.error) {
        return {
          status: second.status,
          stdout: readFileSync(outPath, 'utf8'),
          stderr: readFileSync(errPath, 'utf8'),
          error: null,
          mode: 'fd',
          note: '沙箱禁止管道，已用文件描述符重定向捕获输出',
        }
      }

      // 3) inherit 兜底（只判断 status，拿不到输出）
      const third = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, timeout, stdio: 'inherit' })
      return {
        status: third.status,
        stdout: '',
        stderr: '',
        error: third.error ?? null,
        mode: 'inherit',
        note: '沙箱禁止管道与文件重定向，已降级为 inherit（无法捕获输出）',
      }
    } finally {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }
}

export const safeSpawn = makeSafeSpawn()

/** 把 spawn 结果翻译成人类可读的诊断，区分 EPERM / ENOENT / 普通失败。 */
export function spawnErrorText(r, what = '命令') {
  if (r.error?.code === 'EPERM') {
    return '沙箱禁止管道（EPERM），' + what + '被阻断。请在宿主终端运行；已尝试 fd 重定向降级。'
  }
  if (r.error?.code === 'ENOENT') {
    return '未找到可执行文件（ENOENT）：' + what + '。请确认已安装并加入 PATH。'
  }
  const text = (r.stderr || r.stdout || '').trim()
  if (text) return text.slice(0, 400)
  if (r.error) return r.error.message
  return what + ' 返回非 0（无输出）'
}
