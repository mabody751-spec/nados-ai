const INSERT_TIMEOUT = 10_000
const SELECT_TIMEOUT = 10_000
const MAX_STORED_CHARS = 20_000

function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '')
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
  if (!url || !key || !/^https:\/\/.+\.supabase\.co$/i.test(url)) return null
  return { url, key }
}

function headers(key) {
  return {
    Authorization: `Bearer ${key}`,
    apikey: key,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  }
}

export function supabaseEnabled() {
  return supabaseConfig() !== null
}

export async function saveConversation({ message, reply = '', mode = 'create', provider = '', sources = [] }) {
  const config = supabaseConfig()
  if (!config) return false
  try {
    const payload = {
      message: String(message || '').slice(0, MAX_STORED_CHARS),
      reply: String(Array.isArray(reply) ? reply.join('\n') : reply || '').slice(0, MAX_STORED_CHARS),
      mode,
      provider,
      sources_count: sources.length,
    }
    const response = await fetch(`${config.url}/rest/v1/conversations`, {
      method: 'POST',
      headers: headers(config.key),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(INSERT_TIMEOUT),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function getConversations(limit = 50) {
  const config = supabaseConfig()
  if (!config) return []
  try {
    const capped = Math.max(1, Math.min(200, Number(limit) || 50))
    const response = await fetch(`${config.url}/rest/v1/conversations?select=*&order=created_at.desc&limit=${capped}`, {
      headers: { Authorization: `Bearer ${config.key}`, apikey: config.key },
      signal: AbortSignal.timeout(SELECT_TIMEOUT),
    })
    if (!response.ok) return []
    const rows = await response.json().catch(() => null)
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}
