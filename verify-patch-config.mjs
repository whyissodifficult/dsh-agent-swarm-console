/**
 * 配置安全检查 —— 确认即将提交的 DSH bundle 配置是安全的。
 *
 * 检查项：
 *   1. 文件里没有裸的 sk- key
 *   2. 没有内联的 apiKey 值
 *   3. 结构段齐全（insert / externalAgents / capabilityRouting）
 *
 * 退出码：
 *   0 = 全部通过
 *   1 = 有安全问题（裸 key / 内联 key）或结构缺失
 *   2 = 文件不存在（无法检查）
 */
import fs from 'node:fs'
import path from 'node:path'

// 默认可在仓库根，也可用环境变量指向别处
const target = process.env.PATCH_FILE ?? path.join(process.cwd(), 'cordis.patch.yml')

if (!fs.existsSync(target)) {
  console.log(`⚠️  找不到 ${target}`)
  console.log('')
  console.log('这个脚本检查 DSH bundle 的 patch 配置。')
  console.log('若你只改了适配层（src/），本仓库不需要该文件——')
  console.log('可以设 PATCH_FILE 指向实际路径：')
  console.log('  PATCH_FILE=/path/to/dsh-agent-swarm/cordis.patch.yml node verify-patch-config.mjs')
  process.exit(2)
}

const txt = fs.readFileSync(target, 'utf8')

// ── 1. 裸 key 检测 ──
const hasBareKey = /sk-[A-Za-z0-9]{20,}/.test(txt)
const hasInlineKey = /apiKey\s*:\s*[^'"$\s]/.test(txt)

console.log(`检查文件：${target}`)
console.log(`  裸 sk- key:      ${hasBareKey ? '❌ 有！' : '✅ 没有'}`)
console.log(`  内联 apiKey 值:  ${hasInlineKey ? '❌ 有！' : '✅ 没有'}`)

// ── 2. 结构检查 ──
const hasInsert = txt.includes('- insert:')
const hasExt = txt.includes('externalAgents:')
const hasRouting = txt.includes('capabilityRouting:')
console.log(`  insert 段:        ${hasInsert ? '✅' : '❌ 缺'}`)
console.log(`  externalAgents:   ${hasExt ? '✅' : '❌ 缺'}`)
console.log(`  capabilityRouting: ${hasRouting ? '✅' : '❌ 缺'}`)

// ── 3. YAML 解析（可选）──
try {
  const yaml = await import('yaml')
  const d = yaml.parse(txt)
  const cfg = d.insert[0].config
  console.log(`\n  ✅ YAML 解析成功`)
  console.log(`  externalAgents 条目: ${Object.keys(cfg.externalAgents ?? {}).join(', ') || '(无)'}`)
  for (const [k, v] of Object.entries(cfg.externalAgents ?? {})) {
    console.log(`   - ${k} | role=${v.role} | env=${v.apiKeyEnv} | models=${(v.models ?? []).join(',')}`)
  }
} catch (e) {
  console.log(`\n  ⚠️  YAML 解析跳过：${e.code === 'ERR_MODULE_NOT_FOUND' ? '未安装 yaml（npm i 后可用）' : e.message}`)
  console.log('     上面的文本检查仍覆盖了 key 泄露与结构存在性。')
}

const allOk = !hasBareKey && !hasInlineKey && hasInsert && hasExt && hasRouting
console.log(`\n${allOk ? '✅ 全部通过' : '❌ 存在问题'}`)
process.exit(allOk ? 0 : 1)
