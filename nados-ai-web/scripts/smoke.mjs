// End-to-end smoke test for a deployed Nados backend (Phase 0).
// Usage: node scripts/smoke.mjs https://nados-api.example.com [proxyToken]
const base = (process.argv[2] || '').replace(/\/+$/, '')
const token = process.argv[3] || process.env.NADOS_PROXY_TOKEN || ''
if (!base) {
  console.error('الاستخدام: node scripts/smoke.mjs <baseUrl> [proxyToken]')
  process.exit(1)
}
const headers = token ? { 'x-nados-proxy-token': token } : {}
const results = []

async function check(name, fn) {
  const start = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true, ms: Date.now() - start, detail })
    console.log(`✅ ${name} (${Date.now() - start}ms) ${detail ?? ''}`)
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - start, detail: String(error.message || error) })
    console.log(`❌ ${name} — ${error.message || error}`)
  }
}

await check('healthz', async () => {
  const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(15000) })
  if (res.ok) { const body = await res.json(); return `status=${body.status}` }
  // A Cloudflare Worker base serves assets + /api only; fall back to /api/health.
  const api = await fetch(`${base}/api/health`, { headers, signal: AbortSignal.timeout(30000) })
  if (!api.ok) throw new Error(`HTTP ${api.status}`)
  const body = await api.json()
  return `via /api/health provider=${body.provider} configured=${body.configured}`
})

await check('readyz', async () => {
  const res = await fetch(`${base}/readyz`, { headers, signal: AbortSignal.timeout(15000) })
  if (res.status === 404) return 'n/a on this endpoint (server-only)'
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json().catch(() => ({}))
  return `status=${res.status} providers=${body.providers}`
})

await check('api/models', async () => {
  const res = await fetch(`${base}/api/models`, { headers, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json()
  return `models=${(body.models || []).length}`
})

await check('chat/stream (variant v1.1)', async () => {
  const boundary = `----smoke${Math.random().toString(16).slice(2)}`
  const parts = []
  for (const [k, v] of Object.entries({ message: 'قل: تم', mode: 'create', model: 'nados', variant: 'v1.1', history: '[]' })) {
    parts.push(`--${boundary}`, `Content-Disposition: form-data; name="${k}"`, '', v)
  }
  parts.push(`--${boundary}--`, '')
  const res = await fetch(`${base}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, ...headers },
    body: Buffer.from(parts.join('\r\n'), 'utf8'),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (!text.includes('"type":"done"')) throw new Error('no done event')
  const model = /"model":"([^"]+)"/.exec(text)?.[1] || 'nados'
  return `answered by ${model}`
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
