/**
 * 编码门禁：npm run encoding
 * 目的：抓「JSON 合法但中文是乱码」这类问题——GBK 误读写回后会产出合法 UTF-8 的乱码字符，
 * JSON.parse 与 UTF-8 解码都不会报错，只有按词表检查才能发现。
 * P1-3：范围扩到 wiring/ src/ tools/ plugin/ docs/ 与根级 *.md；词表新补 9 字。
 * 自身豁免：扫描时跳过本文件（词表里的乱码字符若被扫到会自撞）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const self = fileURLToPath(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')

// 常见 GBK 误读产物：原有 + P1-3 新补（鏇 柊 織 锟 斤 汥 娌 鐢 鍚）
const mojibake = /[锛銆鈥鏄鍙缂闂閮戝绛锝缁涔浠姝鐨鍚鍦鍜鏇柊織锟斤汥娌鐢鍚]|Ã¤|Ã©|â€/

const dirs = ['wiring', 'src', 'tools', 'plugin', 'docs']
const exts = new Set(['.json', '.md', '.js', '.mjs', '.yml', '.yaml', '.txt'])
const files = []

function walk(path, out = []) {
  let st
  try { st = statSync(path) } catch { return out }
  if (st.isFile()) {
    const norm = path.replace(/\\/g, '/')
    if (exts.has(extname(path)) && norm !== self.replace(/\\/g, '/')) out.push(path)
    return out
  }
  for (const name of readdirSync(path)) {
    if (name === 'node_modules' || name === '.git') continue
    walk(join(path, name), out)
  }
  return out
}

for (const d of dirs) walk(join(root, d), files)
for (const name of readdirSync(root)) {
  if (extname(name) === '.md') files.push(join(root, name))
}

let fail = 0
for (const f of files) {
  let text
  try {
    text = readFileSync(f, 'utf8') // 严格：非法 UTF-8 会在这里抛错
  } catch (e) {
    console.error(`  ❌ 非法 UTF-8：${relative(root, f)}（${e.message}）`)
    fail++
    continue
  }
  const bad = text.split('\n').findIndex((line) => mojibake.test(line))
  if (bad >= 0) {
    const line = text.split('\n')[bad].trim().slice(0, 80)
    console.error(`  ❌ 疑似乱码：${relative(root, f)}:${bad + 1}  ${line}`)
    fail++
  }
}

if (fail > 0) {
  console.error(`\n❌ encoding 门禁失败：${fail} 个文件有问题（JSON 合法 ≠ 内容正确）`)
  process.exit(1)
}
console.log(`✅ encoding 通过：扫描 ${files.length} 个文件，未发现乱码`)
