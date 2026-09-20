import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import OpenAI, { toFile } from 'openai'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callExternalProviders, callSelectedProvider, hasExternalProvider, providerStatuses, testProvider, initializeAllProviders, getProviderCapabilities, getAllProvidersHealth, getProviderHealth, getProviderStats, recordProviderResult, resetProviderStats } from './providers.mjs'
import { MAX_CONVERSATION_BYTES, validateConversationHistory, validateMessageText } from './limits.mjs'
import { generateImageWithProviders, synthesizeWithGemini, transcribeWithGroq } from './mediaProviders.mjs'
import { hasProviderApiKey } from './providerKeys.mjs'
import { providerCatalog, publicRuntimeProviders, removeRuntimeProvider, upsertRuntimeProvider } from './providerStore.mjs'
import { closeComputerSession, computerStatus, executeComputerStep, openComputerSession, planComputerStep } from './computer.mjs'
import { capabilityReply, effectiveProviderMode, identityReply, isNadosCapabilityQuestion, isNadosIdentityQuestion, modeInstructions } from './instructions.mjs'
import { availableModels, resolveModelSelection } from './models.mjs'
import { getConversations, getTrainingStats, saveConversation, saveTeacherOutput, saveTrainingExample, supabaseEnabled } from './supabaseStore.mjs'
import { buildProviderRegistry, swarmLearn, newTrainingJob, TRAINING_PROVIDER_STATE } from './training/engine.mjs'
import { callProvider } from './providers.mjs'
import { exportDatasetFromSupabase, kaggleEnabled, kernelLiveState, kernelStatus, pullKernelOutput, pushDataset, pushTrainingKernel, verifyKaggleCredentials } from './training/kaggleBridge.mjs'

const app = express()
const port = Number(process.env.PORT || 8787)
const apiKey = process.env.OPENAI_API_KEY?.trim()
const openai = apiKey
  ? new OpenAI({ apiKey, timeout: 120_000, maxRetries: 2 })
  : null

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, fieldSize: MAX_CONVERSATION_BYTES, files: 5 },
})

const allowedModes = new Set(['web', 'research', 'academic', 'files', 'create'])
const sourceColors = ['#35b8a9', '#eb654b', '#f5c95d', '#5c8cd5']

app.disable('x-powered-by')
app.use((_, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})
app.use(express.json({ limit: '256kb' }))

function modelFor(mode, file) {
  if (file?.mimetype?.startsWith('image/') || mode === 'files') {
    return process.env.NADOS_V1_VISION_MODEL || process.env.OPENAI_VISION_MODEL || 'gpt-4.1'
  }
  if (mode === 'research' || mode === 'academic' || mode === 'create') {
    return process.env.NADOS_V1_REASONING_MODEL || process.env.OPENAI_GPT_MODEL || 'gpt-5'
  }
  return process.env.NADOS_V1_FAST_MODEL || process.env.OPENAI_MODEL || 'gpt-5-mini'
}

function toolsFor(mode) {
  return ['web', 'research', 'academic'].includes(mode) ? [{ type: 'web_search' }] : []
}

function extractSources(response) {
  const seen = new Set()
  const sources = []
  for (const item of response?.output || []) {
    if (item.type !== 'message') continue
    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) {
        const citation = annotation.type === 'url_citation' ? annotation : annotation.url_citation
        const url = citation?.url
        if (!url || seen.has(url)) continue
        seen.add(url)
        let domain = url
        try { domain = new URL(url).hostname.replace(/^www\./, '') } catch {}
        sources.push({
          title: citation.title || domain,
          domain,
          url,
          accent: sourceColors[sources.length % sourceColors.length],
        })
      }
    }
  }
  return sources.slice(0, 12)
}

function decorateSources(items) {
  const seen = new Set()
  return (items || []).filter((item) => {
    if (!item?.url || seen.has(item.url)) return false
    seen.add(item.url)
    return true
  }).slice(0, 12).map((item, index) => {
    let domain = item.url
    try { domain = new URL(item.url).hostname.replace(/^www\./, '') } catch {}
    return { title: item.title || domain, domain, url: item.url, accent: sourceColors[index % sourceColors.length] }
  })
}

