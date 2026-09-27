import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findRuntimeProvider, runtimeProviders } from './providerStore.mjs'

// Real NVIDIA NIM catalog: models are fetched from the provider, classified by
// family, and probed with an actual chat completion before being offered.

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'
const CATALOG_TTL_MS = Number(process.env.NADOS_NVIDIA_CATALOG_TTL_MS) || 24 * 60 * 60 * 1000

const root = dirname(fileURLToPath(import.meta.url))
const storeDir = join(root, '..', '.nados')
const isTestRun = Boolean(process.env.NODE_TEST_CONTEXT) || process.env.NODE_ENV === 'test'
// Paths are overridable so tests stay deterministic and never touch real state.
const catalogPath = process.env.NADOS_NVIDIA_CATALOG_PATH || (isTestRun ? join(tmpdir(), `nados-nvidia-catalog-test-${process.pid}.json`) : join(storeDir, 'nvidia-models.json'))
const reportPath = process.env.NADOS_NVIDIA_REPORT_PATH || (isTestRun ? join(tmpdir(), `nados-nvidia-report-test-${process.pid}.json`) : join(storeDir, 'nvidia-model-report.json'))

export const WORK_DEFAULT_MODEL = String(process.env.NADOS_WORK_MODEL || 'z-ai/glm-5.3-flash').trim()
export const CHAT_DEFAULT_MODEL = String(process.env.NADOS_CHAT_MODEL || 'openai/gpt-oss-20b').trim()
// Proven to answer on this provider from live probes. Used as an ordered
// fallback so Work still targets real models before a probe report exists.
export const NVIDIA_KNOWN_WORKING = [
  'z-ai/glm-5.3-flash',
  'deepseek-ai/deepseek-v4.1-flash',
  'meta/muse-glimmer-30b',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'poolside/laguna-xs-2.1',
  'meta/llama-3.2-11b-vision-instruct',
]

// NVIDIA error text includes the account identifier; never surface it to the
// model or the UI.
export function redactAccountIds(value) {
  return String(value ?? '')
    .replace(/account '[^']*'/gi, "account '***'")
    .replace(/\b[A-Za-z0-9_-]{28,}\b/g, '***')
}

export function nvidiaApiKey() {
  const fromEnv = String(process.env.NVIDIA_API_KEY || '').trim()
  if (fromEnv) return fromEnv
  const runtime = findRuntimeProvider('nvidia') || runtimeProviders().find((provider) => provider.presetId === 'nvidia')
  return runtime?.apiKey ? String(runtime.apiKey).trim() : ''
}

export function nvidiaConfigured() {
  return Boolean(nvidiaApiKey())
}

// Embedding / vision-only / safety / reward / translation models are not usable
// as chat, work or teacher models.
const NON_CHAT_PATTERNS = [
  /embed/i, /clip/i, /guard/i, /safety/i, /reward/i, /parse/i, /deplot/i, /kosmos/i,
  /neva/i, /vila/i, /fuyu/i, /detector/i, /riva-translate/i, /ising-calibration/i,
  /nemoretriever/i, /cosmos/i, /calibration/i, /omni/i, /nemoguard/i,
]

export function classifyNvidiaModel(id) {
  const model = String(id || '')
  const family = model.split('/')[0] || 'other'
  const nonChat = NON_CHAT_PATTERNS.some((pattern) => pattern.test(model))
  const vision = /vision|(^|\/)vl[-_]|vlm|gemma-3|gemma-4|phi-3-vision|llama-3\.2-\d+b-vision/i.test(model)
  const coding = /code|coder|starcoder|granite.*code|devstral|laguna/i.test(model)
  const reasoning = /deepseek|glm|nemotron|reason|gpt-oss|qwen|kimi|mistral-large|dbrx|jamba|palmyra|zamba|arctic|yi-large|mixtral/i.test(model)
  const chat = !nonChat && !/embed/i.test(model)
  return { id: model, family, chat, vision, coding, reasoning }
}

// Parse each JSON file once and reuse it until the file changes. The catalog and
// probe report sit on the hot chat path (resolveModelSelection), so re-reading
// and re-parsing ~37 KB synchronously per request is avoided without giving up
// cross-process freshness.
const JSON_CACHE = new Map()

