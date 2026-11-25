/**
 * 0.7.0 · 检查类型扩展（pure fs，不依赖 shell）
 *
 * 设计原则：
 *  - 一切路径相对 workspaceRoot，且 realpath 后再校验一次边界（与 file.exists 同规则）
 *  - 只读：不写文件、不改权限
 *  - 失败一律返回 {ok:false, detail}，不抛（抛异常会让模型看到堆栈）
 */
import { existsSync, readFileSync, readdirSync, statSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const MAX_READ_BYTES = 2 * 1024 * 1024
const MAX_GLOB_MATCHES = 500

/** 路径是否真的在 root 之外 */
export function isOutside(rel) {
  return rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)
}

/**
 * 解析并校验一个相对路径：返回 { absPath } 或 { error }。
 * 词法 + realpath 双重边界校验（符号链接/junction 也挡）。
 */
export function safeResolve(workspaceRoot, relPath, deps = {}) {
  if (typeof relPath !== 'string' || relPath === '') return { error: '缺少 path' }
  if (isAbsolute(relPath)) return { error: '路径必须是相对 workspaceRoot 的相对路径' }
  if (typeof workspaceRoot !== 'string' || workspaceRoot === '') return { error: '缺少 workspaceRoot' }
  const absPath = resolve(workspaceRoot, relPath)
  if (isOutside(relative(workspaceRoot, absPath))) return { error: `检查路径越出 workspaceRoot：${relPath}` }
  let realRoot = workspaceRoot
  let realPath = absPath
  try { realRoot = (deps.realpathSync ?? realpathSync)(workspaceRoot) } catch { /* 按词法处理 */ }
  try { realPath = (deps.realpathSync ?? realpathSync)(absPath) } catch { /* 不存在则保持词法 */ }
  if (isOutside(relative(realRoot, realPath))) return { error: `检查路径经符号链接解析后越出 workspaceRoot：${relPath}` }
  return { absPath }
}

/** 极简 glob → RegExp：支持 **、*、?，其余字符按字面量。 */
export function globToRegExp(pattern) {
  let out = '^'
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*'
        i++
        if (pattern[i + 1] === '/') i++
      } else {
        out += '[^/]*'
      }
    } else if (c === '?') {
      out += '[^/]'
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      out += '\\' + c
    } else if (c === '/') {
      out += '/'
    } else {
      out += c
    }
  }
  return new RegExp(out + '$')
}

function walk(dir, base, acc, limit) {
  if (acc.length >= limit) return acc
  let names
  try { names = readdirSync(dir) } catch { return acc }
  for (const name of names) {
    if (name === 'node_modules' || name === '.git') continue
    const abs = join(dir, name)
    let st
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) walk(abs, base, acc, limit)
    else if (acc.length < limit) acc.push(relative(base, abs).split(sep).join('/'))
    if (acc.length >= limit) break
  }
  return acc
}

/**
 * 执行一条非 exec 检查。返回 check 对象（不含 id/type，由调用方补）。
 * 未知类型返回 null，让调用方走 invalid 分支。
 */
export function runFsCheck(req, workspaceRoot, deps = {}) {
  const read = (p) => readFileSync(p, 'utf8')

  if (req.type === 'glob.exists') {
    if (typeof req.pattern !== 'string' || req.pattern === '') return { ok: false, detail: 'glob.exists 必带 pattern' }
    if (isAbsolute(req.pattern)) return { ok: false, detail: 'pattern 必须是相对路径' }
    // 起点目录 = 第一个通配符之前的最后一段目录（不是最后一个 '/'，否则会拼出含 * 的假路径）
    const firstMeta = req.pattern.search(/[*?[]/)
    const prefix = firstMeta === -1 ? req.pattern : req.pattern.slice(0, firstMeta)
    const dirPart = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '.'
    const rootRes = safeResolve(workspaceRoot, dirPart === '' ? '.' : dirPart, deps)
    if (rootRes.error) return { ok: false, pattern: req.pattern, detail: rootRes.error }
    const re = globToRegExp(req.pattern)
    const files = walk(rootRes.absPath, workspaceRoot, [], MAX_GLOB_MATCHES + 1)
    const matches = files.filter((f) => re.test(f.split(sep).join('/'))).slice(0, MAX_GLOB_MATCHES)
    return {
      ok: matches.length > 0,
      pattern: req.pattern,
      matches,
      detail: matches.length > 0
        ? `匹配到 ${matches.length} 个文件（例：${matches.slice(0, 3).join(', ')}）`
        : `没有文件匹配 ${req.pattern}`,
    }
  }

  if (req.type === 'text.contains') {
    const res = safeResolve(workspaceRoot, req.path, deps)
    if (res.error) return { ok: false, path: req.path, detail: res.error }
    if (typeof req.text !== 'string' || req.text === '') return { ok: false, path: req.path, detail: 'text.contains 必带 text' }
    let content
    try {
      const st = statSync(res.absPath)
      if (st.size > MAX_READ_BYTES) return { ok: false, path: req.path, detail: `文件超过 ${MAX_READ_BYTES} 字节，拒绝读取` }
      content = read(res.absPath)
    } catch {
      return { ok: false, path: req.path, detail: `文件不存在或不可读：${req.path}` }
    }
    const ok = content.includes(req.text)
    return { ok, path: req.path, absPath: res.absPath, contains: req.text, detail: ok ? `文件包含指定文本（${req.text.slice(0, 40)}）` : `文件不含指定文本（${req.text.slice(0, 40)}）` }
  }

  if (req.type === 'json.field') {
    const res = safeResolve(workspaceRoot, req.path, deps)
    if (res.error) return { ok: false, path: req.path, detail: res.error }
    if (typeof req.field !== 'string' || req.field === '') return { ok: false, path: req.path, detail: 'json.field 必带 field（点分路径，如 version 或 deps.count）' }
    let parsed
    try { parsed = JSON.parse(read(res.absPath)) } catch { return { ok: false, path: req.path, detail: `不是合法 JSON 或不可读：${req.path}` } }
    let cur = parsed
    for (const seg of req.field.split('.')) {
      if (cur === null || typeof cur !== 'object' || !(seg in cur)) {
        return { ok: false, path: req.path, field: req.field, detail: `JSON 里没有字段 ${req.field}` }
      }
      cur = cur[seg]
    }
    if (req.equals !== undefined) {
      const ok = JSON.stringify(cur) === JSON.stringify(req.equals)
      return { ok, path: req.path, field: req.field, value: cur, detail: ok ? `${req.field} = ${JSON.stringify(cur)}` : `${req.field} = ${JSON.stringify(cur)}，期望 ${JSON.stringify(req.equals)}` }
    }
    return { ok: true, path: req.path, field: req.field, value: cur, detail: `${req.field} = ${JSON.stringify(cur).slice(0, 60)}` }
  }

  if (req.type === 'file.sha256') {
    const res = safeResolve(workspaceRoot, req.path, deps)
    if (res.error) return { ok: false, path: req.path, detail: res.error }
    if (typeof req.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(req.sha256)) {
      return { ok: false, path: req.path, detail: 'file.sha256 必带 64 位十六进制 sha256' }
    }
    let digest
    try { digest = createHash('sha256').update(readFileSync(res.absPath)).digest('hex') } catch {
      return { ok: false, path: req.path, detail: `文件不存在或不可读：${req.path}` }
    }
    const ok = digest === req.sha256.toLowerCase()
    return { ok, path: req.path, absPath: res.absPath, sha256: digest, detail: ok ? '哈希一致' : `哈希不一致（实际 ${digest.slice(0, 16)}…）` }
  }

  return null
}
