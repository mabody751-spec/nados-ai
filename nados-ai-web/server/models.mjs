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
