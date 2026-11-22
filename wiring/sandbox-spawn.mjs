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

const FORCE_EPERM = 'WIRING_FORCE_SPAWN_EPERM'

export function makeSafeSpawn(spawn = nodeSpawnSync) {
  return function safeSpawn(cmd, args, opts = {}) {
    const { timeout } = opts
    // P1-7：把完整命令行挂在结果上，诊断才不会把参数当可执行文件名
    const cmdline = [cmd, ...(Array.isArray(args) ? args : [])].map(String).join(' ')

    // 1) 正常 pipe。强制模式下首跳不真 spawn，直接构造 EPERM 进入 fd 分支，
    //    让 fd 路径能在宿主终端端到端真跑一次（用于验证"fd 能捕获输出"）。
    const force = process.env[FORCE_EPERM] === '1'
    const first = force
      ? { status: null, error: Object.assign(new Error('forced EPERM'), { code: 'EPERM' }) }
      : spawn(cmd, args, { ...opts, encoding: 'utf8' })
    if (first.error?.code !== 'EPERM') {
      return {
        status: first.status,
        stdout: first.stdout ?? '',
        stderr: first.stderr ?? '',
        error: first.error ?? null,
        mode: 'pipe',
        note: null,
        cmdline,
      }
    }

    // 2) fd 重定向（绕开管道，仍能捕获输出）。
    //    openSync / mkdtempSync 失败也算 fd 不可用，要落到 inherit 兜底。
    let dir
    let outFd
    let errFd
    let second
    try {
      dir = mkdtempSync(join(tmpdir(), 'wiring-spawn-'))
      outFd = openSync(join(dir, 'out'), 'w')
      errFd = openSync(join(dir, 'err'), 'w')
      second = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, timeout, stdio: ['ignore', outFd, errFd] })
    } catch (fdError) {
      second = { status: null, error: fdError }
    } finally {
      for (const fd of [outFd, errFd]) {
        if (fd !== undefined) { try { closeSync(fd) } catch { /* ignore */ } }
      }
    }
    if (!second.error) {
      const out = readFileSync(join(dir, 'out'), 'utf8')
      const err = readFileSync(join(dir, 'err'), 'utf8')
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
      return {
        status: second.status,
        stdout: out,
        stderr: err,
        error: null,
        mode: 'fd',
        note: '沙箱禁止管道，已用文件描述符重定向捕获输出',
        cmdline,
      }
    }

    // 3) inherit 兜底（只判断 status，拿不到输出）
    try { if (dir) rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    const third = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, timeout, stdio: 'inherit' })
    return {
      status: third.status,
      stdout: '',
      stderr: '',
      error: third.error ?? null,
      mode: 'inherit',
      note: '沙箱禁止管道与文件重定向，已降级为 inherit（无法捕获输出）',
      cmdline,
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
    // P1-7：报完整命令行，而不是把参数当成可执行文件名
    return '未找到可执行文件（ENOENT）：' + (r.cmdline ?? what) + '。请确认已安装并加入 PATH。'
  }
  const text = (r.stderr || r.stdout || '').trim()
  if (text) return text.slice(0, 400)
  if (r.error) return r.error.message
  return what + ' 返回非 0（无输出）'
}
