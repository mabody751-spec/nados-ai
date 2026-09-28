import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import OpenAI, { toFile } from 'openai'
import { existsSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callExternalProviders, callSelectedProvider, hasExternalProvider, providerStatuses, 
testProvider, initializeAllProviders, getProviderCapabilities, getAllProvidersHealth, getProviderHealth, 
getProviderStats, recordProviderResult, resetProviderStats, callDeepResearch, localModelStatus } from './providers.mjs'
import { MAX_CONVERSATION_BYTES, validateConversationHistory, validateMessageText } from './limits.mjs'
import { historyCharacterBudget } from './tokenBudget.mjs'
import { buildContextHistory } from './contextEngine.mjs'
import { synthesizeWithGemini, transcribeWithGroq } from './mediaProviders.mjs'
import { hasProviderApiKey } from './providerKeys.mjs'
import { providerCatalog, publicRuntimeProviders, removeRuntimeProvider, upsertRuntimeProvider } from './providerStore.mjs'
import { closeComputerSession, computerStatus, executeComputerStep, openComputerSession, planComputerStep } from './computer.mjs'
import { capabilityReply, effectiveProviderMode, identityReply, isNadosCapabilityQuestion, isNadosIdentityQuestion, liveContext, modeInstructions } from './instructions.mjs'
import { availableModels, resolveModelSelection } from './models.mjs'
import { fetchNvidiaCatalog, nvidiaCatalogSummary, probeNvidiaCatalog } from './nvidiaModels.mjs'
import { getConversations, getTrainingStats, saveConversation, saveTeacherOutput, saveTrainingExample, supabaseEnabled } from './supabaseStore.mjs'
import { buildProviderRegistry, swarmLearn, newTrainingJob, TRAINING_PROVIDER_STATE } from './training/engine.mjs'
import { getTrainingProgress, recordTrainingCycle, seedTrainingProgress, trainingProviderState } from './training/progress.mjs'
import { callLocalNados, callProvider } from './providers.mjs'
import { runAgentLoop, verifyProject, MAX_AUTO_FIX_ATTEMPTS } from './agentLoop.mjs'
import { task as runSubagentTask, board_post, board_read, subagentCount } from './subagents.mjs'
import { deepResearch } from './deepResearch.mjs'
import { exportDatasetFromSupabase, kaggleEnabled, kernelLiveState, kernelStatus, pullKernelOutput, pushDataset, pushTrainingKernel, verifyKaggleCredentials } from './training/kaggleBridge.mjs'
import { getPreviewOrigin, previewUrlFor, startPreviewServer, stopPreviewServer } from './previewServer.mjs'
import {
  createProject,
  deleteProject,
  getFileDiff,
  getProject,
  listFileChanges,
  listProjectsForUser,
  normalizeUserId as normalizeWorkUser,
  projectBelongsTo,
  projectCopyFile,
  projectCreateDirectory,
  projectDeleteFile,
  projectList,
  projectMoveFile,
  projectReadFile,
  projectSearch,
  projectTree,
  projectWriteFile,
  rehydrateProjectsFromDisk,
  workPersistenceEnabled,
} from './workProjects.mjs'
import {
  availableWorkProviders,
  availableWorkTargets,
  detectStartCommand,
  runWorkTaskWithRecovery,
  verifyProjectWorkspace,
  workModelLabel,
  workPause,
  workResume,
  workRunState,
  workStop,
} from './workAgent.mjs'
import {
  LIMITS as SANDBOX_LIMITS,
  executeCommandTool,
  exportZip,
  getServer,
  probeExecution,
  sandboxInfo,
  startServer,
  stopAllServers,
  stopServer,
} from './sandbox/index.mjs'

const app = express()
const port = Number(process.env.PORT || 8787)
const host = String(process.env.HOST || '127.0.0.1')
app.set('trust proxy', 1)
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

