/**
 * Agent 画像清单 —— "因材施教"的配置层。
 * 新接一个 agent = 加一条，不写代码。
 *
 * 令牌从环境变量读，绝不写进代码或提交到仓库。
 */
export const PROFILES = {
  // ── 主力推理：DeepSeek（官方 token 补贴也走这里）──
  deepseek: {
    name: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    capabilities: ['reasoning', 'chinese', 'code', 'summary'],
    maxConcurrency: 4,
  },

  // ── 多模态 + 长上下文：Qoder（阿里系，qoder-cn 通道）──
  qoder: {
    name: 'qoder',
    baseUrl: 'http://127.0.0.1:38991/qoder-cn/v1',   // 走 router 的 loopback
    apiKeyEnv: 'QODER_API_KEY',
    models: ['Qwen3.8-Max', 'Qwen3.8-Flash'],
    capabilities: ['vision', 'long-context', 'code'],
    maxConcurrency: 2,
  },

  // ── 本地私有：Ollama（免费、断网可用）──
  ollama: {
    name: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    models: ['qwen2.5-coder:7b'],
    capabilities: ['local', 'private', 'free', 'code'],
    maxConcurrency: 1,
  },

  // ── 中文长文：Kimi ──
  kimi: {
    name: 'kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'KIMI_API_KEY',
    models: ['kimi-k3'],
    capabilities: ['long-context', 'chinese', 'web'],
    maxConcurrency: 2,
  },
}

/**
 * 按能力标签挑一个 agent —— 这就是"因材施教"。
 * @param {string[]} required 需要的能力
 * @returns {object|null} 选中的 profile；没有匹配返回 null
 */
export function pickByCapability(required) {
  const need = Array.isArray(required) ? required : [required]
  const candidates = Object.values(PROFILES).filter((p) =>
    need.every((cap) => p.capabilities.includes(cap))
  )
  if (candidates.length === 0) return null
  // 优先免费/本地的，其次按并发能力
  candidates.sort((a, b) => {
    const score = (p) => (p.capabilities.includes('free') ? 0 : p.capabilities.includes('local') ? 1 : 2)
    return score(a) - score(b)
  })
  return candidates[0]
}
