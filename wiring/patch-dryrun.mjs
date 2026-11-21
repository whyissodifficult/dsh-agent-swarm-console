/**
 * 补丁真实性校验（反证测试的基础）。
 * 不依赖已装好的插件，也不断言任何复制品：
 *   1. 拿 wiring/fixtures/index.baseline.js（dd67b64 的 lib/index.js）做基线
 *   2. 真跑 git apply --check，断言补丁能打上（hunk 命中）
 *   3. 真打一遍，检查 spawn() 分流与 spawnExternal 挂载
 * 评审反证：把 swarm-index.patch 任一字符改坏 → apply --check 失败 → 这里变红。
 */
import { existsSync, readFileSync, copyFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeSpawn, spawnErrorText } from './sandbox-spawn.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const defaultPatch = join(here, 'swarm-index.patch')
const defaultFixture = join(here, 'fixtures', 'index.baseline.js')

// paths 可选：仅供反证测试注入临时补丁/基线；生产调用走真实文件。
export function dryRunPatch({ patch = defaultPatch, fixture = defaultFixture } = {}) {
  const problems = []
  if (!existsSync(patch)) return { ok: false, problems: ['补丁文件不存在'], stats: null }
  if (!existsSync(fixture)) return { ok: false, problems: ['基线 fixture 不存在'], stats: null }

  const tmp = mkdtempSync(join(tmpdir(), 'wiring-dryrun-'))
  try {
    // git apply 要在仓库里跑；造一个最小临时仓库，只放基线文件
    for (const cmd of [['init', '-q'], ['config', 'user.email', 't@t'], ['config', 'user.name', 't']]) {
      const r = safeSpawn('git', cmd, { cwd: tmp })
      if (r.status !== 0) {
        return { ok: false, problems: ['git 调用失败：' + spawnErrorText(r, cmd.join(' '))], stats: null }
      }
    }
    mkdirSync(join(tmp, 'lib'))
    copyFileSync(fixture, join(tmp, 'lib', 'index.js'))

    // 1) --check：hunk 必须命中
    const check = safeSpawn('git', ['apply', '--check', patch], { cwd: tmp })
    if (check.status !== 0) {
      problems.push('git apply --check 失败（补丁与基线不匹配）：' + spawnErrorText(check, 'git apply --check'))
      return { ok: false, problems, stats: null }
    }

    // 2) 真打一遍，检查结构（不是断言复制的 picker）
    const apply = safeSpawn('git', ['apply', patch], { cwd: tmp })
    if (apply.status !== 0) {
      problems.push('git apply 实打失败：' + spawnErrorText(apply, 'git apply'))
      return { ok: false, problems, stats: null }
    }
    const patchedPath = join(tmp, 'lib', 'index.js')
    const patched = readFileSync(patchedPath, 'utf8')

    // F2: 语法校验——补丁能打上不代表语法没坏。
    // 关键：index.js 在临时仓库里没有 package.json，node 按 CJS 解析，ESM 中部的语法错会漏检。
    // 复制成 .mjs 再 check（评审 B 组证明能抓到、D 组证明不误报）。
    const checkMjs = join(tmp, 'check.mjs')
    copyFileSync(patchedPath, checkMjs)
    const syntax = safeSpawn(process.execPath, ['--check', checkMjs])
    if (syntax.status !== 0) {
      problems.push('打补丁后 node --check 失败（语法被破坏）：' + spawnErrorText(syntax, 'node --check'))
      return { ok: false, problems, stats: null }
    }

    const nSpawn = (patched.match(/spawnExternal/g) || []).length
    const stats = { spawnExternal: nSpawn, syntax: 'ok' }
    if (nSpawn !== 2) problems.push(`spawnExternal 出现 ${nSpawn} 次，期望 2（调用处+定义处）`)
    if (!patched.includes('const externalProfile = pickExternalProfile(spec, cfg)')) {
      problems.push('spawn() 分流语句未命中')
    }
    if (!patched.includes('externalAgents: config.externalAgents')) {
      problems.push('externalAgents 配置字段未命中')
    }

    return { ok: problems.length === 0, problems, stats }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = dryRunPatch()
  if (r.ok) {
    console.log(`✅ 补丁 dry-run 通过：hunk 命中，node --check 通过，spawnExternal=${r.stats.spawnExternal}`)
    process.exit(0)
  }
  console.error('❌ 补丁 dry-run 失败：')
  for (const p of r.problems) console.error('  - ' + p)
  process.exit(1)
}
