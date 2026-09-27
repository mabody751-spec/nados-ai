async function fetchJson(url, options, provider) {
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(120_000) })
      const body = await response.json().catch(() => null)
      if (response.ok) return body
      const detail = body?.error?.message || body?.errors?.[0]?.message || body?.message
      const error = new Error(`${provider}: ${detail || `HTTP ${response.status}`}`)
      error.status = response.status
      if (attempt === 0 && response.status >= 500) {
        lastError = error
        await new Promise((resolve) => setTimeout(resolve, 350))
        continue
      }
      throw error
    } catch (error) {
      lastError = error
      if (attempt === 0 && !Number(error.status)) {
        await new Promise((resolve) => setTimeout(resolve, 350))
        continue
      }
      throw error
    }
  }
  throw lastError
}

export { fetchJson }