/**
 * Agent 画像清单 —— "因材施教"的配置层。
 * 新接一个 agent = 加一条，不写代码。
 *
 * 令牌从环境变量读，绝不写进代码或提交到仓库。
 *
 * 端点与模型名都支持环境变量覆盖，方便在不改代码的情况下指向不同部署：
 *   DEEPSEEK_BASE_URL / DEEPSEEK_MODEL
 *   QODER_BASE_URL    / QODER_MODEL
 *   KIMI_BASE_URL     / KIMI_MODEL
 *   OLLAMA_BASE_URL  / OLLAMA_MODEL
 */

/** 取环境变量覆盖值，没设就用默认值。 */
function env(name, fallback) {
  const v = process.env[name]
  return typeof v === 'string' && v !== '' ? v : fallback
}

export const PROFILES = {
  // ── 主力推理：DeepSeek（官方 token 补贴也走这里）──
  deepseek: {
    name: 'deepseek',
    baseUrl: env('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1'),
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    models: [env('DEEPSEEK_MODEL', 'deepseek-v4-pro'), 'deepseek-flash'],
    capabilities: ['reasoning', 'chinese', 'code', 'summary'],
    // DeepSeek 支持 reasoning_effort；其他 provider 未声明时适配器不会发送该字段
    supportsReasoningEffort: true,
    maxConcurrency: 4,
  },

  // ── 多模态 + 长上下文：Qoder（阿里系）──
  // 需要自己起一个说 OpenAI 兼容协议的服务；默认指向本机 38991 端口。
  qoder: {
    name: 'qoder',
    baseUrl: env('QODER_BASE_URL', 'http://127.0.0.1:38991/qoder-cn/v1'),
    apiKeyEnv: 'QODER_API_KEY',
    models: [env('QODER_MODEL', 'Qwen3.8-Max'), 'Qwen3.8-Flash'],
    capabilities: ['vision', 'long-context', 'code'],
    maxConcurrency: 2,
  },

  // ── 中文长文：Kimi ──
  kimi: {
    name: 'kimi',
    baseUrl: env('KIMI_BASE_URL', 'https://api.moonshot.cn/v1'),
    apiKeyEnv: 'KIMI_API_KEY',
    models: [env('KIMI_MODEL', 'kimi-k3')],
    capabilities: ['long-context', 'chinese', 'web'],
    maxConcurrency: 2,
  },

  // ── 本地私有：Ollama（免费、断网可用）──
  // 注意：默认端口 11434 上跑的可能是别的服务（例如只有 embeddings 的
  // 向量库），未必提供 /v1/chat/completions。用之前先确认：
  //   curl http://127.0.0.1:11434/v1/models
  ollama: {
    name: 'ollama',
    baseUrl: env('OLLAMA_BASE_URL', 'http://127.0.0.1:11434/v1'),
    apiKeyEnv: 'OLLAMA_API_KEY',
    models: [env('OLLAMA_MODEL', 'qwen2.5-coder:7b')],
    capabilities: ['local', 'private', 'free', 'code'],
    maxConcurrency: 1,
  },
}

/**
 * 按能力标签挑一个 agent —— 这就是"因材施教"。
 *
 * 预留未接线：swarm 主插件用的是自己配置文件里的 externalAgents，
 * 这份表是同一套思路的独立实现，尚未接入插件的 spawn 路径。
 * 接线点见 src/external-agent-adapter.js 的 pickExternalProfile（插件内版本）。
 *
 * @param {string|string[]} required 需要的能力
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
