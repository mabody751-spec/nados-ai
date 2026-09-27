import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Deterministic fixtures: the module reads catalog/report from these paths, so
// no network access and no dependency on real probe state.
const dir = mkdtempSync(join(tmpdir(), 'nados-nvidia-test-'))
const catalogPath = join(dir, 'catalog.json')
const reportPath = join(dir, 'report.json')

writeFileSync(catalogPath, JSON.stringify({
  fetchedAt: new Date().toISOString(),
  count: 5,
  models: [
    { id: 'z-ai/glm-5.3-flash', family: 'z-ai', chat: true, vision: false, coding: true, reasoning: true },
    { id: 'openai/gpt-oss-20b', family: 'openai', chat: true, vision: false, coding: true, reasoning: true },
    { id: 'meta/llama-3.2-11b-vision-instruct', family: 'meta', chat: true, vision: true, coding: false, reasoning: false },
    { id: 'nvidia/nv-embedqa-mistral-7b-v2', family: 'nvidia', chat: false, vision: false, coding: false, reasoning: false },
    { id: 'meta/llama-guard-4-12b', family: 'meta', chat: false, vision: false, coding: false, reasoning: false },
  ],
}), 'utf8')

writeFileSync(reportPath, JSON.stringify({
  probedAt: new Date().toISOString(),
  total: 3,
  working: 2,
  failed: 1,
  failureKinds: { not_found: 1 },
  results: [
    { model: 'z-ai/glm-5.3-flash', ok: true, latencyMs: 42000, chat: true },
    { model: 'meta/llama-3.2-11b-vision-instruct', ok: true, latencyMs: 471, chat: true },
    { model: 'openai/gpt-oss-20b', ok: false, latencyMs: 75000, chat: true, errorKind: 'timeout', error: "Function 'x': Not found for account 'ev7DmhmbHDAZBYjV9hBDc' " },
  ],
}), 'utf8')

process.env.NADOS_NVIDIA_CATALOG_PATH = catalogPath
process.env.NADOS_NVIDIA_REPORT_PATH = reportPath

const nvidia = await import('./nvidiaModels.mjs')

test.after(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('classifies models and excludes non-chat entries', () => {
  assert.equal(nvidia.classifyNvidiaModel('z-ai/glm-5.3-flash').chat, true)
  assert.equal(nvidia.classifyNvidiaModel('meta/llama-3.2-11b-vision-instruct').vision, true)
  for (const id of ['nvidia/nv-embedqa-mistral-7b-v2', 'meta/llama-guard-4-12b', 'nvidia/nemotron-parse', 'nvidia/nvclip', 'snowflake/arctic-embed-l']) {
    assert.equal(nvidia.classifyNvidiaModel(id).chat, false, `${id} must not be a chat model`)
  }
})

test('classifies probe failures into actionable kinds', () => {
  assert.equal(nvidia.classifyProbeError({ status: 404, error: 'no model with the id' }), 'not_found')
  assert.equal(nvidia.classifyProbeError({ error: "has reached its end of life" }), 'eol')
  assert.equal(nvidia.classifyProbeError({ status: 429, error: 'rate limit' }), 'rate_limited')
  assert.equal(nvidia.classifyProbeError({ error: 'The operation was aborted due to timeout' }), 'timeout')
  assert.equal(nvidia.classifyProbeError({ status: 503, error: 'Service temporarily overloaded' }), 'server_error')
})

test('redacts the provider account id from errors', () => {
  const redacted = nvidia.redactAccountIds("Function '23bd454d': Not found for account 'ev7DmhmbHDAZBYjV9hBDc_-KRiuto9aZiPrVbAyTg_0'")
  assert.ok(!redacted.includes('ev7DmhmbHDAZBYjV9hBDc_-KRiuto9aZiPrVbAyTg_0'))
  assert.ok(redacted.includes("account '***'"))
})

test('offers only models proven to answer, with the requested order', () => {
  const models = nvidia.nvidiaChatModels()
  const ids = models.map((item) => item.model)
  assert.ok(ids.includes('z-ai/glm-5.3-flash'), 'work model must be offered')
  assert.ok(ids.includes('meta/llama-3.2-11b-vision-instruct'))
  assert.ok(!ids.includes('openai/gpt-oss-20b'), 'a timed-out model must not be offered')
  assert.equal(models[0].model, nvidia.WORK_DEFAULT_MODEL, 'GLM 5.3 Flash must rank first')
  assert.ok(models.every((item) => item.providerId === 'nvidia'))
})

test('work targets lead with GLM 5.3 Flash and only include working models', () => {
  const targets = nvidia.nvidiaWorkTargets()
  assert.equal(targets[0].providerId, 'nvidia')
  assert.equal(targets[0].model, 'z-ai/glm-5.3-flash')
  assert.ok(targets.every((target) => target.providerId === 'nvidia'))
  assert.ok(!targets.some((target) => target.model === 'nvidia/nv-embedqa-mistral-7b-v2'))
})

test('training teachers are the working models with provider routing metadata', () => {
  const teachers = nvidia.nvidiaTeacherEntries()
  assert.ok(teachers.length >= 2)
  assert.ok(teachers.every((teacher) => teacher.providerId === 'nvidia' && teacher.catalog === true && teacher.model))
  assert.ok(teachers.some((teacher) => teacher.model === 'z-ai/glm-5.3-flash'))
})

test('catalog summary reports real counts and failure kinds', () => {
  const summary = nvidia.nvidiaCatalogSummary()
  assert.equal(summary.count, 5)
  assert.equal(summary.chatCount, 3)
  assert.equal(summary.probed.total, 3)
  assert.equal(summary.probed.failureKinds.not_found, 1)
  assert.equal(summary.workDefaultModel, 'z-ai/glm-5.3-flash')
})
