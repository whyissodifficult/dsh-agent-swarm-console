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
 * 不联网、不改配置、不碰令牌。配置样例见 wiring/README.md。
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
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

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupDir = join(target, '.wiring-backup', stamp)
mkdirSync(backupDir, { recursive: true })

// 1) 幂等检查 + 打补丁
const current = readFileSync(indexFile, 'utf8')
if (current.includes('spawnExternal')) {
  console.log('· lib/index.js 已接过线，跳过补丁')
} else {
  copyFileSync(indexFile, join(backupDir, 'index.js'))
  const patch = join(here, 'swarm-index.patch')
  const r = spawnSync('git', ['apply', patch], { cwd: target, encoding: 'utf8' })
  if (r.status !== 0) {
    console.error('❌ 补丁应用失败：', (r.stderr || r.stdout || '').trim())
    console.error('   目标可能不是基线 dd67b64，或已手工改过 lib/index.js。')
    console.error('   原文件未改（备份在 ' + backupDir + '）')
    process.exit(1)
  }
  console.log('✅ 补丁已打进 lib/index.js')
}

// 2) 装新版适配器（替换旧版）
const adapterSrc = join(here, 'external-agent-adapter.js')
const adapterDst = join(target, 'lib', 'external-agent-adapter.js')
if (existsSync(adapterDst)) {
  copyFileSync(adapterDst, join(backupDir, 'external-agent-adapter.js'))
  const oldText = readFileSync(adapterDst, 'utf8')
  if (oldText.includes('PROGRESS_FULL_CHARS') && oldText.includes('randomUUID')) {
    console.log('· 目标适配器已是新版，跳过覆盖')
  } else {
    copyFileSync(adapterSrc, adapterDst)
    console.log('✅ 旧版适配器已替换为过评审的新版')
  }
} else {
  copyFileSync(adapterSrc, adapterDst)
  console.log('✅ 适配器已安装')
}

// 3) 集成测试放到 lib/（与适配器同目录，import 路径就能直接对上）
copyFileSync(join(here, 'integration-test.mjs'), join(target, 'lib', 'integration-test.mjs'))
console.log('✅ 集成测试已放到 lib/：node lib/integration-test.mjs')
console.log(`\n备份目录：${backupDir}`)
console.log('下一步：按 wiring/README.md 配 cordis.patch.yml 的 externalAgents，重启 DSH。')
