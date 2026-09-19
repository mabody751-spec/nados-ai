export function modelPool(primary, configuredPool, defaults = []) {
  return [...new Set([
    String(primary || '').trim(),
    ...String(configuredPool || '').split(',').map((item) => item.trim()),
    ...defaults,
  ].filter(Boolean))]
}

export function isModelSelectionError(error) {
  const status = Number(error?.status || 0)
  return status === 400 || status === 403 || status === 404 || /model.*(not exist|not found|access|unavailable)/i.test(String(error?.message || ''))
}
