export type SearchMode = 'web' | 'research' | 'academic' | 'files' | 'create'
export type ModelId = string

export interface NadosModelOption {
  id: ModelId
  label: string
  providerId: string
  provider: string
  model: string
  webSearch: boolean
  vision: boolean
  files: boolean
}

export interface Source {
  title: string
  domain: string
  url: string
  accent: string
}

export interface ReplyUsage {
  prompt: number | null
  completion: number | null
  total: number | null
  contextWindow: number
}

export function formatTokens(value: number | null | undefined): string {
  if (!value || value <= 0) return ''
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  return `${Math.round(value / 1000)}K`
}

export interface ChatReply {
  answer: string[]
  bullets: string[]
  sources: Source[]
  responseId?: string
  provider?: string
  model?: string
  demo?: boolean
  stopped?: boolean
  usage?: ReplyUsage
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ApiCapabilities {
  ok: boolean
  configured: boolean
  provider: string
  model?: string
  orchestration?: { name: string; mode: 'parallel-first-success' | 'sequential-failover'; activeProviders: number }
  providers?: Array<{ id: string; name: string; configured: boolean }>
  features: {
    chat: boolean
    webSearch: boolean
    files: boolean
    vision: boolean
    video: boolean
    images: boolean
    transcription: boolean
    speech: boolean
    computer: boolean
  }
  computer?: { available: boolean; approvalRequired: boolean; sessionMinutes?: number; error?: string }
}

export interface ComputerWindow {
  id: string
  title: string
}

export type ComputerAction =
  | { action: 'click' | 'double_click'; x: number; y: number; description: string }
  | { action: 'type'; text: string; description: string }
  | { action: 'key'; key: string; description: string }
  | { action: 'scroll'; direction: 'up' | 'down'; amount: number; description: string }
  | { action: 'navigate_url'; url: string; description: string }
  | { action: 'finish'; description: string }

export interface ComputerPlan {
  planId: string | null
  action: ComputerAction
  provider: string
  requiresConfirmation: boolean
  screenshot: string | null
}

export interface ProviderPreset {
  id: string
  name: string
  baseUrl: string
  model: string
}

export interface ManagedProvider {
  id: string
  presetId: string
  name: string
  baseUrl: string
  model: string
  configured: boolean
  hasStoredKey: boolean
}

export async function getProviderManager() {
  const response = await fetch('/api/providers')
  if (!response.ok) throw new Error(await readError(response, 'تعذّر تحميل المزوّدات.'))
  return await response.json() as { catalog: ProviderPreset[]; providers: ApiCapabilities['providers']; managed: ManagedProvider[] }
}

export async function getNadosModels(): Promise<NadosModelOption[]> {
  try {
    const response = await fetch('/api/models', { signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error('Models request failed')
    const body = await response.json() as { models: NadosModelOption[] }
    return body.models?.length ? body.models : []
  } catch {
    return []
  }
}

export async function saveProvider(input: { presetId: string; id?: string; name?: string; baseUrl?: string; model: string; apiKey: string }) {
  const response = await fetch('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  if (!response.ok) throw new Error(await readError(response, 'تعذّر حفظ المزوّد.'))
  return await response.json()
}

export async function testManagedProvider(id: string) {
  const response = await fetch(`/api/providers/${encodeURIComponent(id)}/test`, { method: 'POST' })
  const body = await response.json() as { ok: boolean; preview?: string; error?: string }
  if (!response.ok || !body.ok) throw new Error(body.error || 'فشل الاختبار.')
  return body
}

export async function removeManagedProvider(id: string) {
  const response = await fetch(`/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!response.ok) throw new Error(await readError(response, 'تعذّر فصل المزوّد.'))
}

export interface TrainingTeacher {
  id: string
  name: string
  kind: string
  model: string
  capabilities: { contextWindow: number; maxOutput: number; longContext: boolean; reasoning: boolean; coding: boolean; vision: boolean; metered: boolean }
}

export interface TrainingCenterData {
  providers: TrainingTeacher[]
  trainingProvider: string
  supabase: { enabled: boolean; outputsTotal?: number; outputsAccepted?: number; examplesTotal?: number }
  scheduler: { enabled: boolean; intervalMs: number; lastRunAt: string | null; runs: number }
  usage: Record<string, { totalCalls: number; successCalls: number; failedCalls: number; errorRate: number; avgLatencyMs: number }> | null
  kaggle?: {
    state: string
    model?: { version: string; base: string; state: string; done: boolean }
    params?: { trainable: number | null; total: number | null; percent: number | null }
    progress?: { stepsDone: number | null; stepsTotal: number; gpu: string | null }
    dataset?: { examples: number; outputs: number; accepted: number }
  }
}

export async function getTrainingCenter(): Promise<TrainingCenterData | null> {
  try {
    const [registryRes, statsRes, usageRes, kaggleRes] = await Promise.all([
      fetch('/api/training/registry', { signal: AbortSignal.timeout(8000) }),
      fetch('/api/training/stats', { signal: AbortSignal.timeout(8000) }),
      fetch('/api/providers/stats', { signal: AbortSignal.timeout(8000) }),
      fetch('/api/training/kaggle/status', { signal: AbortSignal.timeout(240_000) }),
    ])
    if (!registryRes.ok || !statsRes.ok) return null
    const registry = await registryRes.json() as { providers: TrainingTeacher[]; trainingProvider: string }
    const stats = await statsRes.json() as { supabase: TrainingCenterData['supabase']; scheduler: TrainingCenterData['scheduler'] }
    const usage = usageRes.ok ? ((await usageRes.json() as { stats?: TrainingCenterData['usage'] }).stats || null) : null
    const kaggle = kaggleRes.ok ? ((await kaggleRes.json() as TrainingCenterData['kaggle']) || undefined) : undefined
    return {
      providers: registry.providers || [],
      trainingProvider: registry.trainingProvider,
      supabase: stats.supabase || { enabled: false },
      scheduler: stats.scheduler || { enabled: false, intervalMs: 0, lastRunAt: null, runs: 0 },
      usage,
      kaggle,
    }
  } catch {
    return null
  }
}

export async function generateTrainingData(message: string) {
  const response = await fetch('/api/training/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, mode: 'create' }) })
  if (!response.ok) throw new Error(await readError(response, 'فشل توليد بيانات التدريب.'))
  return await response.json() as { status: string; reason: string | null; teachers: string[]; persisted: number; best: { teacher: string; qualityScore: number; agreementScore: number | null; preview: string } | null; outputs: Array<{ teacher: string; ok: boolean; qualityScore: number | null; accepted: boolean; error: string | null }> }
}

const emptyFeatures = {
  chat: false,
  webSearch: false,
  files: false,
  vision: false,
  video: false,
  images: false,
  transcription: false,
  speech: false,
  computer: false,
}

export async function startComputerSession() {
  const response = await fetch('/api/computer/session', { method: 'POST' })
  if (!response.ok) throw new Error(await readError(response, 'تعذّر بدء جلسة الكمبيوتر.'))
  return await response.json() as { token: string; expiresAt: string; windows: ComputerWindow[] }
}

export async function closeComputerSession(token: string) {
  await fetch('/api/computer/session', { method: 'DELETE', headers: { 'x-nados-computer-token': token } }).catch(() => {})
}

export async function planComputerStep(token: string, windowId: string, task: string, previous: string[], providerId = 'auto', model = '', file?: File | null) {
  const form = new FormData()
  form.set('windowId', windowId)
  form.set('task', task)
  form.set('previous', JSON.stringify(previous))
  form.set('providerId', providerId)
  form.set('model', model)
  if (file) form.set('file', file, file.name)

  const response = await fetch('/api/computer/plan', {
    method: 'POST',
    headers: { 'x-nados-computer-token': token },
    body: form,
  })
  if (!response.ok) throw new Error(await readError(response, 'تعذّر تحليل الشاشة.'))
  return await response.json() as ComputerPlan
}

export async function executeComputerStep(token: string, planId: string) {
  const response = await fetch('/api/computer/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-nados-computer-token': token },
    body: JSON.stringify({ planId }),
  })
  if (!response.ok) throw new Error(await readError(response, 'تعذّر تنفيذ الإجراء.'))
  return await response.json() as { ok: boolean; action: string; description: string }
}

function fallbackReply(question: string, mode: SearchMode, serverConnected: boolean): ChatReply {
  const labels: Record<SearchMode, string> = {
    web: 'الويب',
    research: 'البحث العميق',
    academic: 'البحث الأكاديمي',
    files: 'الملفات',
    create: 'الإنشاء',
  }
  return {
    answer: serverConnected
      ? [
          `خادم Nados متصل، لكن تعذّر إكمال طلب «${question}» مؤقتاً.`,
          `أعد المحاولة لتفعيل ${labels[mode]} عبر أحد مزوّدي Nados المتصلين.`,
        ]
      : [
          `خادم Nados غير متصل حالياً. سؤالك هو: «${question}».`,
          `شغّل خدمة Nados لتشغيل وضع ${labels[mode]} بنتائج حقيقية.`,
        ],
    bullets: [],
    sources: [],
    demo: true,
  }
}

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json() as { error?: string }
    return body.error || fallback
  } catch {
    return fallback
  }
}

export async function getNadosCapabilities(): Promise<ApiCapabilities> {
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error('Health check failed')
    return await response.json() as ApiCapabilities
  } catch {
    return { ok: false, configured: false, provider: 'offline', providers: [], model: 'Nados v1.0', features: emptyFeatures }
  }
}

export async function askNados(
  question: string,
  mode: SearchMode,
  model: ModelId = 'nados-v1',
  files?: File[] | File | null,
  onDelta?: (text: string) => void,
  history: ConversationMessage[] = [],
  signal?: AbortSignal,
  onMeta?: (provider: string, modelLabel: string) => void,
): Promise<ChatReply> {
  const form = new FormData()
  form.set('message', question)
  form.set('mode', mode)
  form.set('model', model)
  if (history.length) form.set('history', JSON.stringify(history))
  const fileList = Array.isArray(files) ? files : files ? [files] : []
  for (const file of fileList) form.append('files', file, file.name)

  let streamedText = ''
  let finalReply: ChatReply | null = null

  try {
    const response = await fetch('/api/chat/stream', { method: 'POST', body: form, signal })
    if (!response.ok || !response.body) throw new Error(await readError(response, `HTTP ${response.status}`))

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    const handleEvent = (raw: string) => {
      const data = raw.split('\n').find((line) => line.startsWith('data: '))?.slice(6)
      if (!data) return
      const event = JSON.parse(data) as { type: string; delta?: string; reply?: ChatReply; message?: string; provider?: string; model?: string }
      if (event.type === 'delta' && event.delta) {
        streamedText += event.delta
        onDelta?.(streamedText)
      } else if (event.type === 'done' && event.reply) {
        finalReply = event.reply
        onMeta?.(finalReply.provider || '', finalReply.model || model)
      } else if (event.type === 'meta' && (event.provider || event.model)) {
        onMeta?.(event.provider || '', event.model || model)
      } else if (event.type === 'error') {
        throw new Error(event.message || 'تعذّر إكمال الإجابة.')
      }
    }

    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const events = buffer.split('\n\n')
      buffer = events.pop() || ''
      events.forEach(handleEvent)
      if (done) break
    }
    if (buffer.trim()) handleEvent(buffer)

    if (finalReply) return finalReply
    return {
      answer: [streamedText.trim() || 'لم تصل إجابة مكتملة من الخادم.'],
      bullets: [],
      sources: [],
      stopped: Boolean(signal?.aborted),
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { answer: [streamedText.trim() || 'تم إيقاف التوليد.'], bullets: [], sources: [], stopped: true }
    }
    const capabilities = await getNadosCapabilities()
    const reply = fallbackReply(question, mode, capabilities.ok && capabilities.configured)
    onDelta?.(reply.answer.join('\n\n'))
    return reply
  }
}

export async function generateNadosImage(prompt: string, style: string, ratio: 'square' | 'landscape' | 'portrait') {
  try {
    const response = await fetch('/api/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, style, ratio }),
    })
    if (!response.ok) throw new Error(await readError(response, 'تعذّر إنشاء الصورة.'))
    return await response.json() as { dataUrl: string | null; demo: boolean }
  } catch {
    return { dataUrl: null, demo: true }
  }
}

export async function transcribeNados(audio: Blob): Promise<string | null> {
  try {
    const extension = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm'
    const form = new FormData()
    form.set('audio', audio, `recording.${extension}`)
    const response = await fetch('/api/audio/transcribe', { method: 'POST', body: form })
    if (!response.ok) throw new Error(await readError(response, 'تعذّر تحويل الصوت إلى نص.'))
    const body = await response.json() as { text: string; demo: boolean }
    return body.text || null
  } catch {
    return null
  }
}

export async function synthesizeNadosSpeech(text: string): Promise<Blob | null> {
  try {
    const response = await fetch('/api/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 4096) }),
    })
    if (!response.ok) return null
    return await response.blob()
  } catch {
    return null
  }
}
