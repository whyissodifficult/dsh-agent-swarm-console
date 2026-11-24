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
      renameWithRetry(tmp, filePath)
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
    set: (k, v) => {
      // 已存在则先删后插：让 Map 的插入序等于最近使用序（LRU）
      if (map.has(k)) map.delete(k)
      map.set(k, v)
      trim(map)
      onChange()
      return api
    },
    delete: (k) => { const ok = map.delete(k); if (ok) onChange(); return ok },
    clear: () => { map.clear(); onChange() },
    [Symbol.iterator]: () => map[Symbol.iterator](),
  }
  return api
}

/**
 * 淘汰：优先删最旧的非关键记录。
 * 已确认（confirmed）或已放行（approved）的记录不参与淘汰——
 * 让“签过字的证据”被静默丢掉，比涨一点文件体积糟得多。
 */
function trim(map) {
  if (map.size <= MAX_ENTRIES) return
  for (const k of [...map.keys()]) {
    if (map.size <= MAX_ENTRIES) break
    const v = map.get(k)
    if (v && (v.confirmed === true || v.approved === true)) continue
    map.delete(k)
  }
}

/** rename 在 Windows 上可能被索引/杀软短暂占用（EBUSY/EPERM）：重试几次再放弃。 */
function renameWithRetry(from, to, attempts = 3) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    try {
      renameSync(from, to)
      return
    } catch (error) {
      lastError = error
      const code = error?.code
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') break
      // 同步等待 30ms（Node 同步 API 没有 sleep，用忙等换取确定性）
      const until = Date.now() + 30
      while (Date.now() < until) { /* spin */ }
    }
  }
  throw lastError
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
