// 兼容 shim：唯一实现已移到 plugin/lib/adapter.js（阶段3A 第4方案）。
// 保留旧路径给 src/selftest.mjs、probe.mjs 与 wiring 用例使用，API 不变。
export * from '../plugin/lib/adapter.js'
