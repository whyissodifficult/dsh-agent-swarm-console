/**
 * F2 反证（可复现）：证明 node --check 的 .js 漏检漏洞已被堵住。
 *
 * 评审证据：同一份"补丁能 apply 但语法坏"的文件，
 *   - 坏代码在文件头         → node --check index.js 能抓到
 *   - 坏代码在文件中后部     → node --check index.js 漏检（exit 0），复制成 .mjs 才抓到
 * 所以这里跑两轮：head（旧门禁也能抓）+ middle（只有修后的 .mjs 门禁能抓）。
 * 每轮都确认补丁能 apply，再喂给 dryRunPatch，必须因 node --check 失败而 ok=false。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeSpawn, spawnErrorText } from './sandbox-spawn.mjs'
import { dryRunPatch } from './patch-dryrun.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const baseline = join(here, 'fixtures', 'index.baseline.js')
const src = readFileSync(baseline, 'utf8')

function makeBadPatch(broken) {
  const tmp = mkdtempSync(join(tmpdir(), 'f2-counterproof-'))
  const lib = join(tmp, 'lib')
  mkdirSync(lib)
  writeFileSync(join(lib, 'index.js'), src)
  for (const a of [['init', '-q'], ['config', 'user.email', 't@t'], ['config', 'user.name', 't'], ['add', '-A'], ['commit', '-qm', 'base']]) {
    const r = safeSpawn('git', a, { cwd: tmp })
    assert.equal(r.status, 0, 'git ' + a.join(' ') + ' 失败: ' + spawnErrorText(r, 'git'))
  }
  writeFileSync(join(lib, 'index.js'), broken)
  const diff = safeSpawn('git', ['diff'], { cwd: tmp })
  assert.equal(diff.status, 0, 'git diff 失败: ' + spawnErrorText(diff, 'git diff'))
  const badPatch = join(tmp, 'bad.patch')
  writeFileSync(badPatch, diff.stdout)
  const restore = safeSpawn('git', ['checkout', '-q', 'lib/index.js'], { cwd: tmp })
  assert.equal(restore.status, 0)
  const applyCheck = safeSpawn('git', ['apply', '--check', badPatch], { cwd: tmp })
  assert.equal(applyCheck.status, 0, '反证补丁应能 apply: ' + spawnErrorText(applyCheck, 'git apply --check'))
  return { tmp, lib, badPatch }
}

function runCase(name, broken) {
  const { tmp, lib, badPatch } = makeBadPatch(broken)
  try {
    const r = dryRunPatch({ patch: badPatch, fixture: join(lib, 'index.js') })
    assert.equal(r.ok, false, name + '：语法坏的补丁必须让 dryrun 失败')
    assert.ok(r.problems.some((p) => p.includes('node --check')), name + '：失败原因必须来自 node --check')
    console.log(`✅ F2 反证（${name}）：补丁能 apply，node --check 抓到语法错误 → dryrun 变红`)
    console.log('   ' + r.problems[0].split('\n')[0])
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

// A 组：坏代码插在文件头（旧 .js 检查也能抓，作为基线对照）
runCase('文件头', src.replace('import {', 'const BROKEN = ;\nimport {'))

// B 组：坏代码插在文件中后部（旧 .js 检查漏检，只有修后的 .mjs 能抓）——评审要求必须红
const lines = src.split('\n')
const pos = Math.floor(lines.length * 0.6)
const middleBad = [...lines.slice(0, pos), 'const BROKEN = ;', ...lines.slice(pos)].join('\n')
console.log(`\n· 中后部注入位置：第 ${pos + 1} 行 / 共 ${lines.length} 行（验证 .js 漏检、.mjs 可抓）`)
runCase('文件中后部', middleBad)
