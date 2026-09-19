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

export async function saveTeacherOutput(output) {
  const config = supabaseConfig()
  if (!config) return false
  try {
    const payload = {
      input_hash: output.inputHash || '',
      output_hash: output.outputHash || '',
      task_types: output.taskTypes || [],
      provider: String(output.teacherId || output.provider || '').slice(0, 100),
      provider_model: String(output.teacherModel || '').slice(0, 200),
      message: String(output.message || '').slice(0, MAX_STORED_CHARS),
      output: String(output.text || '').slice(0, MAX_STORED_CHARS),
      tokens_prompt: output.usage?.prompt ?? null,
      tokens_completion: output.usage?.completion ?? null,
      latency_ms: output.latencyMs ?? null,
      quality_score: output.evaluation?.qualityScore ?? null,
      agreement_score: output.evaluation?.agreementScore ?? null,
      accepted: Boolean(output.evaluation?.accepted),
      reasons: output.evaluation?.reasons || [],
    }
    const response = await fetch(`${config.url}/rest/v1/teacher_outputs`, {
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

export async function saveTrainingExample({ message, best, taskTypes = [], datasetVersion = 'NADOS-DATASET-001' }) {
  const config = supabaseConfig()
  if (!config) return false
  try {
    const payload = {
      input_hash: best.inputHash,
      messages: [
        { role: 'user', content: String(message || '').slice(0, MAX_STORED_CHARS) },
        { role: 'assistant', content: String(best.text || '').slice(0, MAX_STORED_CHARS) },
      ],
      task_types: taskTypes,
      teacher_count: best.evaluation?.teacherCount || 1,
      teacher_models: [best.teacherModel].filter(Boolean),
      agreement_score: best.evaluation?.agreementScore ?? null,
      quality_score: best.evaluation?.qualityScore ?? null,
      dataset_version: datasetVersion,
    }
    const response = await fetch(`${config.url}/rest/v1/training_examples`, {
      method: 'POST',
      headers: { ...headers(config.key), Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(INSERT_TIMEOUT),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function getTrainingStats() {
  const config = supabaseConfig()
  if (!config) return { enabled: false }
  try {
    const [outputsRes, examplesRes] = await Promise.all([
      fetch(`${config.url}/rest/v1/teacher_outputs?select=accepted`, { headers: { Authorization: `Bearer ${config.key}`, apikey: config.key }, signal: AbortSignal.timeout(SELECT_TIMEOUT) }),
      fetch(`${config.url}/rest/v1/training_examples?select=id&order=created_at.desc&limit=200`, { headers: { Authorization: `Bearer ${config.key}`, apikey: config.key }, signal: AbortSignal.timeout(SELECT_TIMEOUT) }),
    ])
    const outputs = outputsRes.ok ? await outputsRes.json().catch(() => []) : []
    const examples = examplesRes.ok ? await examplesRes.json().catch(() => []) : []
    const accepted = Array.isArray(outputs) ? outputs.filter((item) => item.accepted).length : 0
    return {
      enabled: true,
      outputsTotal: Array.isArray(outputs) ? outputs.length : 0,
      outputsAccepted: accepted,
      examplesTotal: Array.isArray(examples) ? examples.length : 0,
    }
  } catch {
    return { enabled: false }
  }
}
