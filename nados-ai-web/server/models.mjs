export function availableModels() {
  const models = [{
    id: 'nados-v1',
    label: 'Nados v1.0',
    providerId: 'auto',
    provider: 'Nados',
    model: 'أفضل نموذج متاح — توجيه تلقائي',
    webSearch: true,
    vision: true,
    files: true,
  }]

  if (process.env.NADOS_LOCAL_LLM_URL?.trim() || process.env.KAGGLE_TRAINING_DONE === '1') {
    models.push({
      id: 'nados-v1-1',
      label: 'Nados v1.1',
      providerId: 'nados-local',
      provider: 'Nados',
      model: 'gemma-2-9b-it + LoRA Nados (QLoRA 120 steps)',
      webSearch: false,
      vision: false,
      files: false,
      params: { trainable: 54_018_048, total: 9_295_724_032 },
    })
  }

  if (process.env.GROQ_API_KEY?.trim()) {
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

  return models
}

export function resolveModelSelection(id) {
  return availableModels().find((item) => item.id === id) || availableModels()[0]
}