function readJson(path) {
  try {
    if (!existsSync(path)) { JSON_CACHE.delete(path); return null }
    const mtimeMs = statSync(path).mtimeMs
    const cached = JSON_CACHE.get(path)
    if (cached && cached.mtimeMs === mtimeMs) return cached.value
    const value = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
    JSON_CACHE.set(path, { mtimeMs, value })
    return value
  } catch {
    return null
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
}

export function nvidiaProbeReport() {
  return readJson(reportPath)
}

export function cachedNvidiaCatalog() {
  return readJson(catalogPath)
}

export async function fetchNvidiaCatalog({ force = false } = {}) {
  const cached = cachedNvidiaCatalog()
  if (!force && cached?.models?.length && Date.now() - Date.parse(cached.fetchedAt || 0) < CATALOG_TTL_MS) {
    return { ...cached, source: 'cache' }
  }
  const apiKey = nvidiaApiKey()
  if (!apiKey) throw Object.assign(new Error('NVIDIA: لا يوجد مفتاح API مهيأ.'), { status: 400 })
  const response = await fetch(`${NVIDIA_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`NVIDIA: تعذّر جلب قائمة النماذج (HTTP ${response.status}).`)
  const payload = await response.json().catch(() => ({}))
  const models = (Array.isArray(payload?.data) ? payload.data : [])
    .map((entry) => classifyNvidiaModel(entry?.id))
    .filter((entry) => entry.id)
    .sort((a, b) => a.id.localeCompare(b.id))
  const catalog = { fetchedAt: new Date().toISOString(), count: models.length, models }
  writeJson(catalogPath, catalog)
  return { ...catalog, source: 'live' }
}

export function classifyProbeError({ status = 0, error = '' } = {}) {
  const detail = String(error || '')
  if (/end of life|no longer available|has reached its end/i.test(detail)) return 'eol'
  if (status === 404 || /no model with the id|model not found|unknown model|not found/i.test(detail)) return 'not_found'
  if (status === 429 || /rate limit|too many requests|quota exceeded/i.test(detail)) return 'rate_limited'
  if (status === 402 || /\bcredit\b|payment|billing/i.test(detail)) return 'quota'
  if (status === 401 || status === 403) return 'auth'
  if (/aborted|timeout|timed out|ECONNRESET|fetch failed/i.test(detail)) return 'timeout'
  if (status >= 500) return 'server_error'
  return 'error'
}

export async function probeNvidiaModel(model, { timeoutMs = 75_000 } = {}) {
  const apiKey = nvidiaApiKey()
  if (!apiKey) return { model, ok: false, error: 'NVIDIA: لا يوجد مفتاح API مهيأ.', errorKind: 'auth' }
  const started = Date.now()
  try {
    const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
        max_tokens: 64,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    let body = null
    try { body = text ? JSON.parse(text) : null } catch {}
    const message = body?.choices?.[0]?.message || {}
    const output = String(message.content ?? message.reasoning_content ?? '').trim()
    if (!response.ok) {
      const detail = redactAccountIds(String(body?.detail || body?.error?.message || body?.message || text || '')).slice(0, 200)
      const error = detail || `HTTP ${response.status}`
      return { model, ok: false, status: response.status, latencyMs: Date.now() - started, error, errorKind: classifyProbeError({ status: response.status, error }) }
    }
    return {
      model,
      ok: Boolean(output),
      status: response.status,
      latencyMs: Date.now() - started,
      preview: output.slice(0, 60),
      error: output ? null : 'رد فارغ من النموذج',
      errorKind: output ? null : 'empty',
    }
  } catch (error) {
    const detail = String(error?.message || error).slice(0, 200)
    return { model, ok: false, latencyMs: Date.now() - started, error: detail, errorKind: classifyProbeError({ error: detail }) }
  }
}

async function runProbePool(entries, { concurrency, timeoutMs, onProgress, results, label }) {
  const queue = [...entries]
  let done = results.length
  const total = done + queue.length
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length || 1)) }, async () => {
    while (queue.length) {
      const entry = queue.shift()
      if (!entry) break
      const result = await probeNvidiaModel(entry.id, { timeoutMs })
      results.push({ ...entry, ...result })
      done += 1
      if (onProgress) onProgress({ done, total, model: entry.id, ok: result.ok, label })
    }
  })
  await Promise.all(workers)
}

export async function probeNvidiaCatalog({ models = null, concurrency = 6, timeoutMs = 75_000, retryTimeoutMs = 150_000, onProgress = null, persist = true } = {}) {
  const catalog = models ? { models } : await fetchNvidiaCatalog()
  const targets = (catalog.models || []).filter((entry) => entry.chat)
  const results = []
  // Pass 1: everything in parallel.
  await runProbePool(targets, { concurrency, timeoutMs, onProgress, results, label: 'pass1' })
  // Pass 2: retry the cold-start/timeout cases with a longer deadline, since
  // first-touch NVIDIA models can take ~30-60s to answer.
  const timedOut = results.filter((item) => !item.ok && item.errorKind === 'timeout')
  if (timedOut.length) {
    const retryIds = new Set(timedOut.map((item) => item.model))
    for (let index = results.length - 1; index >= 0; index -= 1) {
      if (retryIds.has(results[index].model)) results.splice(index, 1)
    }
    await runProbePool(targets.filter((entry) => retryIds.has(entry.id)), { concurrency: Math.min(concurrency, 4), timeoutMs: retryTimeoutMs, onProgress, results, label: 'retry' })
  }
  results.sort((a, b) => a.model.localeCompare(b.model))
  const byKind = {}
  for (const item of results) {
    if (item.ok) continue
    const kind = item.errorKind || 'error'
    byKind[kind] = (byKind[kind] || 0) + 1
  }
  const report = {
    probedAt: new Date().toISOString(),
    baseUrl: NVIDIA_BASE_URL,
    total: results.length,
    working: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    failureKinds: byKind,
    workDefaultModel: WORK_DEFAULT_MODEL,
    chatDefaultModel: CHAT_DEFAULT_MODEL,
    results,
  }
  if (persist) writeJson(reportPath, report)
  return report
}

// Chat picker entries: only models proven to answer are offered, so the picker
// cannot list a model that the account cannot call.
export function nvidiaChatModels({ limit = 24, includeUnprobed = false } = {}) {
  const catalog = cachedNvidiaCatalog()
  const report = nvidiaProbeReport()
  const byId = new Map((report?.results || []).map((item) => [item.model, item]))
  const source = catalog?.models?.length ? catalog.models : NVIDIA_KNOWN_WORKING.map((id) => classifyNvidiaModel(id))
  const chatModels = source.filter((entry) => entry.chat)
  const usable = chatModels.filter((entry) => {
    const probed = byId.get(entry.id)
    if (probed) return probed.ok
    if (!includeUnprobed) return NVIDIA_KNOWN_WORKING.includes(entry.id)
    return true
  })
  const rank = (entry) => {
    if (entry.id === CHAT_DEFAULT_MODEL) return 0
    if (entry.id === WORK_DEFAULT_MODEL) return 1
    const probed = byId.get(entry.id)
    const latency = probed?.latencyMs || 6000
    return 10 + latency / 1000 + (entry.reasoning || entry.coding ? 0 : 5)
  }
  return usable
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, limit)
    .map((entry) => ({
      id: `nvidia-${entry.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
      label: `NVIDIA · ${entry.id.split('/').pop()}`,
      providerId: 'nvidia',
      provider: 'NVIDIA NIM',
      model: entry.id,
      webSearch: false,
      vision: Boolean(entry.vision),
      files: Boolean(entry.vision),
      recommended: entry.id === WORK_DEFAULT_MODEL,
      probedOk: byId.get(entry.id)?.ok ?? null,
      latencyMs: byId.get(entry.id)?.latencyMs ?? null,
    }))
}

