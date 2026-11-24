/**
 * 0.6.0 · 持久化 store：把契约与运行状态落到磁盘，重启不丢。
 *
 * 设计取舍：
 *  - 单文件 JSON（不是数据库）：数据量小、可人工检查、无原生依赖
 *  - 原子写：先写 `<file>.tmp` 再 rename，避免半截文件
 *  - 懒写：变更后 debounce 200ms 合并写，避免每次 checks 都落盘
 *  - 容错：文件损坏/不存在 → 从空 store 启动，并留一条 warning，不阻塞插件激活
 *  - 上限：契约与运行各保留最近 MAX_ENTRIES 条（按写入顺序淘汰最旧的）
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const MAX_ENTRIES = 500
const DEBOUNCE_MS = 200

/**
 * 打开一个持久化 store。
 * @param {string} filePath JSON 文件路径（父目录不存在会自动创建）
 * @param {{now?:()=>number}} [opts]
 * @returns {{contracts:Map, runs:Map, flush:()=>void, close:()=>void, warnings:string[], filePath:string}}
 */
export function openPersistentStores(filePath, opts = {}) {
  const contracts = new Map()
  const runs = new Map()
  const warnings = []
  let timer

  // ── 读取 ──
  if (!filePath) {
    warnings.push('未配置 stateFile，契约与证据只存在内存里（重启即丢）')
  } else if (!existsSync(filePath)) {
    warnings.push(`状态文件不存在，按空状态启动：${filePath}`)
  } else {
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf8'))
      hydrate(contracts, raw?.contracts)
      hydrate(runs, raw?.runs)
    } catch (error) {
      warnings.push(`状态文件读取失败（按空状态启动）：${error?.message ?? error}`)
    }
  }

  // ── 写入（debounce + 原子）──
  function flush() {
    if (!filePath) return
    clearTimeout(timer)
    timer = undefined
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      const payload = JSON.stringify({
        version: 1,
        savedAt: new Date(opts.now?.() ?? Date.now()).toISOString(),
        contracts: dump(contracts),
        runs: dump(runs),
      }, null, 2)
      const tmp = `${filePath}.tmp`
      writeFileSync(tmp, payload, 'utf8')
      renameSync(tmp, filePath)
    } catch (error) {
      warnings.push(`状态写入失败：${error?.message ?? error}`)
    }
  }

  function scheduleFlush() {
    if (!filePath) return
    if (timer) return
    timer = setTimeout(flush, DEBOUNCE_MS)
    // 不阻止进程退出
    if (typeof timer.unref === 'function') timer.unref()
  }

  return {
    contracts: tracked(contracts, scheduleFlush),
    runs: tracked(runs, scheduleFlush),
    flush,
    close() {
      clearTimeout(timer)
      timer = undefined
      flush()
    },
    warnings,
    filePath,
  }
}

/** 默认状态文件：优先用 DSH profile 目录，退到用户主目录。 */
export function defaultStateFile(env = process.env) {
  const home = env.USERPROFILE || env.HOME || ''
  if (!home) return ''
  return join(home, '.dsh', 'swarm-console', 'state.json')
}

// ── 内部 ──

/** 包一层 Map：写入时裁剪上限并触发落盘。 */
function tracked(map, onChange) {
  const api = {
    get: (k) => map.get(k),
    has: (k) => map.has(k),
    keys: () => map.keys(),
    values: () => map.values(),
    entries: () => map.entries(),
    get size() { return map.size },
    set: (k, v) => { map.set(k, v); trim(map); onChange(); return api },
    delete: (k) => { const ok = map.delete(k); if (ok) onChange(); return ok },
    clear: () => { map.clear(); onChange() },
    [Symbol.iterator]: () => map[Symbol.iterator](),
  }
  return api
}

function trim(map) {
  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next()
    if (oldest.done) break
    map.delete(oldest.value)
  }
}

function dump(map) {
  const out = []
  for (const [k, v] of map) out.push([k, v])
  return out
}

function hydrate(map, rows) {
  if (!Array.isArray(rows)) return
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 2) continue
    const [k, v] = row
    if (typeof k !== 'string') continue
    if (v === null || typeof v !== 'object') continue
    map.set(k, v)
  }
}
