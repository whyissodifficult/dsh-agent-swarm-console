/**
 * 一键把适配层接进 dsh-agent-swarm 插件。
 *
 * 用法：
 *   node wiring/install.mjs <swarm插件目录>
 * 例：
 *   node wiring/install.mjs E:/GitHub研究/dsh-agent-swarm
 *
 * 做三件事：
 *   1. 检查目标是不是 dsh-agent-swarm（有 lib/index.js 且含 agent-swarm）
 *   2. 把 swarm-index.patch 打进 lib/index.js（备份原文件，幂等）
 *   3. 把新版 external-agent-adapter.js 装到 lib/（这是过了评审的那版）
 *
 * 打完补丁后做后置校验：node --check + 断言 spawnExternal 恰好 2 处。
 * 不联网、不改配置、不碰令牌。配置样例见 wiring/README.md。
 */
import { existsSync, readFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = fileURLToPath(new URL('.', import.meta.url))
const target = process.argv[2] ? resolve(process.argv[2]) : null

if (!target) {
  console.error('用法: node wiring/install.mjs <swarm插件目录>')
  process.exit(2)
}

const indexFile = join(target, 'lib', 'index.js')
if (!existsSync(indexFile)) {
  console.error(`❌ 不是 dsh-agent-swarm 目录（找不到 ${indexFile}）`)
  process.exit(2)
}
if (!readFileSync(indexFile, 'utf8').includes('agent-swarm')) {
  console.error('❌ lib/index.js 里没有 agent-swarm，目标可能不是这个插件')
  process.exit(2)
}

// git 不可用要早说，别让后面的 apply 报空字符串
const gitVersion = spawnSync('git', ['--version'], { encoding: 'utf8' })
if (gitVersion.status !== 0) {
  console.error('❌ 未找到 git（补丁需要 git apply）。请先安装 git 并加入 PATH。')
  if (gitVersion.error) console.error('   ' + gitVersion.error.message)
  process.exit(1)
}

let backupDir = null
function ensureBackup() {
  if (backupDir === null) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    backupDir = join(target, '.wiring-backup', stamp)
    mkdirSync(backupDir, { recursive: true })
  }
  return backupDir
}

// 1) 幂等检查 + 打补丁。判定用定义标记，不与上游将来可能有的同名调用混淆。
const INSTALL_MARK = 'const spawnExternal = async'
const current = readFileSync(indexFile, 'utf8')
if (current.includes(INSTALL_MARK)) {
  console.log('· lib/index.js 已接过线，跳过补丁（不创建备份目录）')
} else {
  const dir = ensureBackup()
  copyFileSync(indexFile, join(dir, 'index.js'))
  const patch = join(here, 'swarm-index.patch')
  const r = spawnSync('git', ['apply', patch], { cwd: target, encoding: 'utf8' })
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || '').trim() || 'git apply 返回非 0（可能 git 未安装或目标不是基线 dd67b64）'
    console.error('❌ 补丁应用失败：' + msg)
    console.error('   目标可能不是基线 dd67b64，或已手工改过 lib/index.js。')
    console.error('   原文件未改（备份在 ' + dir + '）')
    process.exit(1)
  }

  // 后置校验 1：语法
  const syntax = spawnSync(process.execPath, ['--check', indexFile], { encoding: 'utf8' })
  if (syntax.status !== 0) {
    console.error('❌ 打补丁后 node --check 失败，语法被破坏：')
    console.error((syntax.stderr || syntax.stdout || '').trim())
    console.error('   备份在 ' + dir + '，可据此还原。')
    process.exit(1)
  }
  // 后置校验 2：结构
  const after = readFileSync(indexFile, 'utf8')
  const n = (after.match(/spawnExternal/g) || []).length
  if (n !== 2) {
    console.error(`❌ 打补丁后 spawnExternal 出现 ${n} 次，期望 2（调用处+定义处）；备份在 ${dir}`)
    process.exit(1)
  }
  console.log('✅ 补丁已打进 lib/index.js（node --check 通过，spawnExternal=2）')
}

// 2) 装新版适配器（替换旧版）
const adapterSrc = join(here, 'external-agent-adapter.js')
const adapterDst = join(target, 'lib', 'external-agent-adapter.js')
if (existsSync(adapterDst)) {
  const oldText = readFileSync(adapterDst, 'utf8')
  if (oldText.includes('PROGRESS_FULL_CHARS') && oldText.includes('randomUUID')) {
    console.log('· 目标适配器已是新版，跳过覆盖（不创建备份目录）')
  } else {
    copyFileSync(adapterDst, join(ensureBackup(), 'external-agent-adapter.js'))
    copyFileSync(adapterSrc, adapterDst)
    console.log('✅ 旧版适配器已替换为过评审的新版')
  }
} else {
  copyFileSync(adapterSrc, adapterDst)
  console.log('✅ 适配器已安装')
}

// 3) 集成测试 + dry-run 依赖放到 lib/（与适配器同目录，import 路径就能直接对上）
copyFileSync(join(here, 'integration-test.mjs'), join(target, 'lib', 'integration-test.mjs'))
copyFileSync(join(here, 'patch-dryrun.mjs'), join(target, 'lib', 'patch-dryrun.mjs'))
copyFileSync(join(here, 'swarm-index.patch'), join(target, 'lib', 'swarm-index.patch'))
mkdirSync(join(target, 'lib', 'fixtures'), { recursive: true })
copyFileSync(join(here, 'fixtures', 'index.baseline.js'), join(target, 'lib', 'fixtures', 'index.baseline.js'))
console.log('✅ 集成测试 + 补丁 dry-run 依赖已放到 lib/：node lib/integration-test.mjs')
console.log(backupDir ? `\n备份目录：${backupDir}` : '\n本次未改动原文件，无备份目录。')
console.log('下一步：按 wiring/README.md 配 cordis.patch.yml 的 externalAgents，重启 DSH。')
