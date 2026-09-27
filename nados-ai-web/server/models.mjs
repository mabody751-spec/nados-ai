import { CHAT_DEFAULT_MODEL, nvidiaChatModels, nvidiaConfigured } from './nvidiaModels.mjs'
import { findRuntimeProvider } from './providerStore.mjs'

// Chat model picker. Entries with a providerId + model route through
// callSelectedProvider so a specific model can be chosen without creating a
// separate stored provider per model.
export function availableModels() {
  const models = []

  if (process.env.NADOS_LOCAL_LLM_URL?.trim() || process.env.KAGGLE_TRAINING_DONE === '1') {
    models.push({
      id: 'nados',
      label: 'Nados v1.1',
      providerId: 'nados',
      provider: 'Nados',
      model: 'المدرَّب + المعلمون — دمج تلقائي',
      webSearch: true,
      vision: true,
      files: true,
      contextWindow: 1_000_000,
      params: { trainable: 54_018_048, total: 9_295_724_032 },
    })
  }

  // Chat default: GPT-OSS 20B served by Groq (fast and reliable). NVIDIA hosts
  // the same model but does not answer on every account, so Groq is the route.
  if (process.env.GROQ_API_KEY?.trim()) {
    models.push({
      id: 'groq-gpt-oss-20b',
      label: 'GPT-OSS 20B · Groq',
      providerId: 'groq',
      provider: 'Groq',
      model: CHAT_DEFAULT_MODEL,
      webSearch: false,
      vision: false,
      files: false,
      recommended: true,
      chatDefault: true,
    })
    models.push({
      id: 'groq-compound-mini',
      label: 'Groq Compound Mini',
      providerId: 'groq',
      provider: 'Groq',
      model: process.env.GROQ_SEARCH_MODEL || 'groq/compound-mini',
      webSearch: true,
      vision: false,
      files: false,
    })
  }

  if (process.env.NVIDIA_API_KEY?.trim()) {
    models.push({
      id: 'nvidia-nemotron',
      label: 'NVIDIA Nemotron',
      providerId: 'nvidia',
      provider: 'NVIDIA NIM',
      model: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b',
      webSearch: false,
      vision: false,
      files: false,
    })
  }

  // Real NVIDIA catalog: only models proven to answer are listed, including GLM
  // 5.3 Flash (the primary Work model) so it is also selectable in chat.
  if (nvidiaConfigured()) {
    for (const entry of nvidiaChatModels({ limit: 12 })) {
      if (models.some((item) => item.id === entry.id)) continue
      models.push(entry)
    }
  }

  // Curated frontier models from connected providers, so the picker leads with
  // the strongest options instead of only small/fast ones.
  const curated = [
    { id: 'nvidia-glm-53', label: 'GLM 5.3 · NVIDIA', reasoning: true },
    { id: 'xkiro-qwen-38-max', label: 'Qwen 3.8 Max · Xkiro', reasoning: true },
    { id: 'xkiro-qwen-37-max', label: 'Qwen 3.7 Max · Xkiro', reasoning: true },
    { id: 'xkiro-minimax-m3-free', label: 'MiniMax M3 · Xkiro', reasoning: true },
  ]
  for (const item of curated) {
    const runtime = findRuntimeProvider(item.id)
    if (!runtime?.apiKey || runtime.enabled === false) continue
    if (models.some((entry) => entry.id === item.id)) continue
    models.push({
      id: item.id,
      label: item.label,
      providerId: item.id,
      provider: runtime.name,
      model: runtime.model,
      webSearch: false,
      vision: false,
      files: false,
    })
  }

  if (!models.some((item) => item.id === 'nados')) {
    models.unshift({
      id: 'nados',
      label: 'Nados v1.0',
      providerId: 'nados',
      provider: 'Nados',
      model: 'المعلمون — توجيه تلقائي',
      webSearch: true,
      vision: true,
      files: true,
      contextWindow: 1_000_000,
    })
  }

  return models
}

export function resolveModelSelection(id) {
  return availableModels().find((item) => item.id === id) || availableModels()[0]
}
