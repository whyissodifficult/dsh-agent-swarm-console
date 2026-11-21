/**
 * 打包门禁：npm run plugin:pack
 * 在 plugin/ 里跑 npm pack --dry-run --json，断言：
 *   1. 打包列表含 lib/adapter.js（唯一实现在包内）
 *   2. 打包列表不含任何 ../ 越界路径
 * 这是把"../src 打包必断"的 blocker 变成永久回归。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const pluginDir = join(dirname(fileURLToPath(import.meta.url)), '..')
// Windows 上 npm 是 shim/cmd，需 shell:true 才能解析（PATH 在 npm run 下有效）
const r = spawnSync('npm', ['pack', '--dry-run', '--json'], {
  cwd: pluginDir,
  encoding: 'utf8',
  timeout: 60000,
  shell: true,
})
if (r.status !== 0) {
  console.error('❌ npm pack --dry-run --json 失败：' + (r.stderr || r.stdout || r.error?.message || '').slice(0, 500))
  process.exit(1)
}

let info
try { info = JSON.parse(r.stdout)[0] } catch (e) {
  console.error('❌ 无法解析 npm pack 输出：' + e.message)
  process.exit(1)
}
const files = (info.files || []).map((f) => f.path)
console.log('打包文件列表：')
for (const f of files) console.log('  ' + f)

let fail = 0
const check = (name, cond) => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name)
  if (!cond) fail++
}

console.log('\n=== 断言 ===')
check('含 lib/adapter.js', files.includes('lib/adapter.js'))
check('不含 ../ 越界路径', files.every((f) => !f.includes('../')))
check('含 index.js', files.includes('index.js'))
check('不含 icon.svg（未到位，不能指向不存在文件）', !files.includes('icon.svg'))

if (fail > 0) {
  console.error(`\n❌ plugin:pack 失败：${fail} 条断言未过`)
  process.exit(1)
}
console.log('\n✅ plugin:pack 通过：包自包含，无越界路径\n')
