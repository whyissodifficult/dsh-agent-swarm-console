/**
 * 上游校验：node wiring/verify-upstream.mjs <URL 或本地路径>
 *
 * 三种诊断分开报：
 *   A. 不可达      —— URL 连不上 / 路径不存在 / 不是 dsh-agent-swarm
 *   B. commit 不符 —— HEAD 不是 dd67b64
 *   C. 可应用      —— 在【用户的副本】上 git apply --check 通过
 *
 * 设计意图：clone 本仓库后，不需要先有上游本地副本也能走到明确结论。
 * URL 模式只做 A/B（并给出获取副本的命令）；本地模式做 A/B/C，不碰原文件。
 */
import { existsSync, readFileSync, mkdtempSync, rmSync, copyFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeSpawn, spawnErrorText } from './sandbox-spawn.mjs'

const BASELINE = 'dd67b64bdfb1e04ac4dcbf201d0af20d9879f847'
const MIRROR = 'https://ghproxy.net/https://github.com/xieshuaix/dsh-agent-swarm.git'
const input = process.argv[2]

if (!input) {
  console.error('用法: node wiring/verify-upstream.mjs <上游 URL 或本地 dsh-agent-swarm 路径>')
  console.error('例:   node wiring/verify-upstream.mjs https://github.com/xieshuaix/dsh-agent-swarm.git')
  process.exit(2)
}

const run = (args, cwd) => safeSpawn('git', args, { cwd, timeout: 30000 })
const isUrl = /^(https?:\/\/|git@)/i.test(input)
const here = fileURLToPath(new URL('.', import.meta.url))
const patch = join(here, 'swarm-index.patch')

console.log(`上游输入：${input}`)
console.log(`期望基线：${BASELINE}\n`)

// ── URL 模式：只做 A/B ──
if (isUrl) {
  const r = run(['ls-remote', input, 'HEAD'], process.cwd())
  if (r.status !== 0) {
    console.error('【诊断 A：不可达】')
    console.error('  ' + spawnErrorText(r, 'git ls-remote'))
    console.error('  提示：国内直连 github.com 常被重置，可试镜像：' + MIRROR)
    process.exit(1)
  }
  const head = r.stdout.trim().split(/\s+/)[0]
  console.log(`  ls-remote HEAD = ${head}`)
  if (head !== BASELINE) {
    console.error('【诊断 B：commit 不符】上游 HEAD=' + head + '，补丁基线=' + BASELINE)
    process.exit(2)
  }
  console.log('【诊断 B：commit 匹配】')
  console.log('  下一步拿副本后做诊断 C（可应用）：')
  console.log(`    git clone ${input} /tmp/swarm-upstream`)
  console.log('    node wiring/verify-upstream.mjs /tmp/swarm-upstream')
  process.exit(0)
}

// ── 本地路径模式：A/B/C ──
const target = resolve(input)
if (!existsSync(target) || !existsSync(join(target, 'lib', 'index.js'))) {
  console.error('【诊断 A：不可达】本地路径不存在或没有 lib/index.js：' + target)
  process.exit(1)
}
if (!readFileSync(join(target, 'lib', 'index.js'), 'utf8').includes('agent-swarm')) {
  console.error('【诊断 A：不可达】lib/index.js 里没有 agent-swarm，目标不是这个插件')
  process.exit(1)
}

const rev = run(['rev-parse', 'HEAD'], target)
if (rev.status !== 0) {
  console.error('【诊断 B：commit 不符】目标不是 git 仓库，无法校验 commit')
  process.exit(2)
}
const head = rev.stdout.trim()
console.log(`  本地 HEAD = ${head}`)
// 工作区已打过补丁时，apply --check 必然失败——这不是"不可应用"，而是"已接线"
const installedMark = 'const spawnExternal = async'
if (readFileSync(join(target, 'lib', 'index.js'), 'utf8').includes(installedMark)) {
  console.log('【诊断 C：已接线】目标 lib/index.js 已含 spawnExternal，无需再打补丁。')
  console.log('  若这是你想验证的干净副本，请先还原到 dd67b64 再跑。')
  process.exit(0)
}
const hasBaseline = run(['cat-file', '-e', BASELINE], target).status === 0
if (head !== BASELINE && !hasBaseline) {
  console.error('【诊断 B：commit 不符】HEAD=' + head + '，且找不到 ' + BASELINE)
  console.error('  请 fetch 该 commit，或换用对应版本的补丁。')
  process.exit(2)
}
console.log('【诊断 B：commit 匹配】')

// 诊断 C：在【用户副本】的 index.js 上真跑 apply --check，不碰原文件
const tmp = mkdtempSync(join(tmpdir(), 'verify-upstream-'))
try {
  for (const args of [['init', '-q'], ['config', 'user.email', 't@t'], ['config', 'user.name', 't']]) {
    const g = run(args, tmp)
    if (g.status !== 0) {
      console.error('【诊断 C：不可应用】' + spawnErrorText(g, 'git init'))
      process.exit(3)
    }
  }
  mkdirSync(join(tmp, 'lib'))
  copyFileSync(join(target, 'lib', 'index.js'), join(tmp, 'lib', 'index.js'))
  const check = run(['apply', '--check', patch], tmp)
  if (check.status !== 0) {
    console.error('【诊断 C：不可应用】补丁与你的副本不匹配：')
    console.error('  ' + spawnErrorText(check, 'git apply --check'))
    process.exit(3)
  }
  console.log('【诊断 C：可应用】git apply --check 通过（在用户副本上实跑）')
  console.log('\n结论：上游可用，可运行 node wiring/install.mjs <该路径>')
  process.exit(0)
} finally {
  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
}
