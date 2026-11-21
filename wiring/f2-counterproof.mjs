/**
 * F2 反证（可复现）：证明 patch-dryrun 的 node --check 能抓到
 * "补丁能 apply、但打完语法坏"的情况。
 *
 * 做法：临时造一个基线 + 一个只插入 `const BROKEN = ;` 的补丁，
 * git apply --check 必须过（证明"能打上"），
 * 再喂给 dryRunPatch，必须因 node --check 失败而 ok=false（证明"门禁抓到了"）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { dryRunPatch } from './patch-dryrun.mjs'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const baseline = join(here, 'fixtures', 'index.baseline.js')
const tmp = mkdtempSync(join(tmpdir(), 'f2-counterproof-'))

try {
  const lib = join(tmp, 'lib')
  mkdirSync(lib)
  const src = readFileSync(baseline, 'utf8')
  writeFileSync(join(lib, 'index.js'), src)

  // 造一个 git 仓库，提交基线，再改出"语法坏"的补丁
  for (const a of [['init', '-q'], ['config', 'user.email', 't@t'], ['config', 'user.name', 't'], ['add', '-A'], ['commit', '-qm', 'base']]) {
    const r = spawnSync('git', a, { cwd: tmp, encoding: 'utf8' })
    assert.equal(r.status, 0, 'git ' + a.join(' ') + ' 失败')
  }
  const broken = src.replace('import {', 'const BROKEN = ;\nimport {')
  assert.notEqual(broken, src, '注入点没找到')
  writeFileSync(join(lib, 'index.js'), broken)
  const diff = spawnSync('git', ['diff'], { cwd: tmp, encoding: 'utf8' })
  assert.equal(diff.status, 0)
  const badPatch = join(tmp, 'bad.patch')
  writeFileSync(badPatch, diff.stdout)

  // 还原基线，让 apply 能过
  const restore = spawnSync('git', ['checkout', '-q', 'lib/index.js'], { cwd: tmp, encoding: 'utf8' })
  assert.equal(restore.status, 0)
  const applyCheck = spawnSync('git', ['apply', '--check', badPatch], { cwd: tmp, encoding: 'utf8' })
  assert.equal(applyCheck.status, 0, '反证补丁应能 apply')

  const r = dryRunPatch({ patch: badPatch, fixture: join(lib, 'index.js') })
  assert.equal(r.ok, false, '语法坏的补丁必须让 dryrun 失败')
  assert.ok(r.problems.some((p) => p.includes('node --check')), '失败原因必须来自 node --check')

  console.log('✅ F2 反证：补丁能 apply，但 node --check 抓到语法错误 → dryrun 变红')
  console.log('   ' + r.problems[0].split('\n')[0])
} finally {
  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
}