// When the API is exposed through a public proxy (Cloudflare Tunnel/Worker), a
// shared token stops strangers from spending the host's provider keys. It is
// enforced only when NADOS_PROXY_TOKEN is configured; local requests (including
// the browser talking to localhost directly) always pass.
const proxyToken = String(process.env.NADOS_PROXY_TOKEN || '').trim()
function safeTokenEqual(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}
app.use('/api', (request, response, next) => {
  if (!proxyToken || isLocalRequest(request)) return next()
  if (safeTokenEqual(request.get('x-nados-proxy-token') || '', proxyToken)) return next()
  response.status(401).json({ error: 'غير مصرّح: واجهة API محمية برمز النفق.' })
})

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
  const raw = String(text || '').trim()
  // Never restructure text that contains fenced code: trimming each line
  // destroys code indentation and blank lines, producing invalid code.
  if (/```/.test(raw)) return { answer: [raw], bullets: [] }
  const answer = []
  const bullets = []
  for (const block of raw.split(/\n{2,}/)) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    const bulletLines = lines.filter((line) => /^[-*•]\s+/.test(line))
    if (lines.length && bulletLines.length === lines.length) {
      bullets.push(...bulletLines.map((line) => line.replace(/^[-*•]\s+/, '')))
    } else {
      answer.push(lines.join('\n').replace(/^#{1,6}\s+/, ''))
    }
  }
  return { answer: answer.length ? answer : [raw], bullets }
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

// Lightweight liveness/readiness probes for container platforms (no provider scan).
app.get('/healthz', (_request, response) => {
  response.json({ status: 'ok', uptime: Math.round(process.uptime()), version: process.env.NADOS_VERSION || '1.0' })
})
app.get('/readyz', (_request, response) => {
  const configured = providerStatuses().filter((item) => item.configured).length
  response.status(configured > 0 ? 200 : 503).json({ status: configured > 0 ? 'ready' : 'degraded', providers: configured })
})

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

app.post('/api/agent/task', requireLocalOrigin, async (request, response) => {
  try {
    const { mode, instructions, background, depth } = request.body || {}
    if (!instructions?.trim()) return response.status(400).json({ error: 'تعليمات المهمة مطلوبة.' })
    const result = await runSubagentTask({ mode, instructions, background, depth }, 'sandbox')
    response.json(result)
  } catch (error) {
    response.status(500).json({ error: error.message || 'فشل تشغيل الوكيل الفرعي.' })
  }
})

app.get('/api/agent/board', requireLocalOrigin, (request, response) => {
  const items = board_read('sandbox', { since: request.query.since || null, limit: Number(request.query.limit) || 50 })
  response.json({ board: items, running: subagentCount('sandbox') })
})

app.get('/api/agent/diff', requireLocalOrigin, async (_request, response) => {
  try {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const run = promisify(execFile)
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command', "Set-Location 'D:/nadosai'; git diff --stat"], { timeout: 20_000, windowsHide: true, maxBuffer: 1024 * 1024 })
    response.json({ diffStat: stdout || 'لا توجد تغييرات غير معتمدة', note: 'التغييرات تعرض ملفات الجلسة المعدلة — استخدم git diff للتفاصيل' })
  } catch (error) {
    response.status(500).json({ error: error.message || 'فشل جلب التغييرات.' })
  }
})

app.post('/api/agent/research', requireLocalOrigin, async (request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  const sendEvent = (event) => {
    try { response.write(`data: ${JSON.stringify(event)}\n\n`) } catch {}
  }
  const heartbeat = setInterval(() => { try { response.write(': nados-heartbeat\n\n') } catch {} }, 15_000)
  try {
    const { question } = request.body || {}
    if (!question?.trim()) {
      sendEvent({ type: 'error', message: 'سؤال البحث مطلوب.' })
      return response.end()
    }
    sendEvent({ type: 'research_start', question })
    const result = await deepResearch(question, 'sandbox')
    sendEvent({ type: 'research_complete', mainQuestion: result.mainQuestion, report: result.report, sources: result.sources, validation: result.validation, durationMs: result.durationMs })
    response.end()
  } catch (error) {
    sendEvent({ type: 'error', message: String(error?.message || error).slice(0, 250) })
    response.end()
  } finally {
    clearInterval(heartbeat)
  }
})

app.post('/api/agent/run', requireLocalOrigin, async (request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  const sendEvent = (event) => {
    try { response.write(`data: ${JSON.stringify(event)}\n\n`) } catch {}
  }
  const heartbeat = setInterval(() => { try { response.write(': nados-heartbeat\n\n') } catch {} }, 15_000)
  try {
    const { task, mode } = request.body || {}
    if (!task?.trim()) {
      sendEvent({ type: 'error', message: 'نص المهمة مطلوبة.' })
      return response.end()
    }
    const result = await runAgentLoop({ task, mode: mode || 'create', onEvent: sendEvent })
    sendEvent({ type: 'task_summary', filesChanged: result.filesChanged, steps: result.steps })

    // التحقق التلقائي + الإصلاح الذاتي (حد 3 محاولات)
    let verification = null
    let finalSummary = result.summary
    if (result.filesChanged?.length) {
      let autoFixAttempts = 0
      verification = await verifyProject(sendEvent)
      while (!verification.allPassed && autoFixAttempts < MAX_AUTO_FIX_ATTEMPTS) {
        autoFixAttempts += 1
        sendEvent({ type: 'auto_fix_attempt', attempt: autoFixAttempts, max: MAX_AUTO_FIX_ATTEMPTS })
        const failures = verification.results.filter((item) => item.failed).map((item) => `${item.label}: ${item.output.slice(-400)}`).join('\n')
        try {
          const fixResult = await runAgentLoop({ task: `أخطرت عمليات التحقق التالية في المشروع:\n${failures}\n\nاقرأ الملفات المعنية، أصلح الأخطاء، وتأكد من الإصلاح.`, mode: 'debug', onEvent: sendEvent })
          if (fixResult.filesChanged?.length) {
            verification = await verifyProject(sendEvent)
            if (verification.allPassed) finalSummary = `${result.summary}\n\n(أُصلحت الأخطاء تلقائياً بعد ${autoFixAttempts} محاولة ✓)`
          }
        } catch (fixError) {
          sendEvent({ type: 'error', message: `فشل محاولة الإصلاح ${autoFixAttempts}: ${String(fixError?.message || fixError).slice(0, 150)}` })
        }
      }
    }

    const done = verification ? (verification.allPassed ? 'completed' : 'completed_with_warnings') : 'completed'
    sendEvent({ type: 'agent_complete', status: done, summary: finalSummary, filesChanged: result.filesChanged, steps: result.steps, durationMs: result.durationMs, verification: verification?.results?.map((item) => ({ label: item.label, passed: item.passed })) })
    response.end()
  } catch (error) {
    sendEvent({ type: 'error', message: String(error?.message || error).slice(0, 250) })
    response.end()
  } finally {
    clearInterval(heartbeat)
  }
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
      providerState: trainingProviderState(),
      model: { version: 'Nados v1.1', base: 'gemma-2-9b (QLoRA)', state: live.state, done: live.done },
      params: { trainable: live.paramsTrainable, total: live.paramsTotal, percent: live.paramsPercent },
      targetParams,
      growth: getTrainingProgress(),
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
  if (supabase?.outputsAccepted) seedTrainingProgress({ accepted: Number(supabase.outputsAccepted) || 0, examples: Number(supabase.examplesTotal) || 0 })
  response.json({
    supabase,
    trainingProvider: TRAINING_PROVIDER_STATE,
    providerState: trainingProviderState(),
    progress: getTrainingProgress(),
    targetParams,
    continuity: { twentyFourSeven: schedulerEnabled, note: 'يعمل باستمرار 24/7 ما دام خادم Nados قيد التشغيل.' },
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
// Target scale for the Nados model program (parameters). Configurable so the
// training center can show progress toward the 900B goal.
const targetParams = Number(process.env.NADOS_TARGET_PARAMS) || 900_000_000_000

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
    const acceptedDelta = (result.outputs || []).filter((item) => item.ok && item.evaluation?.accepted).length
    recordTrainingCycle({ acceptedDelta, quality: result.best?.evaluation?.qualityScore || 0 })
    console.log(`[training-scheduler] cycle ${schedulerRuns}: ${result.status} | persisted ${persistResults.filter(Boolean).length} | +${acceptedDelta} accepted`)
  } catch (error) {
    schedulerLastRun = new Date().toISOString()
    recordTrainingCycle({ acceptedDelta: 0 })
    console.log(`[training-scheduler] cycle failed: ${String(error?.message || error).slice(0, 120)}`)
  }
}

async function seedTrainingFromDataset() {
  try {
    const stats = await getTrainingStats()
    if (stats?.outputsAccepted) seedTrainingProgress({ accepted: Number(stats.outputsAccepted) || 0, examples: Number(stats.examplesTotal) || 0 })
  } catch {}
}

function startTrainingScheduler() {
  if (!schedulerEnabled) return
  void seedTrainingFromDataset()
  const timer = setInterval(() => { void runSchedulerCycle() }, schedulerIntervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  void runSchedulerCycle()
}

app.post('/api/providers/stats/reset', requireLocalOrigin, (request, response) => {
  const { id } = request.body
  resetProviderStats(id)
  response.json({ ok: true })
})

function isLoopbackHostname(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return false
  let host = raw
  try { host = new URL(raw).hostname } catch { host = raw.split(':')[0] }
  host = host.replace(/^\[|\]$/g, '')
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

// "Local only" means loopback Host AND (when the browser tells us) a loopback
// Origin/Referer. The Host header alone is client-controlled and is not a CSRF
// boundary, so a cross-site request from a visited page must be rejected.
function isLocalRequest(request) {
  const host = String(request.get('host') || '').toLowerCase().split(':')[0]
  if (!(host === '127.0.0.1' || host === 'localhost' || host === '::1')) return false
  const origin = request.get('origin')
  if (origin && !isLoopbackHostname(origin)) return false
  const referer = request.get('referer')
  if (!origin && referer && !isLoopbackHostname(referer)) return false
  return true
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
  response.json({ models, chatDefault: models.find((item) => item.chatDefault)?.id || null })
})

let nvidiaRefreshInFlight = false

app.get('/api/models/nvidia', requireLocalOrigin, (_request, response) => {
  response.json(nvidiaCatalogSummary())
})

app.post('/api/models/nvidia/refresh', requireLocalOrigin, async (request, response) => {
  if (nvidiaRefreshInFlight) return response.status(409).json({ error: 'فحص نماذج NVIDIA قيد التنفيذ بالفعل.' })
  nvidiaRefreshInFlight = true
  try {
    const catalog = await fetchNvidiaCatalog({ force: true })
    const report = await probeNvidiaCatalog({
      models: catalog.models,
      concurrency: Number(request.body?.concurrency) || 6,
    })
    response.json({
      ok: true,
      fetchedAt: catalog.fetchedAt,
      total: report.total,
      working: report.working,
      failed: report.failed,
      failureKinds: report.failureKinds,
      workingModels: report.results.filter((item) => item.ok).map((item) => item.model),
      workDefaultModel: report.workDefaultModel,
      chatDefaultModel: report.chatDefaultModel,
    })
  } catch (error) {
    response.status(500).json({ error: String(error?.message || error).slice(0, 250) })
  } finally {
    nvidiaRefreshInFlight = false
  }
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
// Lightweight per-IP limiter for expensive inference endpoints (chat + audio).
// Complements Cloudflare edge rate limiting and prevents runaway loops.
const chatRateBuckets = new Map()
function chatRateLimit(request, response, next) {
  const ip = request.ip || request.socket?.remoteAddress || 'local'
  const now = Date.now()
  const windowMs = 60_000
  const max = Number(process.env.NADOS_CHAT_RATE_LIMIT) || 60
  if (chatRateBuckets.size > 5_000) {
    for (const [key, entry] of chatRateBuckets) if (now > entry.resetAt) chatRateBuckets.delete(key)
  }
  const bucket = chatRateBuckets.get(ip) || { count: 0, resetAt: now + windowMs }
  if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + windowMs }
  bucket.count += 1
  chatRateBuckets.set(ip, bucket)
  if (bucket.count > max) return response.status(429).json({ error: 'عدد طلبات المحادثة كبير — انتظر قليلاً ثم أعد المحاولة.' })
  next()
}

app.post('/api/chat/stream', chatRateLimit, upload.array('files', 5), async (request, response) => {
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
      transcription: Boolean(openai || hasProviderApiKey('groq')),
      speech: Boolean(openai || hasProviderApiKey('gemini')),
      computer: process.platform === 'win32' && hasProviderApiKey('gemini'),
    }
    const chatFiles = request.files || []
    const primaryFile = chatFiles.find((item) => item.mimetype?.startsWith('image/')) || chatFiles[0] || null
    const enableThinking = request.body?.thinking === 'true'
    const customPrompt = String(request.body?.system_prompt || '').trim().slice(0, 2000)
    const userTemperature = Number(request.body?.temperature)
    const providerMode = effectiveProviderMode(mode, message, Boolean(chatFiles.length))
    const liveNow = liveContext()
    const baseInstructions = `${liveNow}\n\n${enableThinking
      ? `${modeInstructions(providerMode, features, chatFiles[0] || null)}\n\n**تفكير عميق ممنهج (Deep Thinking):**\n1. **تحليل**: افهم الطلب تماماً، حدّد المطلوب الأساسي والفرعي، وتعرّف على القيود والسياق.\n2. **تخطيط**: قسّم المهمة إلى خطوات منطقية متسلسلة، حدّد المعلومات المطلوبة والأدوات اللازمة.\n3. **تنفيذ**: نفّذ كل خطوة بدقة، استخدم المنطق والأدلة، وتجنّب الافتراضات غير المؤكدة.\n4. **تحقّق**: راجع الإجابة ذاتياً: هل تجيب على السؤال كاملاً؟ هل المنطق سليم؟ هل توجد أخطاء محتملة؟\n5. **صِغ**: قدّم إجابة نهائية واضحة ومنظمة ودقيقة، مع الأدلة والمصادر إن وُجدت.\n\nفكّر بصوت عالٍ داخلياً عبر هذه المراحل قبل الإجابة النهائية.`
      : modeInstructions(providerMode, features, chatFiles[0] || null)}`
    const instructions = customPrompt ? `${baseInstructions}\n\nتعليمات المستخدم المخصصة (التزم بها حرفياً):\n${customPrompt}` : baseInstructions
    // The live date is also placed in the user turn: some models weight the user
    // message more heavily and would otherwise answer with a stale date.
    const modelMessage = `${liveNow}\n\n${message}`
    const selectedModel = resolveModelSelection(model)

    // Extended memory: keep recent turns verbatim, carry the most relevant older
    // turns, and compress the rest into an extractive memory block, so very long
    // conversations stay coherent without a fictitious model context window.
    const engine = buildContextHistory(history, message, { budgetChars: historyCharacterBudget(selectedModel.model) })
    const contextHistory = engine.history
    const instructionsForModel = engine.memory ? `${instructions}\n\n${engine.memory}` : instructions

    if (isNadosIdentityQuestion(message)) {
      sendCompletedReply(response, identityReply(), message)
      return
    }

    if (isNadosCapabilityQuestion(message)) {
      sendCompletedReply(response, capabilityReply(features), message)
      return
    }

if (selectedModel.providerId === 'nados') {
      // Deep Research mode for research/academic
      if (providerMode === 'research' || providerMode === 'academic') {
        const deepResult = await callDeepResearch({ message: modelMessage, history: contextHistory, mode: providerMode, file: primaryFile, files: chatFiles, instructions: instructionsForModel, modelOverride: selectedModel.model })
        if (deepResult?.text) {
          sendEvent(response, { type: 'meta', provider: 'nados' })
          if (deepResult.thinking) {
            sendEvent(response, { type: 'thinking', steps: deepResult.thinking })
          }
          for (let index = 0; index < deepResult.text.length; index += 72) {
            sendEvent(response, { type: 'delta', delta: deepResult.text.slice(index, index + 72) })
          }
          sendEvent(response, {
            type: 'done',
            reply: {
              ...splitAnswer(deepResult.text),
              sources: decorateSources(deepResult.sources),
              thinking: deepResult.thinking || [],
              deepResearch: true,
              provider: 'nados',
              demo: false,
              usage: deepResult.usage,
            },
          })
          saveConversation({ message, reply: deepResult.text, mode: providerMode, provider: deepResult.provider || 'deep-research', sources: deepResult.sources || [] })
          return response.end()
        }
      }

      // Model variant: "v1.1" (default) prefers the real trained Nados artifact
      // when connected, falling back to the fast teachers otherwise; "v1.0"
      // always uses the classic teachers pipeline.
      const variantRaw = String(request.body?.variant || 'v1.1').toLowerCase()
      const variant = variantRaw === 'v1.0' ? 'v1.0' : variantRaw === 'local' ? 'local' : 'v1.1'
      const preferLocal = variant === 'local' && !enableThinking && providerMode !== 'research' && providerMode !== 'academic' && await localModelStatus()
      if (preferLocal) {
        try {
          // CPU-hosted Nados can take a while; cap it and fall back to the fast
          // teachers so a slow artifact never stalls the user.
          const localTimeoutMs = Number(process.env.NADOS_LOCAL_TIMEOUT_MS) || 20_000
          const localResult = await Promise.race([
            callLocalNados({ message, files: chatFiles, history: contextHistory, instructions: instructionsForModel.slice(0, 700), model: selectedModel.model, temperature: Number.isFinite(userTemperature) ? userTemperature : undefined }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('NADOS_LOCAL_LLM_OFFLINE: تجاوز النموذج المدرَّب مهلة الرد')), localTimeoutMs)),
          ])
          sendEvent(response, { type: 'meta', provider: 'nados', model: 'Nados v1.1 (مدرَّب)', variant: 'local' })
          for (let index = 0; index < localResult.text.length; index += 72) sendEvent(response, { type: 'delta', delta: localResult.text.slice(index, index + 72) })
          sendEvent(response, { type: 'done', reply: { ...splitAnswer(localResult.text), sources: [], provider: 'nados', model: 'Nados v1.1 (مدرَّب)', variant: 'local', demo: false, usage: localResult.usage } })
          saveConversation({ message, reply: localResult.text, mode: providerMode, provider: 'nados-local', sources: [] })
          return response.end()
        } catch (localFirstError) {
          if (!/NADOS_LOCAL_LLM_OFFLINE/.test(String(localFirstError?.message || ''))) throw localFirstError
        }
      }

      // السرعة أولاً: المعلمون السريعون → النموذج المحلي المدرَّب احتياطياً
      let externalResult = null
      try {
        externalResult = await callExternalProviders({ message: modelMessage, history: contextHistory, mode: providerMode, file: primaryFile, files: chatFiles, instructions: instructionsForModel })
      } catch {}
      if (externalResult?.text) {
        sendEvent(response, { type: 'meta', provider: 'nados', model: variant === 'v1.0' ? 'Nados v1.0' : 'Nados v1.1', variant })
        for (let index = 0; index < externalResult.text.length; index += 72) {
          sendEvent(response, { type: 'delta', delta: externalResult.text.slice(index, index + 72) })
        }
        sendEvent(response, {
          type: 'done',
          reply: {
            ...splitAnswer(externalResult.text),
            sources: decorateSources(externalResult.sources),
            provider: 'nados',
            model: variant === 'v1.0' ? 'Nados v1.0' : 'Nados v1.1',
            variant,
            demo: false,
            usage: externalResult.usage,
          },
        })
        saveConversation({ message, reply: externalResult.text, mode: providerMode, provider: externalResult.provider, sources: externalResult.sources || [] })
        return response.end()
      }
      try {
        const localResult = await callLocalNados({ message, files: chatFiles, history: contextHistory, instructions: instructionsForModel, model: selectedModel.model, temperature: Number.isFinite(userTemperature) ? userTemperature : undefined })
        sendEvent(response, { type: 'meta', provider: 'nados' })
        for (let index = 0; index < localResult.text.length; index += 72) sendEvent(response, { type: 'delta', delta: localResult.text.slice(index, index + 72) })
        sendEvent(response, { type: 'done', reply: { ...splitAnswer(localResult.text), sources: [], provider: 'nados', demo: false, usage: localResult.usage } })
        saveConversation({ message, reply: localResult.text, mode: providerMode, provider: 'nados-local', sources: [] })
        return response.end()
      } catch (localError) {
        const message2 = String(localError?.message || '')
        if (/NADOS_LOCAL_LLM_OFFLINE/.test(message2)) {
          // لا معلمون ولا نموذج محلي — رد صادق
          sendEvent(response, { type: 'meta', provider: 'nados' })
          sendEvent(response, { type: 'error', message: 'Nados v1.1 غير متصل حالياً: المعلمون مشغولون والنموذج المحلي متوقف. جرّب مرة أخرى بعد لحظات.' })
          return response.end()
        }
        throw localError
      }
    }

    if (selectedModel.providerId === 'nados-local') {
      const local = await callLocalNados({ message, files: chatFiles, history: contextHistory, instructions: instructionsForModel, model: selectedModel.model })
      sendEvent(response, { type: 'meta', provider: 'nados' })
      for (let index = 0; index < local.text.length; index += 72) sendEvent(response, { type: 'delta', delta: local.text.slice(index, index + 72) })
      sendEvent(response, { type: 'done', reply: { ...splitAnswer(local.text), sources: [], provider: 'nados', demo: false, usage: local.usage } })
      saveConversation({ message, reply: local.text, mode: providerMode, provider: 'nados-local', sources: [] })
      return response.end()
    }

    if (selectedModel.providerId !== 'auto' && selectedModel.providerId !== 'openai') {
      const selected = await callSelectedProvider({ message: modelMessage, history: contextHistory, mode: providerMode, file: primaryFile, files: chatFiles, instructions: instructionsForModel }, selectedModel.providerId, selectedModel.model)
      sendEvent(response, { type: 'meta', provider: 'nados' })
      for (let index = 0; index < selected.text.length; index += 72) sendEvent(response, { type: 'delta', delta: selected.text.slice(index, index + 72) })
      sendEvent(response, { type: 'done', reply: { ...splitAnswer(selected.text), sources: decorateSources(selected.sources), provider: 'nados', demo: false, usage: selected.usage } })
      saveConversation({ message, reply: selected.text, mode: providerMode, provider: selected.provider, sources: selected.sources || [] })
      return response.end()
    }

    if (selectedModel.providerId === 'auto' && hasExternalProvider()) {
      const external = await callExternalProviders({
        message: modelMessage,
        history: contextHistory,
        mode: providerMode,
        file: primaryFile,
        files: chatFiles,
        instructions: instructionsForModel,
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
    const publicMessage = String(error.message || '').replace(/^(Gemini|Groq|NVIDIA NIM|NVIDIA|Cloudflare|Hugging Face|OpenRouter|OpenAI|Nados v1\.1|المزوّد\s+\S+)\s*:\s*/u, '').replace(/^NADOS_[A-Z_]+:\s*/, '').trim()
    const safeMessage = /^(Gemini|Groq|NVIDIA|Cloudflare|Hugging Face|OpenRouter|OpenAI|api\.|fetch failed|NADOS_)/i.test(publicMessage) || !publicMessage
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

app.post('/api/audio/transcribe', chatRateLimit, upload.single('audio'), async (request, response) => {
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

app.post('/api/audio/speech', chatRateLimit, async (request, response) => {
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

// ============================ WORK / REAL EXECUTION ============================
// Project-scoped workspaces, real filesystem tools, real terminal, verification,
// preview and ZIP export. Every response reflects actual tool results.

const workRateBuckets = new Map()
function workRateLimit(request, response, next) {
  const ip = request.ip || request.socket?.remoteAddress || 'local'
  const now = Date.now()
  const windowMs = 60_000
  const max = Number(process.env.NADOS_WORK_RATE_LIMIT) || 300
  // Evict expired buckets so the map cannot grow without bound.
  if (workRateBuckets.size > 5_000) {
    for (const [key, entry] of workRateBuckets) {
      if (now > entry.resetAt) workRateBuckets.delete(key)
    }
  }
  const bucket = workRateBuckets.get(ip) || { count: 0, resetAt: now + windowMs }
  if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + windowMs }
  bucket.count += 1
  workRateBuckets.set(ip, bucket)
  if (bucket.count > max) return response.status(429).json({ error: 'عدد الطلبات كبير — انتظر قليلاً ثم أعد المحاولة.' })
  next()
}

function workUser(request) {
  return normalizeWorkUser(request.get('x-nados-user') || request.query.userId || 'local-user')
}

// Enforces that the project exists and belongs to the caller. Returns 404 (not
// 403) for foreign projects so ids cannot be enumerated.
function requireWorkProject(request, response, next) {
  const project = getProject(request.params.id)
  if (!project || !projectBelongsTo(project.id, workUser(request))) {
    return response.status(404).json({ error: 'المشروع غير موجود.' })
  }
  request.workProject = project
  next()
}

function workError(response, error, fallback = 'فشل تنفيذ العملية.') {
  const message = String(error?.message || error).slice(0, 300)
  return response.status(Number(error?.status) || 400).json({ error: message || fallback, code: error?.code || null })
}

function publicRun(run) {
  return {
    projectId: run.projectId, taskId: run.taskId, status: run.status, task: run.task,
    summary: run.summary, error: run.error, startedAt: run.startedAt, finishedAt: run.finishedAt,
    durationMs: run.durationMs || null, filesChanged: run.filesChanged || [],
    steps: (run.steps || []).map((step) => ({
      id: step.id, type: step.type, status: step.status, description: step.description,
      tool: step.tool, arguments: step.arguments, result: step.result, error: step.error,
      startedAt: step.startedAt, completedAt: step.completedAt, durationMs: step.durationMs,
    })),
  }
}

app.get('/api/work/status', async (request, response) => {
  const local = isLocalRequest(request)
  const probe = local ? await probeExecution() : { ok: false, error: 'وضع العمل متاح من النسخة المحلية فقط (تنفيذ الملفات والأوامر).' }
  response.json({
    executionAvailable: local && probe.ok,
    executionError: probe.error,
    localOnly: true,
    previewOrigin: getPreviewOrigin(),
    provider: sandboxInfo.provider,
    platform: sandboxInfo.platform,
    workspacesRoot: sandboxInfo.root,
    limits: SANDBOX_LIMITS,
    persistence: workPersistenceEnabled(),
    providers: availableWorkProviders(),
    workModel: workModelLabel(),
    workTargets: availableWorkTargets().map((target) => ({ providerId: target.providerId, model: target.model })),
  })
})

app.get('/api/work/projects', requireLocalOrigin, workRateLimit, async (request, response) => {
  try {
    const projects = await listProjectsForUser(workUser(request))
    response.json({ projects, persistence: workPersistenceEnabled() })
  } catch (error) { workError(response, error, 'تعذّر جلب المشاريع.') }
})

app.post('/api/work/projects', requireLocalOrigin, workRateLimit, async (request, response) => {
  try {
    const { name, stack, task } = request.body || {}
    const project = await createProject({ name, stack, task, userId: workUser(request) })
    const files = await projectList(project.id).catch(() => ({ total: 0 }))
    response.status(201).json({ project, fileCount: files.total, previewUrl: previewUrlFor(project.id) })
  } catch (error) { workError(response, error, 'تعذّر إنشاء المشروع.') }
})

app.get('/api/work/projects/:id', requireLocalOrigin, workRateLimit, requireWorkProject, async (request, response) => {
  const project = request.workProject
  try {
    // One tree walk yields both the tree and the file/byte stats.
    const tree = await projectTree(project.id).catch(() => ({ tree: [], files: 0, bytes: 0 }))
    response.json({
      project,
      tree: tree.tree,
      stats: { files: tree.files || 0, bytes: tree.bytes || 0 },
      changes: listFileChanges(project.id),
      run: publicRun(workRunState(project.id)),
      server: getServer(project.id),
      previewUrl: previewUrlFor(project.id),
    })
  } catch (error) { workError(response, error, 'تعذّر جلب المشروع.') }
})

app.delete('/api/work/projects/:id', requireLocalOrigin, workRateLimit, requireWorkProject, async (request, response) => {
  try {
    await stopServer(request.params.id)
    response.json(await deleteProject(request.params.id))
  } catch (error) { workError(response, error, 'تعذّر حذف المشروع.') }
})

app.get('/api/work/projects/:id/tree', requireLocalOrigin, workRateLimit, requireWorkProject, async (request, response) => {
  try {
    const result = await projectTree(request.params.id, String(request.query.dir || '.'))
    response.json({ tree: result.tree, dir: result.dir, files: result.files, bytes: result.bytes })
  } catch (error) { workError(response, error, 'تعذّر قراءة شجرة المشروع.') }
})

app.get('/api/work/projects/:id/files', requireLocalOrigin, workRateLimit, requireWorkProject, async (request, response) => {
  try {
    const path = String(request.query.path || '')
    if (!path) {
      const result = await projectList(request.params.id, String(request.query.dir || '.'))
      return response.json({ dir: result.dir, files: result.files, total: result.total })
    }
    const file = await projectReadFile(request.params.id, path)
    response.json({ path: file.path, content: file.content, bytes: file.bytes, modifiedAt: file.modifiedAt })
  } catch (error) { workError(response, error, 'تعذّر قراءة الملف.') }
})

app.put('/api/work/projects/:id/files', requireLocalOrigin, workRateLimit, requireWorkProject, async (request, response) => {
  try {
    const { path, content } = request.body || {}
    if (!path) return response.status(400).json({ error: 'مسار الملف مطلوب.' })
    const result = await projectWriteFile(request.params.id, path, content ?? '', { source: 'user' })
    response.json({ tool: 'write_file', status: 'success', path: result.path, bytes: result.bytes, created: result.created, replaced: result.replaced })
  } catch (error) {
    const failed = { tool: 'write_file', status: 'error', path: request.body?.path || null, error: String(error?.message || error).slice(0, 300) }
    response.status(400).json(failed)
  }
})

app.post('/api/work/projects/:id/files', requireLocalOrigin, workRateLimit, requireWorkProject, async (request, response) => {
  const { action, path, to, name } = request.body || {}
  try {
    if (action === 'create_file') {
      const result = await projectWriteFile(request.params.id, path, String(request.body?.content ?? ''), { source: 'user' })
      return response.status(201).json({ tool: 'create_file', status: 'success', path: result.path, bytes: result.bytes })
    }
    if (action === 'create_dir') {
      const result = await projectCreateDirectory(request.params.id, path)
      return response.status(201).json({ tool: 'create_directory', status: 'success', path: result.path })
    }
    if (action === 'rename' || action === 'move') {
      const destination = to || (path?.includes('/') ? `${path.slice(0, path.lastIndexOf('/') + 1)}${name}` : name)
      if (!destination) return response.status(400).json({ error: 'الاسم الجديد مطلوب.' })
      const result = await projectMoveFile(request.params.id, path, destination, { source: 'user' })
      return response.json({ tool: 'move_file', status: 'success', from: result.from, to: result.to })
    }
    if (action === 'copy') {
      const result = await projectCopyFile(request.params.id, path, to)
      return response.json({ tool: 'copy_file', status: 'success', from: result.from, to: result.to })
    }
    if (action === 'delete') {
      const result = await projectDeleteFile(request.params.id, path, { source: 'user' })
      return response.json({ tool: 'delete_file', status: 'success', path: result.path, deleted: true })
    }
    response.status(400).json({ error: `إجراء غير معروف: ${action}` })
  } catch (error) { workError(response, error, 'تعذّر تنفيذ العملية على الملف.') }
})

app.get('/api/work/projects/:id/files/diff', requireLocalOrigin, workRateLimit, requireWorkProject, async (request, response) => {
  try {
    const diff = getFileDiff(request.params.id, String(request.query.path || ''))
    if (!diff) return response.status(404).json({ error: 'لا توجد تغييرات مسجّلة لهذا الملف.' })
    response.json(diff)
  } catch (error) { workError(response, error, 'تعذّر جلب الفروقات.') }
})

app.get('/api/work/projects/:id/changes', requireLocalOrigin, workRateLimit, requireWorkProject, async (request, response) => {
  try {
    response.json({ changes: listFileChanges(request.params.id) })
  } catch (error) { workError(response, error, 'تعذّر جلب التغييرات.') }
})

app.get('/api/work/projects/:id/search', requireLocalOrigin, workRateLimit, requireWorkProject, async (request, response) => {
  try {
    const query = String(request.query.q || '')
    if (!query) return response.status(400).json({ error: 'كلمة البحث مطلوبة.' })
    response.json(await projectSearch(request.params.id, query, String(request.query.dir || '.')))
  } catch (error) { workError(response, error, 'تعذّر البحث.') }
})

app.post('/api/work/projects/:id/command', requireLocalOrigin, workRateLimit, requireWorkProject, async (request, response) => {
  try {
    const cmd = String(request.body?.cmd || '').trim()
    if (!cmd) return response.status(400).json({ error: 'الأمر مطلوب.' })
    const result = await executeCommandTool(request.params.id, cmd)
    response.json(result)
  } catch (error) { workError(response, error, 'تعذّر تنفيذ الأمر.') }
})

app.post('/api/work/projects/:id/start', requireLocalOrigin, workRateLimit, requireWorkProject, async (request, response) => {
  try {
    const project = request.workProject
    const command = String(request.body?.command || '').trim() || await detectStartCommand(project.id)
    if (!command) {
      return response.status(400).json({ error: 'لا يوجد أمر تشغيل معرّف لهذا المشروع — المعاينة الثابتة متاحة من تبويب المعاينة.' })
    }
    const result = await startServer(project.id, command)
    response.status(result.started ? 200 : 502).json({ ...result, previewUrl: previewUrlFor(project.id) })
  } catch (error) { workError(response, error, 'تعذّر تشغيل خادم المشروع.') }
})

app.post('/api/work/projects/:id/stop', requireLocalOrigin, workRateLimit, requireWorkProject, async (request, response) => {
  try {
    response.json(await stopServer(request.params.id))
  } catch (error) { workError(response, error, 'تعذّر إيقاف الخادم.') }
})

app.post('/api/work/projects/:id/control', requireLocalOrigin, workRateLimit, requireWorkProject, async (request, response) => {
  const action = String(request.body?.action || '')
  if (action === 'stop') return response.json(workStop(request.params.id))
  if (action === 'pause') return response.json(workPause(request.params.id))
  if (action === 'resume') return response.json(workResume(request.params.id))
  response.status(400).json({ error: `إجراء غير معروف: ${action}` })
})

app.post('/api/work/projects/:id/verify', requireLocalOrigin, workRateLimit, requireWorkProject, async (request, response) => {
  try {
    const verification = await verifyProjectWorkspace(request.params.id, () => {})
    response.json(verification)
  } catch (error) { workError(response, error, 'تعذّر التحقق من المشروع.') }
})

app.post('/api/work/projects/:id/agent', requireLocalOrigin, workRateLimit, requireWorkProject, async (request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  const send = (event) => { try { response.write(`data: ${JSON.stringify(event)}\n\n`) } catch {} }
  const heartbeat = setInterval(() => { try { response.write(': nados-work-heartbeat\n\n') } catch {} }, 15_000)
  let clientClosed = false
  response.on('close', () => {
    if (response.writableEnded) return
    clientClosed = true
    workStop(request.params.id)
  })
  try {
    const task = String(request.body?.task || '').trim()
    if (!task) {
      send({ type: 'error', message: 'نص المهمة مطلوب.' })
      return response.end()
    }
    const result = await runWorkTaskWithRecovery({ projectId: request.params.id, task, onEvent: send, userId: workUser(request) })
    if (!clientClosed) send({ type: 'task_completed', ...result })
    response.end()
  } catch (error) {
    send({ type: 'error', message: String(error?.message || error).slice(0, 250) })
    response.end()
  } finally {
    clearInterval(heartbeat)
  }
})

app.get('/api/work/projects/:id/zip', requireLocalOrigin, workRateLimit, requireWorkProject, async (request, response) => {
  try {
    const archive = await exportZip(request.params.id)
    response.set('X-Nados-Archive-Bytes', String(archive.bytes))
    response.set('X-Nados-Archive-Entries', String(archive.entries))
    response.download(archive.path, archive.filename, async (error) => {
      if (error && !response.headersSent) response.status(500).json({ error: 'تعذّر إرسال الأرشيف.' })
      const { rm } = await import('node:fs/promises')
      await rm(archive.path, { force: true }).catch(() => {})
    })
  } catch (error) { workError(response, error, 'تعذّر تصدير المشروع كأرشيف ZIP.') }
})

// Preview moved to a dedicated loopback origin; answer explicitly instead of
// letting the SPA fallback serve the app shell for the legacy path.
app.use('/api/work/projects/:id/preview', (request, response) => {
  response.status(404).json({
    error: 'المعاينة تُقدَّم الآن من أصل منفصل عبر previewUrl.',
    previewUrl: previewUrlFor(request.params.id),
  })
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

const previewOrigin = await startPreviewServer()
const rehydratedCount = await rehydrateProjectsFromDisk()
if (rehydratedCount) console.log(`[nados-work] rehydrated ${rehydratedCount} project(s) from disk`)

app.listen(port, host, () => {
  const connected = providerStatuses().filter((item) => item.configured).map((item) => item.name)
  console.log(`Nados AI server listening on http://${host}:${port} (${connected.join(', ') || 'demo mode'})`)
  console.log(`[nados-work] preview origin ${previewOrigin}, workspaces ${sandboxInfo.root}`)
  startTrainingScheduler()
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopPreviewServer()
    void stopAllServers().finally(() => process.exit(0))
  })
}
