import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const providerCatalog = [
  { id: 'openai-api', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { id: 'openrouter-api', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free' },
  { id: 'huggingface-api', name: 'Hugging Face', baseUrl: 'https://router.huggingface.co/v1', model: 'meta-llama/Llama-3.1-8B-Instruct' },
  { id: 'mistral', name: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  { id: 'xai', name: 'xAI', baseUrl: 'https://api.x.ai/v1', model: 'grok-3-mini' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  { id: 'perplexity', name: 'Perplexity', baseUrl: 'https://api.perplexity.ai', model: 'sonar' },
  { id: 'fireworks', name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', model: 'accounts/fireworks/models/llama-v3p1-8b-instruct' },
  { id: 'cerebras', name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', model: 'llama3.1-8b' },
  { id: 'sambanova', name: 'SambaNova', baseUrl: 'https://api.sambanova.ai/v1', model: 'Meta-Llama-3.1-8B-Instruct' },
  { id: 'nvidia', name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.1-8b-instruct' },
  { id: 'siliconflow', name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
  { id: 'moonshot', name: 'Moonshot AI', baseUrl: 'https://api.moonshot.ai/v1', model: 'moonshot-v1-8k' },
  { id: 'qwen', name: 'Alibaba DashScope', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { id: 'zhipu', name: 'Zhipu AI', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { id: 'custom', name: 'Custom API', baseUrl: '', model: '' },
]

const root = dirname(fileURLToPath(import.meta.url))
const isTestRun = Boolean(process.env.NODE_TEST_CONTEXT) || process.env.NODE_ENV === 'test'
const storePath = isTestRun
  ? join(tmpdir(), `nados-providers-test-${process.pid}.json`)
  : join(root, '..', '.nados', 'providers.json')
let providers = load()

function load() {
  try {
    return existsSync(storePath) ? JSON.parse(readFileSync(storePath, 'utf8')) : []
  } catch {
    return []
  }
}

function persist() {
  mkdirSync(dirname(storePath), { recursive: true })
  writeFileSync(storePath, JSON.stringify(providers, null, 2), { encoding: 'utf8', mode: 0o600 })
}

export function runtimeProviders() {
  return providers.filter((provider) => provider.enabled !== false)
}

export function findRuntimeProvider(id) {
  return providers.find((provider) => provider.id === id)
}

export function publicRuntimeProviders() {
  return providers.map(({ apiKey: _apiKey, extraBody: _extraBody, ...provider }) => ({ ...provider, configured: Boolean(_apiKey), hasStoredKey: Boolean(_apiKey) }))
}

export function upsertRuntimeProvider(input) {
  const preset = providerCatalog.find((item) => item.id === input.presetId)
  if (!preset) throw Object.assign(new Error('المزوّد المحدد غير معروف.'), { status: 400 })
  const custom = preset.id === 'custom'
  const existingId = custom ? String(input.id || `custom-${Date.now()}`).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64) : preset.id
  const existing = findRuntimeProvider(existingId)
  const name = String(input.name || preset.name).trim().slice(0, 80)
  const baseUrl = String(custom ? input.baseUrl : preset.baseUrl).trim().replace(/\/$/, '')
  const model = String(input.model || preset.model).trim().slice(0, 200)
  const wireApi = input.wireApi === 'responses' ? 'responses' : 'chat-completions'
  const keyReuseAllowed = existing && baseUrl && (!existing.baseUrl || existing.baseUrl === baseUrl)
  const apiKey = String(input.apiKey || (keyReuseAllowed ? existing?.apiKey : '') || '').trim()
  if (!name || !model || !apiKey || !/^https:\/\//i.test(baseUrl)) throw Object.assign(new Error('الاسم والرابط الآمن والنموذج ومفتاح API مطلوبة.'), { status: 400 })
  const provider = { id: existingId, presetId: preset.id, name, baseUrl, model, wireApi, apiKey, enabled: input.enabled !== false, updatedAt: new Date().toISOString() }
  const extraBody = input.extraBody && typeof input.extraBody === 'object' && !Array.isArray(input.extraBody)
    ? input.extraBody
    : existing?.extraBody && typeof existing.extraBody === 'object' ? existing.extraBody : null
  if (extraBody) provider.extraBody = extraBody
  providers = [...providers.filter((item) => item.id !== existingId), provider]
  persist()
  return { ...provider, apiKey: undefined, configured: true, hasStoredKey: true }
}

export function removeRuntimeProvider(id) {
  const before = providers.length
  providers = providers.filter((provider) => provider.id !== id)
  if (providers.length !== before) persist()
  return providers.length !== before
}