function splitAnswer(text) {
  const answer = []
  const bullets = []
  for (const block of text.trim().split(/\n{2,}/)) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    const bulletLines = lines.filter((line) => /^[-*•]\s+/.test(line))
    if (bulletLines.length === lines.length) {
      bullets.push(...bulletLines.map((line) => line.replace(/^[-*•]\s+/, '')))
    } else {
      answer.push(lines.join('\n').replace(/^#{1,6}\s+/, ''))
    }
  }
  return { answer: answer.length ? answer : [text.trim()], bullets }
}

function fallbackReply(question, mode) {
  const labels = { web: 'الويب', research: 'البحث العميق', academic: 'البحث الأكاديمي', files: 'الملفات', create: 'الإنشاء' }
  return {
    answer: [
      `الوضع التجريبي يعمل الآن، لكن خدمة الذكاء الاصطناعي غير متصلة بعد. سؤالك هو: «${question}».`,
      `شغّل خدمة Nados وفعّل الاتصال لتفعيل وضع ${labels[mode]}.`,
    ],
    bullets: [],
    sources: [],
    demo: true,
  }
}

function validateChat(body) {
  const message = validateMessageText(body.message)
  const history = validateConversationHistory(body.history, message)
  const mode = allowedModes.has(body.mode) ? body.mode : 'web'
  const model = resolveModelSelection(String(body.model || 'nados-v1')).id
  return { message, mode, model, history }
}

async function buildInput(message, file, history = []) {
  const content = [{ type: 'input_text', text: message }]
  let uploadedFileId = null

  if (file) {
    if (file.mimetype.startsWith('image/')) {
      content.push({
        type: 'input_image',
        image_url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
      })
    } else {
      const uploaded = await openai.files.create({
        file: await toFile(file.buffer, file.originalname, { type: file.mimetype || 'application/octet-stream' }),
        purpose: 'user_data',
      })
      uploadedFileId = uploaded.id
      content.push({ type: 'input_file', file_id: uploaded.id })
    }
  }

  const previous = history.map((item) => ({
    role: item.role,
    content: [{ type: item.role === 'assistant' ? 'output_text' : 'input_text', text: item.content }],
  }))
  return { input: [...previous, { role: 'user', content }], uploadedFileId }
}

function sendEvent(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function sendCompletedReply(response, reply, message = '') {
  for (const part of [...reply.answer, ...reply.bullets.map((item) => `- ${item}`)]) {
    sendEvent(response, { type: 'delta', delta: `${part}\n\n` })
  }
  sendEvent(response, { type: 'meta', provider: 'nados' })
  sendEvent(response, { type: 'done', reply })
  response.end()
  saveConversation({ message, reply: reply.answer, mode: 'create', provider: reply.provider, sources: reply.sources || [] })
}

app.get('/api/health', async (request, response) => {
  const providers = providerStatuses()
  const connected = providers.filter((item) => item.configured)
  const connectedIds = new Set(connected.map((item) => item.id))
  const computer = await computerStatus()
  const visionProviderAvailable = connectedIds.has('gemini') || connectedIds.has('openai') || (connectedIds.has('openrouter') && Boolean(process.env.OPENROUTER_VISION_MODEL)) || (connectedIds.has('nvidia') && Boolean(process.env.NVIDIA_VISION_MODEL))
  const local = isLocalRequest(request)
  const providersHealth = local ? await getAllProvidersHealth() : []
  response.json({
    ok: true,
    configured: connected.length > 0,
    provider: 'nados',
    providers: local ? providers : [],
    model: 'Nados v1.0',
    providersStatus: local ? {
      initialized: providersHealth.filter(h => h.status === 'ready').map(h => ({
        id: h.id,
        name: connected.find(c => c.id === h.id)?.name || h.id,
        status: 'ready',
        latencyMs: h.latencyMs,
        model: h.model,
      })),
      failed: providersHealth.filter(h => h.status === 'error').map(h => ({
        id: h.id,
        name: connected.find(c => c.id === h.id)?.name || h.id,
        status: 'error',
        error: h.error,
      })),
      summary: {
        total: connected.length,
        ready: providersHealth.filter(h => h.status === 'ready').length,
        failed: providersHealth.filter(h => h.status === 'error').length,
      },
    } : { initialized: [], failed: [], summary: { total: 0, ready: 0, failed: 0 } },
    orchestration: {
      name: 'Nados v1.0',
      mode: process.env.NADOS_PROVIDER_MODE === 'sequential' ? 'sequential-failover' : 'parallel-first-success',
      activeProviders: local ? connected.length : undefined,
    },
    features: {
      chat: connected.length > 0,
      webSearch: connectedIds.has('gemini') || connectedIds.has('groq') || connectedIds.has('openai'),
      files: connectedIds.has('gemini') || connectedIds.has('openai'),
      vision: visionProviderAvailable,
      video: connectedIds.has('gemini'),
      images: Boolean(openai || hasProviderApiKey('gemini') || hasProviderApiKey('huggingface')),
      transcription: Boolean(openai || hasProviderApiKey('groq')),
      speech: Boolean(openai || hasProviderApiKey('gemini')),
      computer: computer.available && visionProviderAvailable,
      providersInit: true,
    },
    computer,
  })
})

app.get('/api/providers/health', requireLocalOrigin, async (_, response) => {
  try {
    const health = await getAllProvidersHealth()
    response.json({ health })
  } catch (error) {
    response.status(500).json({ error: error.message || 'فشل فحص المزودين.' })
  }
})

app.get('/api/providers/health/:id', requireLocalOrigin, async (request, response) => {
  try {
    const health = await getProviderHealth(request.params.id)
    response.json(health)
  } catch (error) {
    response.status(500).json({ error: error.message || 'فشل فحص المزود.' })
  }
})

app.get('/api/providers/stats', requireLocalOrigin, (_, response) => {
  response.json({ stats: getProviderStats() })
})

app.get('/api/conversations', requireLocalOrigin, async (request, response) => {
  if (!supabaseEnabled()) return response.json({ enabled: false, conversations: [] })
  const conversations = await getConversations(request.query.limit)
  response.json({ enabled: true, conversations })
})

app.get('/api/training/registry', requireLocalOrigin, (_request, response) => {
  response.json({ providers: buildProviderRegistry(), trainingProvider: TRAINING_PROVIDER_STATE })
})

app.post('/api/training/generate', requireLocalOrigin, async (request, response) => {
  try {
    const { message, mode, instructions } = request.body || {}
    if (!message?.trim()) return response.status(400).json({ error: 'رسالة المهمة مطلوبة.' })
    const result = await swarmLearn({ callProvider, message, mode: mode || 'create', instructions: instructions || modeInstructions(mode || 'create', {}) })
    const persistResults = await Promise.all([
      ...(result.outputs || []).filter((item) => item.ok).map((item) => saveTeacherOutput({ ...item, message })),
      result.best ? saveTrainingExample({ message, best: result.best, taskTypes: result.taskTypes }) : Promise.resolve(false),
    ])
    response.json({
      status: result.status,
      reason: result.reason || null,
      taskTypes: result.taskTypes,
      teachers: result.teachers,
      persisted: persistResults.filter(Boolean).length,
      best: result.best ? {
        teacher: result.best.teacherId,
        model: result.best.teacherModel,
        qualityScore: result.best.evaluation?.qualityScore,
        agreementScore: result.best.evaluation?.agreementScore,
        preview: result.best.text?.slice(0, 200),
      } : null,
      outputs: result.outputs.map((item) => ({
        teacher: item.teacherId,
        ok: item.ok,
        qualityScore: item.evaluation?.qualityScore ?? null,
        accepted: item.evaluation?.accepted ?? false,
        error: item.error || null,
      })),
    })
  } catch (error) {
    response.status(500).json({ error: error.message || 'فشل توليد بيانات التدريب.' })
  }
})

app.post('/api/training/queue', requireLocalOrigin, (request, response) => {
  const job = newTrainingJob(request.body || {})
  response.status(202).json({ queued: true, job })
})

app.get('/api/training/kaggle/status', requireLocalOrigin, async (_request, response) => {
  const enabled = kaggleEnabled()
  if (!enabled) return response.json({ enabled: false, state: 'WAITING_FOR_CREDENTIALS', reason: 'يلزم اسم المستخدم ومفتاح Kaggle API (kaggle.com → Settings → API).' })
  try {
    const verification = await verifyKaggleCredentials()
    if (!verification.ok) return response.json({ enabled: true, state: 'INVALID_CREDENTIALS', reason: verification.error })
    const live = await kernelLiveState()
    const stats = await getTrainingStats()
    response.json({
      enabled: true,
      state: live.state,
      model: { version: 'Nados v1.1', base: 'gemma-2-9b (QLoRA)', state: live.state, done: live.done },
      params: { trainable: live.paramsTrainable, total: live.paramsTotal, percent: live.paramsPercent },
      progress: { stepsDone: live.stepsDone, stepsTotal: live.stepsTotal, gpu: live.gpu },
      dataset: { examples: stats.examplesTotal, outputs: stats.outputsTotal, accepted: stats.outputsAccepted },
      scheduler: { enabled: schedulerEnabled, intervalMs: schedulerIntervalMs, runs: schedulerRuns, lastRunAt: schedulerLastRun },
      logTail: live.logTail,
      kernel: live,
    })
  } catch (error) {
    response.status(502).json({ enabled: true, state: 'ERROR', reason: error.message || 'فشل الاتصال بـ Kaggle.' })
  }
})

app.post('/api/training/kaggle/train', requireLocalOrigin, async (_request, response) => {
  if (!kaggleEnabled()) return response.status(400).json({ error: 'KAGGLE_WAITING_FOR_CREDENTIALS: يلزم اسم المستخدم ومفتاح Kaggle API في .env.' })
  try {
    const dataset = await exportDatasetFromSupabase()
    if (!dataset.count) return response.status(400).json({ error: 'لا توجد أمثلة تدريب كافية في Supabase بعد — شغّل دورات توليد أولاً.' })
    const pushed = await pushDataset(dataset.jsonl)
    const kernel = await pushTrainingKernel()
    response.status(202).json({ started: true, dataset: { ref: pushed.ref, examples: dataset.count }, kernel })
  } catch (error) {
    response.status(502).json({ error: error.message || 'فشل بدء التدريب على Kaggle.' })
  }
})

app.get('/api/training/kaggle/output', requireLocalOrigin, async (_request, response) => {
  if (!kaggleEnabled()) return response.status(400).json({ error: 'KAGGLE_WAITING_FOR_CREDENTIALS.' })
  try {
    const output = await pullKernelOutput()
    response.json(output)
  } catch (error) {
    response.status(502).json({ error: error.message || 'فشل جلب مخرجات التدريب.' })
  }
})

app.get('/api/training/stats', requireLocalOrigin, async (_request, response) => {
  const supabase = await getTrainingStats()
  response.json({
    supabase,
    trainingProvider: TRAINING_PROVIDER_STATE,
    scheduler: { enabled: schedulerEnabled, intervalMs: schedulerIntervalMs, lastRunAt: schedulerLastRun, runs: schedulerRuns },
  })
})

const trainingTopics = [
  { topic: 'الاختبارات الآلية في البرمجة', domain: 'programming' },
  { topic: 'تنظيف مدخلات المستخدم من الحقن', domain: 'security' },
  { topic: 'الفروق بين أنواع قواعد البيانات', domain: 'databases' },
  { topic: 'مكونات React لإدارة الحالة', domain: 'frontend' },
  { topic: 'تحسين أداء تطبيقات الويب', domain: 'performance' },
  { topic: 'الوعود والبرمجة غير المتزامنة', domain: 'async' },
  { topic: 'استعلامات SQL للتجميع والتحليل', domain: 'sql' },
  { topic: 'طبقات الأمان في التطبيقات الحديثة', domain: 'security' },
  { topic: 'بناء واجهات متجاوبة مع الجوال', domain: 'frontend' },
  { topic: 'التوثيق الجيد للمشاريع البرمجية', domain: 'docs' },
  { topic: 'الخوارزميات وترتيب البيانات', domain: 'algorithms' },
  { topic: 'معالجة الأخطاء والحالات الطارئة', domain: 'errors' },
]

const trainingVerbs = ['اشرح', 'اكتب مثالاً عملياً عن', 'قارن بين الجوانب المهمة في', 'لخص أهم النقاط حول', 'اذكر ثلاث فوائد عملية لـ', 'علل أهمية', 'اكتب كوداً يوضح', 'اشرح بالتفصيل']

const trainingDetails = [
  'مع أمثلة عملية قصيرة.',
  'بأسلوب مبسط للمبتدئين.',
  'مع مخطط منطقي واضح.',
  'مع مقارنة سريعة بين البدائل.',
  'باللغة العربية الفصحى المبسطة.',
  'مع حالات استخدام واقعية.',
  'مع نصائح عملية قابلة للتطبيق فوراً.',
  'بإيجاز شديد في ثلاث نقاط فقط.',
  'مع مثال كود جاهز للتشغيل.',
  'من منظور هندسة البرمجيات الحديثة.',
]

let seedCursor = Math.floor(Math.random() * 10_000)
function generateSeedTask() {
  const topic = trainingTopics[(seedCursor + Math.floor(Math.random() * trainingTopics.length)) % trainingTopics.length]
  const verb = trainingVerbs[Math.floor(Math.random() * trainingVerbs.length)]
  const detail = trainingDetails[Math.floor(Math.random() * trainingDetails.length)]
  seedCursor += 1
  return `${verb} ${topic.topic} ${detail}`
}

let schedulerEnabled = String(process.env.NADOS_TRAINING_SCHEDULER || 'off').toLowerCase() === 'on'
let schedulerIntervalMs = Math.max(60_000, Number(process.env.NADOS_TRAINING_INTERVAL_MS) || 600_000)
let schedulerLastRun = null
let schedulerRuns = 0
let schedulerSeedIndex = 0

async function runSchedulerCycle() {
  try {
    const message = generateSeedTask()
    schedulerSeedIndex += 1
    const result = await swarmLearn({ callProvider, message, mode: 'create', instructions: modeInstructions('create', {}) })
    const persistResults = await Promise.all([
      ...(result.outputs || []).filter((item) => item.ok).map((item) => saveTeacherOutput({ ...item, message })),
      result.best ? saveTrainingExample({ message, best: result.best, taskTypes: result.taskTypes }) : Promise.resolve(false),
    ])
    schedulerLastRun = new Date().toISOString()
    schedulerRuns += 1
    console.log(`[training-scheduler] cycle ${schedulerRuns}: ${result.status} | persisted ${persistResults.filter(Boolean).length}`)
  } catch (error) {
    schedulerLastRun = new Date().toISOString()
    console.log(`[training-scheduler] cycle failed: ${String(error?.message || error).slice(0, 120)}`)
  }
}

function startTrainingScheduler() {
  if (!schedulerEnabled) return
  const timer = setInterval(() => { void runSchedulerCycle() }, schedulerIntervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  void runSchedulerCycle()
}

app.post('/api/providers/stats/reset', requireLocalOrigin, (request, response) => {
  const { id } = request.body
  resetProviderStats(id)
  response.json({ ok: true })
})

function isLocalRequest(request) {
  const host = String(request.get('host') || '').toLowerCase().split(':')[0]
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function requireLocalOrigin(request, response, next) {
  if (isLocalRequest(request)) return next()
  response.status(403).json({ error: 'الإدارة متاحة من نسخة Nados المحلية فقط.' })
}

app.post('/api/computer/session', requireLocalOrigin, async (_request, response) => {
  try {
    response.json(await openComputerSession())
  } catch (error) {
    response.status(Number(error.status || 503)).json({ error: error.message || 'تعذّر بدء جلسة التحكم.' })
  }
})

app.delete('/api/computer/session', requireLocalOrigin, (request, response) => {
  response.json({ closed: closeComputerSession(request.get('x-nados-computer-token')) })
})

app.post('/api/computer/plan', requireLocalOrigin, upload.single('file'), async (request, response) => {
  try {
    response.json(await planComputerStep({
      ...request.body,
      token: request.get('x-nados-computer-token'),
      file: request.file,
    }))
  } catch (error) {
    response.status(Number(error.status || 502)).json({ error: error.message || 'تعذّر تحليل الشاشة.' })
  }
})

app.post('/api/computer/execute', requireLocalOrigin, async (request, response) => {
  try {
    response.json(await executeComputerStep({ planId: request.body.planId, token: request.get('x-nados-computer-token') }))
  } catch (error) {
    response.status(Number(error.status || 500)).json({ error: error.message || 'تعذّر تنفيذ الإجراء.' })
  }
})

app.get('/api/providers', requireLocalOrigin, (_request, response) => {
  response.json({ catalog: providerCatalog, providers: providerStatuses(), managed: publicRuntimeProviders() })
})

app.get('/api/models', (request, response) => {
  const models = availableModels()
  response.json({ models: isLocalRequest(request) ? models : models.filter((item) => item.providerId === 'auto') })
})

app.post('/api/providers', requireLocalOrigin, (request, response) => {
  try {
    response.status(201).json({ provider: upsertRuntimeProvider(request.body) })
  } catch (error) {
    response.status(Number(error.status || 500)).json({ error: error.message || 'تعذّر حفظ المزوّد.' })
  }
})

app.post('/api/providers/:id/test', requireLocalOrigin, async (request, response) => {
  try {
    response.json(await testProvider(String(request.params.id)))
  } catch (error) {
    response.status(Number(error.status || 502)).json({ ok: false, error: error.message || 'فشل اختبار المزوّد.' })
  }
})

app.delete('/api/providers/:id', requireLocalOrigin, (request, response) => {
  response.json({ removed: removeRuntimeProvider(String(request.params.id)) })
})

app.get('/api/providers/capabilities', (request, response) => {
  try {
    const capabilities = getProviderCapabilities()
    response.json(isLocalRequest(request) ? capabilities : { count: capabilities.count, connected: [], features: capabilities.features })
  } catch (error) {
    response.status(500).json({ error: error.message || 'فشل الحصول على إمكانيات المزودين.' })
  }
})
app.post('/api/chat/stream', upload.array('files', 5), async (request, response) => {
  let uploadedFileId = null
  let heartbeat = null
  try {
    const { message, mode, model, history } = validateChat(request.body)
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    response.setHeader('Cache-Control', 'no-cache, no-transform')
    response.setHeader('Connection', 'keep-alive')
    response.flushHeaders()
    sendEvent(response, { type: 'status', status: 'connected' })
    heartbeat = setInterval(() => response.write(': nados-heartbeat\n\n'), 15_000)

    if (!openai && !hasExternalProvider()) {
      const reply = fallbackReply(message, mode)
      for (const part of reply.answer) sendEvent(response, { type: 'delta', delta: `${part}\n\n` })
      sendEvent(response, { type: 'done', reply })
      return response.end()
    }

    const connectedIds = new Set(providerStatuses().filter((item) => item.configured).map((item) => item.id))
    const features = {
      webSearch: connectedIds.has('gemini') || connectedIds.has('groq') || connectedIds.has('openai'),
      vision: connectedIds.has('gemini') || connectedIds.has('openai') || (connectedIds.has('openrouter') && Boolean(process.env.OPENROUTER_VISION_MODEL)) || (connectedIds.has('nvidia') && Boolean(process.env.NVIDIA_VISION_MODEL)),
      video: connectedIds.has('gemini'),
      images: Boolean(openai || hasProviderApiKey('gemini') || hasProviderApiKey('huggingface')),
      transcription: Boolean(openai || hasProviderApiKey('groq')),
      speech: Boolean(openai || hasProviderApiKey('gemini')),
      computer: process.platform === 'win32' && hasProviderApiKey('gemini'),
    }
    const chatFiles = request.files || []
    const primaryFile = chatFiles.find((item) => item.mimetype?.startsWith('image/')) || chatFiles[0] || null
    const providerMode = effectiveProviderMode(mode, message, Boolean(chatFiles.length))
    const instructions = modeInstructions(providerMode, features, chatFiles[0] || null)
    const selectedModel = resolveModelSelection(model)

    if (isNadosIdentityQuestion(message)) {
      sendCompletedReply(response, identityReply(), message)
      return
    }

    if (isNadosCapabilityQuestion(message)) {
      sendCompletedReply(response, capabilityReply(features), message)
      return
    }

    if (selectedModel.providerId !== 'auto' && selectedModel.providerId !== 'openai') {
      const selected = await callSelectedProvider({ message, history, mode: providerMode, file: primaryFile, files: chatFiles, instructions }, selectedModel.providerId, selectedModel.model)
      sendEvent(response, { type: 'meta', provider: 'nados' })
      for (let index = 0; index < selected.text.length; index += 72) sendEvent(response, { type: 'delta', delta: selected.text.slice(index, index + 72) })
      sendEvent(response, { type: 'done', reply: { ...splitAnswer(selected.text), sources: decorateSources(selected.sources), provider: 'nados', demo: false, usage: selected.usage } })
      saveConversation({ message, reply: selected.text, mode: providerMode, provider: selected.provider, sources: selected.sources || [] })
      return response.end()
    }

    if (selectedModel.providerId === 'auto' && hasExternalProvider()) {
      const external = await callExternalProviders({
        message,
        history,
        mode: providerMode,
        file: primaryFile,
        files: chatFiles,
        instructions,
      })
      if (external?.text) {
        sendEvent(response, { type: 'meta', provider: 'nados' })
        for (let index = 0; index < external.text.length; index += 72) {
          sendEvent(response, { type: 'delta', delta: external.text.slice(index, index + 72) })
        }
        sendEvent(response, {
          type: 'done',
          reply: {
            ...splitAnswer(external.text),
            sources: decorateSources(external.sources),
            provider: 'nados',
            demo: false,
            usage: external.usage,
          },
        })
        saveConversation({ message, reply: external.text, mode: providerMode, provider: external.provider, sources: external.sources || [] })
        return response.end()
      }
    }

    if (!openai) throw new Error('تعذّر الاتصال بمزودي Nados v1.0 المهيئين.')

    const built = await buildInput(message, primaryFile, history)
    uploadedFileId = built.uploadedFileId
    const stream = await openai.responses.create({
      model: selectedModel.providerId === 'openai' ? selectedModel.model : modelFor(providerMode, primaryFile),
      instructions,
      input: built.input,
      tools: toolsFor(providerMode),
      stream: true,
      store: false,
    })

    let text = ''
    let completedResponse = null
    for await (const event of stream) {
      if (request.destroyed) break
      if (event.type === 'response.output_text.delta') {
        text += event.delta
        sendEvent(response, { type: 'delta', delta: event.delta })
      } else if (event.type === 'response.completed') {
        completedResponse = event.response
      } else if (event.type === 'error') {
        throw new Error(event.message || 'تعذّر إكمال الاستجابة.')
      }
    }

    const parsed = splitAnswer(text || completedResponse?.output_text || '')
    sendEvent(response, {
      type: 'done',
      reply: {
        ...parsed,
        sources: extractSources(completedResponse),
        responseId: completedResponse?.id,
        demo: false,
        usage: completedResponse?.usage ? {
          prompt: completedResponse.usage.input_tokens ?? null,
          completion: completedResponse.usage.output_tokens ?? null,
          total: completedResponse.usage.total_tokens ?? null,
          contextWindow: 200_000,
        } : undefined,
      },
    })
    saveConversation({ message, reply: parsed.answer, mode: providerMode, provider: 'openai', sources: [] })
    response.end()
  } catch (error) {
    const status = Number(error.status || 500)
    const publicMessage = String(error.message || '').replace(/^(Gemini|Groq|NVIDIA NIM|NVIDIA|Cloudflare|Hugging Face|OpenRouter|OpenAI|المزوّد\s+\S+)\s*:\s*/u, '').trim()
    const safeMessage = /^(Gemini|Groq|NVIDIA|Cloudflare|Hugging Face|OpenRouter|OpenAI|api\.)/i.test(publicMessage) || !publicMessage
      ? 'خدمة الذكاء الاصطناعي مشغولة حالياً، جرّب مرة أخرى.'
      : publicMessage
    if (!response.headersSent) return response.status(status).json({ error: safeMessage })
    sendEvent(response, { type: 'error', message: safeMessage })
    response.end()
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    if (openai && uploadedFileId) openai.files.delete(uploadedFileId).catch(() => {})
  }
})

app.post('/api/images', async (request, response) => {
  try {
    const prompt = String(request.body.prompt || '').trim()
    const style = String(request.body.style || 'واقعي').slice(0, 80)
    const ratio = ['square', 'landscape', 'portrait'].includes(request.body.ratio) ? request.body.ratio : 'square'
    if (!prompt || prompt.length > 4000) return response.status(400).json({ error: 'وصف الصورة غير صالح.' })
    const imagePrompt = `${prompt}\nالأسلوب المطلوب: ${style}. بدون نصوص أو شعارات إلا إذا طلب المستخدم ذلك صراحة.`
    if (openai) {
      const sizes = { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' }
      const result = await openai.images.generate({ model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1', prompt: imagePrompt, size: sizes[ratio], quality: 'medium' })
      const base64 = result.data?.[0]?.b64_json
      if (!base64) throw new Error('لم تُرجع خدمة الصور نتيجة قابلة للعرض.')
      return response.json({ demo: false, dataUrl: `data:image/png;base64,${base64}` })
    }
    if (hasProviderApiKey('gemini') || hasProviderApiKey('huggingface')) return response.json({ demo: false, dataUrl: await generateImageWithProviders(imagePrompt, ratio) })
    response.json({ demo: true, dataUrl: null })
  } catch (error) {
    response.status(Number(error.status || 500)).json({ error: error.message || 'تعذّر إنشاء الصورة.' })
  }
})

app.post('/api/audio/transcribe', upload.single('audio'), async (request, response) => {
  try {
    if (!request.file) return response.status(400).json({ error: 'لم يتم إرسال تسجيل صوتي.' })
    if (openai) {
      const result = await openai.audio.transcriptions.create({
        file: await toFile(request.file.buffer, request.file.originalname || 'recording.webm', { type: request.file.mimetype }),
        model: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
      })
      return response.json({ demo: false, text: result.text })
    }
    if (hasProviderApiKey('groq')) return response.json({ demo: false, text: await transcribeWithGroq(request.file) })
    response.json({ demo: true, text: '' })
  } catch (error) {
    response.status(Number(error.status || 500)).json({ error: error.message || 'تعذّر تحويل الصوت إلى نص.' })
  }
})

app.post('/api/audio/speech', async (request, response) => {
  try {
    const text = String(request.body.text || '').trim()
    if (!text || text.length > 4096) return response.status(400).json({ error: 'النص الصوتي غير صالح.' })
    if (openai) {
      const speech = await openai.audio.speech.create({
        model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
        voice: process.env.OPENAI_TTS_VOICE || 'alloy',
        input: text,
        response_format: 'mp3',
      })
      return response.type('audio/mpeg').send(Buffer.from(await speech.arrayBuffer()))
    }
    if (hasProviderApiKey('gemini')) {
      const speech = await synthesizeWithGemini(text)
      return response.type(speech.contentType).send(speech.buffer)
    }
    response.status(503).json({ error: 'خدمة الصوت غير مهيأة.' })
  } catch (error) {
    response.status(Number(error.status || 500)).json({ error: error.message || 'تعذّر إنشاء الصوت.' })
  }
})

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'حجم الملف يتجاوز 20 ميجابايت.'
      : error.code === 'LIMIT_FIELD_VALUE'
        ? 'نص المحادثة يتجاوز الحد المسموح.'
        : 'تعذّر رفع الملف.'
    return response.status(400).json({ error: message })
  }
  response.status(500).json({ error: 'حدث خطأ غير متوقع.' })
})

const root = dirname(fileURLToPath(import.meta.url))
const dist = join(root, '..', 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.use((request, response, next) => {
    if (request.method === 'GET' && request.accepts('html')) return response.sendFile(join(dist, 'index.html'))
    next()
  })
}

app.listen(port, '127.0.0.1', () => {
  const connected = providerStatuses().filter((item) => item.configured).map((item) => item.name)
  console.log(`Nados AI server listening on http://127.0.0.1:${port} (${connected.join(', ') || 'demo mode'})`)
  startTrainingScheduler()
})
