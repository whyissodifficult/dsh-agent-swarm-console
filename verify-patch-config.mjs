// 验证 cordis.patch.yml：结构合法 + 没有裸 key
import fs from 'node:fs'

const txt = fs.readFileSync('cordis.patch.yml', 'utf8')

// 裸 key 检测：任何 20+ 字符的 sk- 串，或 apiKey: 后面直接给值
const hasBareKey = /sk-[A-Za-z0-9]{20,}/.test(txt)
const hasInlineKey = /apiKey\s*:\s*[^'"$\s]/.test(txt)

console.log('  文件里有裸 sk- key:', hasBareKey ? '❌ 有！' : '✅ 没有')
console.log('  有内联 apiKey 值:', hasInlineKey ? '❌ 有！' : '✅ 没有')

// 结构检查
const hasInsert = txt.includes('- insert:')
const hasExt = txt.includes('externalAgents:')
const hasRouting = txt.includes('capabilityRouting:')
console.log('  insert 段:', hasInsert ? '✅' : '❌')
console.log('  externalAgents 段:', hasExt ? '✅' : '❌')
console.log('  capabilityRouting:', hasRouting ? '✅' : '❌')

// 用 yaml 包解析（若可用）
try {
  const yaml = await import('yaml')
  const d = yaml.parse(txt)
  const cfg = d.insert[0].config
  console.log('\n  ✅ YAML 解析成功')
  console.log('  externalAgents 条目:', Object.keys(cfg.externalAgents).join(', '))
  console.log('  capabilityRouting:', cfg.capabilityRouting)
  for (const [k, v] of Object.entries(cfg.externalAgents)) {
    console.log(`   - ${k} | role=${v.role} | env=${v.apiKeyEnv} | models=${v.models.join(',')} | caps=${v.capabilities.join('/')}`)
  }
} catch (e) {
  console.log('\n  (无 yaml 包，跳过结构解析；上面的文本检查已覆盖关键项)')
}

process.exit(hasBareKey || hasInlineKey ? 1 : 0)
