/**
 * 零依赖的 Zod-like schema，满足 dsh-action-cards 的 details 鸭子类型：
 *   safeParse(value) → { success:true, data } | { success:false, error:{ issues } }
 * 不引入 zod（评审约束：不加运行时依赖）。
 * 支持本插件需要的字段类型：string / array(string) / enum / optional。
 */

export function zObject(shape) {
  return {
    safeParse(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { success: false, error: { issues: [{ path: [], message: 'details 必须是对象' }] } }
      }
      const data = {}
      const issues = []
      for (const [key, spec] of Object.entries(shape)) {
        const r = parseField(value[key], spec, [key])
        if (r.ok) {
          if (r.value !== undefined) data[key] = r.value
        } else {
          issues.push(...r.issues)
        }
      }
      return issues.length === 0
        ? { success: true, data }
        : { success: false, error: { issues } }
    },
  }
}

function parseField(v, spec, path) {
  // optional 包一层
  if (spec && spec.__optional) {
    if (v === undefined) return { ok: true, value: undefined }
    return parseField(v, spec.inner, path)
  }
  const label = path.join('.')
  switch (spec && spec.kind) {
    case 'string':
      if (typeof v !== 'string') return fail(label, '必须是字符串')
      if (spec.nonempty && v.trim() === '') return fail(label, '不能为空')
      return { ok: true, value: v }
    case 'enum':
      if (!spec.values.includes(v)) return fail(label, `必须是 ${spec.values.join('/')} 之一`)
      return { ok: true, value: v }
    case 'array':
      if (!Array.isArray(v)) return fail(label, '必须是数组')
      if (!v.every((x) => typeof x === 'string')) return fail(label, '数组元素必须是字符串')
      return { ok: true, value: [...v] }
    default:
      return fail(label, '未知字段类型')
  }
}

function fail(path, message) {
  return { ok: false, issues: [{ path: [path], message }] }
}

export const z = {
  string: (opts = {}) => ({ kind: 'string', nonempty: !!opts.nonempty }),
  enum: (values) => ({ kind: 'enum', values }),
  array: (item) => ({ kind: 'array', item }),
  optional: (inner) => ({ __optional: true, inner }),
  object: zObject,
}
