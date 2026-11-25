/**
 * 0.8.0 · 契约模板
 *
 * 为什么：写 criteria + checkIds + checks 三处映射太啰嗦，而常见验收条件就那几种。
 * 模板只做一件事：**把「目标」翻译成一份带建议检查的契约骨架**，用户仍然要看全文再 `--yes`。
 *
 * 约定：模板产出的 criteria 里的 checkIds 与 suggestedChecks 的 id 必须一一对应；
 * `verify_run` 在调用方没给 checks 时，用契约里的 suggestedChecks。
 */

/** 支持的模板；未知模板报错并列出可用的。 */
export const TEMPLATES = {
  'readme-install': {
    summary: 'README 存在，且含「安装」小节',
    build: () => ({
      criteria: [
        { id: 'readme', text: 'README.md 存在', checkIds: ['readme-exists'] },
        { id: 'install', text: 'README 里有安装说明', checkIds: ['readme-install-section'] },
      ],
      suggestedChecks: [
        { id: 'readme-exists', type: 'file.exists', path: 'README.md' },
        { id: 'readme-install-section', type: 'text.contains', path: 'README.md', text: '## 安装' },
      ],
    }),
  },
  'tests-green': {
    summary: '唯一允许的测试命令跑通',
    requiresTestCmd: true,
    build: (testCmd) => ({
      criteria: [{ id: 'tests', text: `测试通过：${testCmd}`, checkIds: ['tests'] }],
      suggestedChecks: [{ id: 'tests', type: 'exec', cmd: testCmd }],
    }),
  },
  'package-version': {
    summary: 'package.json 的 version 等于目标版本',
    requiresParam: 'version',
    build: (_testCmd, params) => ({
      criteria: [{ id: 'version', text: `package.json version = ${params.version}`, checkIds: ['version'] }],
      suggestedChecks: [{ id: 'version', type: 'json.field', path: 'package.json', field: 'version', equals: params.version }],
    }),
  },
  'tests-present': {
    summary: '仓库里有测试文件（至少匹配一个）',
    build: () => ({
      criteria: [{ id: 'has-tests', text: '存在测试文件', checkIds: ['has-tests'] }],
      suggestedChecks: [
        { id: 'has-tests', type: 'glob.exists', pattern: '**/*.test.*' },
      ],
    }),
  },
}

export function templateNames() {
  return Object.keys(TEMPLATES).join(', ')
}

/**
 * 解析模板参数（形如 `package-version:1.2.3`）。
 * @returns {{name:string, params:Record<string,string>}}
 */
export function parseTemplate(spec) {
  if (typeof spec !== 'string' || spec.trim() === '') return null
  const [name, ...rest] = spec.split(':')
  const params = {}
  if (rest.length > 0) params.version = rest.join(':').trim()
  return { name: name.trim(), params }
}

/**
 * 把模板展开成 { criteria, suggestedChecks }；失败抛错（错误信息面向用户）。
 */
export function expandTemplate(spec, { testCmd } = {}) {
  const parsed = parseTemplate(spec)
  if (!parsed) throw new Error('模板名不能为空')
  const tpl = TEMPLATES[parsed.name]
  if (!tpl) throw new Error(`未知模板「${parsed.name}」，可用：${templateNames()}`)
  if (tpl.requiresTestCmd && (typeof testCmd !== 'string' || testCmd.trim() === '')) {
    throw new Error(`模板「${parsed.name}」需要先声明 testCmd（exec 检查唯一允许的命令）`)
  }
  if (tpl.requiresParam && !parsed.params[tpl.requiresParam]) {
    throw new Error(`模板「${parsed.name}」需要参数，写法：${parsed.name}:<${tpl.requiresParam}>`)
  }
  return tpl.build(testCmd, parsed.params)
}
