import { runtimeProviders } from './providerStore.mjs'

const providerConfig = {
  gemini: {
    environments: ['GEMINI_API_KEY', 'GEMINI_API_KEYS'],
    hosts: new Set(['generativelanguage.googleapis.com']),
  },
  groq: {
    environments: ['GROQ_API_KEY', 'GROQ_API_KEYS'],
    hosts: new Set(['api.groq.com']),
  },
  nvidia: {
    environments: ['NVIDIA_API_KEY', 'NVIDIA_API_KEYS'],
    hosts: new Set(['integrate.api.nvidia.com']),
  },
  huggingface: {
    environments: ['HUGGINGFACE_TOKEN', 'HUGGINGFACE_TOKENS'],
    hosts: new Set(['router.huggingface.co']),
  },
}

function providerHost(provider) {
  try {
    return new URL(provider.baseUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function providerApiKeys(providerId) {
  const config = providerConfig[providerId]
  if (!config) return []
  const values = [
    ...config.environments.flatMap((name) => String(process.env[name] || '').split(/[\s,;]+/)),
    ...runtimeProviders()
      .filter((provider) => config.hosts.has(providerHost(provider)))
      .map((provider) => provider.apiKey),
  ]
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
}

export function hasProviderApiKey(providerId) {
  return providerApiKeys(providerId).length > 0
}
