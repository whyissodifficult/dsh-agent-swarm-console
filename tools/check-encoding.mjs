/**
 * 编码门禁：npm run encoding
 * 目的：抓「JSON 合法但中文是乱码」这类问题——GBK 误读写回后会产出合法 UTF-8 的乱码字符，
 * JSON.parse 与 UTF-8 解码都不会报错，只有按词表检查才能发现。
 * 覆盖：发布包内的文件 + 仓库顶层文档。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const targets = ['plugin', 'README.md', 'README.en.md', 'CHANGELOG.md', 'docs']
const exts = new Set(['.json', '.md', '.js', '.mjs', '.yml', '.yaml', '.txt'])
// 常见 GBK 误读产物：锛 銆 鈥 鏄 鍙 缂 闂 閮 戝 绛 锝 缁 涔 浠 姝 姝 鐨 鍚 鍦 鍜 銆
const mojibake = /[锛銆鈥鏄鍙缂闂閮戝绛锝缁涔浠姝鐨鍚鍦鍜]|Ã¤|Ã©|â€/

function walk(path, out = []) {
  let st
  try { st = statSync(path) } catch { return out }
  if (st.isFile()) { if (exts.has(extname(path))) out.push(path); return out }
  for (const name of readdirSync(path)) {
    if (name === 'node_modules' || name === '.git') continue
    walk(join(path, name), out)
  }
  return out
}

const files = []
for (const t of targets) walk(join(root, t), files)

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