// Work targets are tried in order; the configured default model leads so the
// primary Work model is deterministic while failover stays intact.
export function nvidiaWorkTargets({ limit = 8 } = {}) {
  const report = nvidiaProbeReport()
  const working = (report?.results || []).filter((item) => item.ok && item.chat).map((item) => item.model)
  const ordered = []
  for (const model of [WORK_DEFAULT_MODEL, ...NVIDIA_KNOWN_WORKING, ...working, 'z-ai/glm-5.3']) {
    if (model && !ordered.includes(model)) ordered.push(model)
  }
  return ordered.slice(0, limit).map((model) => ({ providerId: 'nvidia', model }))
}

export function nvidiaCatalogSummary() {
  const catalog = cachedNvidiaCatalog()
  const report = nvidiaProbeReport()
  const families = {}
  for (const entry of catalog?.models || []) families[entry.family] = (families[entry.family] || 0) + 1
  return {
    configured: nvidiaConfigured(),
    fetchedAt: catalog?.fetchedAt || null,
    count: catalog?.count || 0,
    chatCount: (catalog?.models || []).filter((entry) => entry.chat).length,
    families,
    probed: report ? { at: report.probedAt, total: report.total, working: report.working, failed: report.failed, failureKinds: report.failureKinds || {} } : null,
    workDefaultModel: WORK_DEFAULT_MODEL,
    chatDefaultModel: CHAT_DEFAULT_MODEL,
    workingModels: (report?.results || []).filter((item) => item.ok).map((item) => item.model),
    knownWorkingModels: NVIDIA_KNOWN_WORKING,
  }
}

// Working NVIDIA models exposed as training teachers. Each teacher carries its
// providerId + model so swarm learning routes through callProvider overrides.
export function nvidiaTeacherEntries() {
  const report = nvidiaProbeReport()
  const probed = (report?.results || []).filter((item) => item.ok && item.chat)
  const source = probed.length ? probed.map((item) => item.model) : NVIDIA_KNOWN_WORKING
  return source.map((model) => ({
    id: `nvidia::${model.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `NVIDIA · ${model.split('/').pop()}`,
    providerId: 'nvidia',
    model,
    catalog: true,
  }))
}
