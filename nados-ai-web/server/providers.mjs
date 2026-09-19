import { isModelSelectionError, modelPool } from './modelPools.mjs'
import { hasProviderApiKey, providerApiKeys } from './providerKeys.mjs'
import { computeMaxTokens, descendingBudgets, estimateTokens, fitMessageToContext, historyCharacterBudget, isTokenBudgetError, modelTokenLimits, searchToolReserve } from './tokenBudget.mjs'
import { fetchWebResults, webResultsInstructions } from './webSearch.mjs'
import { findRuntimeProvider, publicRuntimeProviders, removeRuntimeProvider, runtimeProviders } from './providerStore.mjs'

const SEARCH_MODES = new Set(['web', 'research', 'academic'])
const HUGE_MESSAGE_TOKENS = 90_000

function isCodingRequest(message) {
  const text = String(message || '')
  return /اكتب\s+(كود|دالة|وظيفة|دوال?|فئة|برنامج)|كود.*(function|api|مكوِّن)|(برمجة|package\.json|component|function|class|write (?:a )?code|code\b|سكريبت|script\b)/i.test(text)
}

// Cache for provider health checks (5 min TTL)
const providerHealthCache = new Map()
const HEALTH_CACHE_TTL = 5 * 60 * 1000

// Persistent health stats
const providerStats = new Map()

function getProviderStat(id) {
  if (!providerStats.has(id)) {
    providerStats.set(id, {
      totalCalls: 0,
      successCalls: 0,
      failedCalls: 0,
      totalLatencyMs: 0,
      lastSuccess: null,
      lastFailure: null,
      lastError: null,
    })
  }
  return providerStats.get(id)
}

export function recordProviderResult(id, success, latencyMs, error = null) {
  const stat = getProviderStat(id)
  stat.totalCalls++
  if (success) {
    stat.successCalls++
    stat.totalLatencyMs += latencyMs
    stat.lastSuccess = Date.now()
  } else {
    stat.failedCalls++
    stat.lastFailure = Date.now()
    stat.lastError = error
  }
}

export function getProviderStats() {
  const stats = {}
  for (const [id, s] of providerStats.entries()) {
    stats[id] = {
      totalCalls: s.totalCalls,
      successCalls: s.successCalls,
      failedCalls: s.failedCalls,
      errorRate: s.totalCalls ? s.failedCalls / s.totalCalls : 0,
      avgLatencyMs: s.successCalls ? Math.round(s.totalLatencyMs / s.successCalls) : 0,
      lastSuccess: s.lastSuccess,
      lastFailure: s.lastFailure,
      lastError: s.lastError,
    }
  }
  return stats
}

export function resetProviderStats(id) {
  if (id) providerStats.delete(id)
  else providerStats.clear()
}

function trimContextContent(content, limit) {
  if (content.length <= limit) return content
  const marker = '\n[تم اختصار السياق]\n'
  if (limit <= marker.length + 2) return content.slice(0, Math.max(0, limit))
  const available = Math.max(2, limit - marker.length)
  const head = Math.ceil(available / 2)
  return `${content.slice(0, head)}${marker}${content.slice(-(available - head))}`
}

const REASONING_PREFIX = /^(?:here'?s\s+(?:a\s+)?thinking\s+process|thinking\s+process|chain\s+of\s+thought|دعني\s+أفكر\s+خطوة\s+خطوة)\s*:?\s*/i

export function stripReasoningLeak(text) {
  let value = String(text || '').trim()
  value = value.replace(/<\/?think>/gi, '').trim()
  if (!REASONING_PREFIX.test(value)) return value
  const lines = value.split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line || /^[-*•\d]/.test(line) || REASONING_PREFIX.test(line)) index += 1
    else break
  }
  const remainder = lines.slice(index).join('\n').trim()
  return remainder.length > 40 ? remainder : value
}

export function fitHistoryToContext(history = [], maxCharacters = 500_000) {
  const clean = history.map((item) => ({ role: item.role, content: String(item.content || '') })).filter((item) => item.content)
  const limit = Math.max(2_000, Number(maxCharacters) || 500_000)
  if (clean.reduce((total, item) => total + item.content.length, 0) <= limit) return clean

  const headLimit = Math.floor(limit * 0.15)
  const first = clean[0]
  const head = first.content.length > headLimit
    ? [{ ...first, content: trimContextContent(first.content, headLimit) }]
    : [first]
  let remaining = limit - head[0].content.length
  const tail = []
  for (let index = clean.length - 1; index > 0 && remaining > 0; index -= 1) {
    const item = clean[index]
    if (item.content.length <= remaining) {
      tail.unshift(item)
      remaining -= item.content.length
    } else {
      tail.unshift({ ...item, content: trimContextContent(item.content, remaining) })
      remaining = 0
    }
  }
  return [...head, ...tail]
}

const definitions = [
  { id: 'gemini', name: 'Gemini API / AI Studio', configured: () => Boolean(process.env.GEMINI_API_KEY?.trim()) },
  { id: 'groq', name: 'Groq', configured: () => Boolean(process.env.GROQ_API_KEY?.trim()) },
  { id: 'openrouter', name: 'OpenRouter', configured: () => Boolean(process.env.OPENROUTER_API_KEY?.trim()) },
  { id: 'cloudflare', name: 'Cloudflare Workers AI', configured: () => Boolean(process.env.CLOUDFLARE_API_TOKEN?.trim() && process.env.CLOUDFLARE_ACCOUNT_ID?.trim()) },
  { id: 'huggingface', name: 'Hugging Face', configured: () => Boolean(process.env.HUGGINGFACE_TOKEN?.trim()) },
  { id: 'openai', name: 'OpenAI', configured: () => Boolean(process.env.OPENAI_API_KEY?.trim()) },
  { id: 'nvidia', name: 'NVIDIA NIM', configured: () => Boolean(process.env.NVIDIA_API_KEY?.trim()) },
]

function enabledProviderIds() {
  const configured = String(process.env.NADOS_ENABLED_PROVIDERS || '').trim()
  return configured
    ? new Set(configured.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))
    : null
}

export function providerStatuses() {
  const enabled = enabledProviderIds()
  const builtIn = definitions.map(({ id, name, configured }) => ({ id, name, configured: (!enabled || enabled.has(id)) && (configured() || Boolean(findRuntimeProvider(id)?.apiKey)), source: 'environment' }))
  const builtInIds = new Set(builtIn.map((item) => item.id))
  return [...builtIn, ...publicRuntimeProviders().filter((item) => (!enabled || enabled.has(item.id)) && !builtInIds.has(item.id)).map((item) => ({ id: item.id, name: item.name, configured: item.configured, source: 'settings' }))]
}

function orderedConfiguredProviders(file, mode, providerOverride = null) {
  const requestedOrder = (process.env.NADOS_PROVIDER_ORDER || 'gemini,groq,openrouter,cloudflare,huggingface,nvidia')
    .split(',')
    .map((item) => item.trim().toLowerCase())
  const configured = new Set(providerStatuses().filter((item) => item.configured).map((item) => item.id))
  const order = [...requestedOrder, ...runtimeProviders().map((item) => item.id)]

  const filtered = [...new Set(order)].filter((id) => {
    if (!configured.has(id) || id === 'openai') return false
    if (SEARCH_MODES.has(mode)) return id === 'gemini' || id === 'groq'
    if (!file) return true
    if (id === 'gemini') return true
    if (/^(text\/|application\/(json|xml))/.test(file.mimetype || '')) return true
    const isImage = (file.mimetype || '').startsWith('image/')
    if (id === 'nvidia' && isImage && Boolean(process.env.NVIDIA_VISION_MODEL)) return true
    return id === 'openrouter' && isImage && Boolean(process.env.OPENROUTER_VISION_MODEL)
  })

  if (!providerOverride || providerOverride === 'auto') return filtered

  const lookup = String(providerOverride).trim().toLowerCase()
  return configured.has(lookup) ? [lookup] : filtered
}

function sourceFromUrl(url, title) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    return { url, title: title || parsed.hostname.replace(/^www\./, '') }
  } catch {
    return null
  }
}

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

async function callGemini({ message, mode, file, files, history = [], instructions, modelOverride }) {
  const models = modelOverride ? [modelOverride] : modelPool(process.env.GEMINI_MODEL, process.env.GEMINI_MODELS, ['gemini-2.5-flash'])
  const fittedHistory = fitHistoryToContext(history, Number(process.env.GEMINI_CONTEXT_CHARS) || historyCharacterBudget(models[0]))
  const list = Array.isArray(files) && files.length ? files : file ? [file] : []
  const images = list.filter((item) => item?.mimetype?.startsWith('image/'))
  const texts = list.filter((item) => item && !images.includes(item) && /^(text\/|application\/(json|xml))/.test(item.mimetype || ''))
  const fittedMessage = fitMessageToContext({ model: models[0], instructions, history: fittedHistory, message })
  const parts = [{ text: fittedMessage }]
  for (const item of texts) {
    const fittedFileText = fitMessageToContext({ model: models[0], instructions, history: fittedHistory, message: item.buffer.toString('utf8') })
    parts.push({ text: `\n\nمحتوى الملف ${item.originalname}:\n${fittedFileText}` })
  }
  for (const item of images) {
    parts.push({
      inline_data: {
        mime_type: item.mimetype || 'application/octet-stream',
        data: item.buffer.toString('base64'),
      },
    })
  }
  const geminiMaxTokens = Number(process.env.GEMINI_MAX_TOKENS) > 0
    ? Number(process.env.GEMINI_MAX_TOKENS)
    : computeMaxTokens({ model: models[0], instructions, history: fittedHistory, message: fittedMessage, files: list })
  const body = {
    system_instruction: { parts: [{ text: instructions }] },
    contents: [
      ...fittedHistory.map((item) => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content }] })),
      { role: 'user', parts },
    ],
    generation_config: { temperature: 0.25, max_output_tokens: geminiMaxTokens },
  }
  if (SEARCH_MODES.has(mode)) body.tools = [{ google_search: {} }]

  const keys = providerApiKeys('gemini')
  let lastError
  for (const apiKey of keys) {
    for (const model of models) {
      try {
        const data = await fetchJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
          'Gemini',
        )
        const candidate = data?.candidates?.[0]
        const text = stripReasoningLeak(candidate?.content?.parts?.map((part) => part.text || '').join('') || '')
        if (!text) throw new Error('Gemini: لم يصل نص من النموذج.')
        const sources = (candidate?.groundingMetadata?.groundingChunks || [])
          .map((chunk) => sourceFromUrl(chunk?.web?.uri, chunk?.web?.title))
          .filter(Boolean)
        const metadata = data?.usageMetadata || null
        return {
          text,
          sources,
          provider: 'gemini',
          usage: {
            prompt: metadata?.promptTokenCount ?? null,
            completion: metadata?.candidatesTokenCount ?? null,
            total: metadata?.totalTokenCount ?? null,
            contextWindow: modelTokenLimits(model).context,
          },
        }
      } catch (error) {
        lastError = error
        if (!isModelSelectionError(error)) break
      }
    }
  }
  throw lastError || new Error('Gemini: لا يوجد نموذج متاح.')
}

function contentText(content) {
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('')
  }
  return typeof content === 'string' ? content : ''
}

function compatibleContent(message, files) {
  const list = Array.isArray(files) ? files : files ? [files] : []
  if (!list.length) return message
  const images = list.filter((file) => file?.mimetype?.startsWith('image/'))
  const texts = list.filter((file) => file && !images.includes(file) && /^(text\/|application\/(json|xml))/.test(file.mimetype || ''))
  if (images.length + texts.length < list.length) throw new Error('هذا المزود لا يدعم نوع بعض الملفات المرفقة.')
  let mergedMessage = message
  for (const file of texts) {
    mergedMessage += `\n\nمحتوى الملف ${file.originalname}:\n${file.buffer.toString('utf8')}`
  }
  if (!images.length) return mergedMessage
  return [
    { type: 'text', text: mergedMessage },
    ...images.map((file) => ({ type: 'image_url', image_url: { url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}` } })),
  ]
}

function compatibleSources(data) {
  const message = data?.choices?.[0]?.message
  const toolSources = (Array.isArray(message?.executed_tools) ? message.executed_tools : []).flatMap((tool) => {
    const sources = Array.isArray(tool?.search_results?.results) ? tool.search_results.results : []
    try {
      const args = typeof tool?.arguments === 'string' ? JSON.parse(tool.arguments) : tool?.arguments
      if (args?.url) {
        const title = /^Title:\s*(.+)$/im.exec(String(tool.output || ''))?.[1]?.trim()
        sources.push({ url: args.url, title })
      }
    } catch {}
    return sources
  })
  const candidates = [
    ...(Array.isArray(data?.citations) ? data.citations : []),
    ...(Array.isArray(message?.citations) ? message.citations : []),
    ...(Array.isArray(message?.annotations) ? message.annotations : []),
    ...toolSources,
  ]
  const seen = new Set()
  return candidates.map((item) => {
    const citation = item?.url_citation || item
    const source = sourceFromUrl(typeof citation === 'string' ? citation : citation?.url, citation?.title)
    if (!source || seen.has(source.url)) return null
    seen.add(source.url)
    return source
  }).filter(Boolean)
}

async function callCompatible({ id, name, baseUrl, apiKey, model, wireApi = 'chat-completions', message, file, files, history = [], instructions, headers = {}, maxTokens = null, extraBody = {} }) {
  const fittedHistory = fitHistoryToContext(history, Number(process.env.NADOS_COMPATIBLE_CONTEXT_CHARS) || historyCharacterBudget(model))
  const rawContent = compatibleContent(message, files?.length ? files : file)
  const fittedContent = typeof rawContent === 'string'
    ? fitMessageToContext({ model, instructions, history: fittedHistory, message: rawContent })
    : (() => {
      const [head, ...attachments] = rawContent
      return [{ ...head, text: fitMessageToContext({ model, instructions, history: fittedHistory, message: head.text }) }, ...attachments]
    })()
  const fittedMessage = typeof fittedContent === 'string' ? fittedContent : fittedContent[0]?.text || message
  const outputBudget = Number(maxTokens) > 0
    ? Number(maxTokens)
    : computeMaxTokens({
      model,
      instructions,
      history: fittedHistory,
      message: fittedMessage,
      file: typeof fittedContent === 'string' ? null : file,
    })

  if (wireApi === 'responses') {
    const data = await fetchJson(`${baseUrl.replace(/\/$/, '')}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        model,
        input: [
          ...fittedHistory.map((item) => ({ role: item.role, content: [{ type: 'input_text', text: item.content }] })),
          { role: 'user', content: [{ type: 'input_text', text: fittedMessage }] },
        ],
        instructions,
        max_output_tokens: outputBudget,
      }),
    }, name)
    const text = data?.output_text?.trim() || data?.output?.map((item) => item?.content?.map((part) => part?.text || '').join('') || '').join('\n').trim()
    if (!text) throw new Error(`${name}: لم يصل نص من نموذج Responses API.`)
    return {
      text,
      sources: compatibleSources(data),
      provider: id,
      usage: {
        prompt: data?.usage?.prompt_tokens ?? null,
        completion: data?.usage?.completion_tokens ?? null,
        total: data?.usage?.total_tokens ?? null,
        contextWindow: modelTokenLimits(model).context,
      },
    }
  }

  try {
    const data = await fetchJson(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: instructions },
          ...fittedHistory.map((item) => ({ role: item.role, content: item.content })),
          { role: 'user', content: fittedContent },
        ],
        temperature: 0.25,
        max_tokens: outputBudget,
        ...extraBody,
      }),
    }, name)
    const text = stripReasoningLeak(contentText(data?.choices?.[0]?.message?.content))
    if (!text) throw new Error(`${name}: لم يصل نص من النموذج.`)
    const usage = data?.usage || null
    return {
      text,
      sources: compatibleSources(data),
      provider: id,
      usage: {
        prompt: usage?.prompt_tokens ?? null,
        completion: usage?.completion_tokens ?? null,
        total: usage?.total_tokens ?? null,
        contextWindow: modelTokenLimits(model).context,
      },
    }
  } catch (error) {
    const detail = String(error?.message || '')
    const status = Number(error?.status || 0)
    const modelAvailabilityError = /No model with the id|model not found|models? not found|unsupported model|not supported/i.test(detail)
    const allowsResponsesFallback = (status === 400 || status === 404 || status === 422) && modelAvailabilityError
    if (!allowsResponsesFallback) throw error

    const data = await fetchJson(`${baseUrl.replace(/\/$/, '')}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        model,
        input: typeof fittedContent === 'string' ? fittedContent : message,
        instructions,
        max_output_tokens: outputBudget,
      }),
    }, name)

    const text = data?.output_text?.trim() || data?.output?.map((item) => item?.content?.map((part) => part?.text || '').join('') || '').join('\n').trim()
    if (!text) throw new Error(`${name}: لم يصل نص من النموذج عبر Responses API.`)

    return { text, sources: compatibleSources(data), provider: id }
  }
}

async function callCloudflare({ message, history = [], instructions, modelOverride }) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const model = modelOverride || process.env.CLOUDFLARE_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
  const fittedHistory = fitHistoryToContext(history, Number(process.env.CLOUDFLARE_CONTEXT_CHARS) || historyCharacterBudget(model))
  const maxTokens = Number(process.env.CLOUDFLARE_MAX_TOKENS) > 0
    ? Number(process.env.CLOUDFLARE_MAX_TOKENS)
    : computeMaxTokens({ model, instructions, history: fittedHistory, message })
  const data = await fetchJson(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: instructions }, ...fittedHistory, { role: 'user', content: message }], max_tokens: maxTokens }),
    },
    'Cloudflare',
  )
  const text = contentText(data?.result?.response || data?.result?.choices?.[0]?.message?.content).trim()
  if (!text) throw new Error('Cloudflare: لم يصل نص من النموذج.')
  return { text, sources: [], provider: 'cloudflare' }
}

function groqSearchInstructions(mode) {
  const labels = { web: 'الويب', research: 'البحث العميق', academic: 'البحث الأكاديمي' }
  const label = labels[mode] || 'الويب'
  return [
    'أنت Nados v1.0. أجب بلغة المستخدم بأسلوب واضح ومنظم.',
    `وضعك الحالي: ${label}. اعتمد فقط على نتائج بحث الويب الفعلية وأرفق روابط المصادر التي ظهرت فعلاً.`,
    'لا تختلق أي معلومة أو رابط أو مرجعاً. إن لم تصل نتائج بحث فقل ذلك صراحة.',
  ].join('\n')
}

export async function callProvider(id, context) {
  const runtime = findRuntimeProvider(id)
  if (id === 'gemini') return await callGemini(context)
  if (id === 'groq') {
    const searching = SEARCH_MODES.has(context.mode)
    const models = context.modelOverride
      ? [context.modelOverride]
      : searching
      ? modelPool(process.env.GROQ_SEARCH_MODEL, process.env.GROQ_SEARCH_MODELS, ['groq/compound-mini', 'groq/compound'])
      : modelPool(process.env.GROQ_MODEL, process.env.GROQ_MODELS, ['qwen/qwen3.8-27b'])
    const coding = searching ? false : isCodingRequest(context.message)
    const candidateModels = coding
      ? ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']
          .filter((id) => modelPool(process.env.GROQ_MODEL, process.env.GROQ_MODELS, ['qwen/qwen3.8-27b']).includes(id))
      : models
    const keys = providerApiKeys('groq')
    let lastError
    keyLoop: for (const apiKey of keys) {
      for (const model of candidateModels) {
        const instructions = searching ? groqSearchInstructions(context.mode) : context.instructions
        const envBudget = Number(searching ? process.env.GROQ_SEARCH_MAX_TOKENS : process.env.GROQ_MAX_TOKENS)
        const baseBudget = envBudget > 0
          ? envBudget
          : Math.max(256, computeMaxTokens({ model, instructions, history: context.history, message: context.message, file: context.file })
            - (searching ? searchToolReserve(model) : 0))
        for (const maxTokens of descendingBudgets(baseBudget)) {
          try {
            return await callCompatible({
              ...context,
              id,
              name: 'Groq',
              baseUrl: 'https://api.groq.com/openai/v1',
              apiKey,
              model,
              maxTokens,
              instructions,
            })
          } catch (error) {
            lastError = error
            if (isTokenBudgetError(error)) continue
            if (isModelSelectionError(error)) break
            continue keyLoop
          }
        }
      }
    }
    throw lastError || new Error('Groq: لا يوجد نموذج متاح.')
  }
  if (id === 'openrouter') {
    return await callCompatible({
      ...context,
      id,
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
      model: context.modelOverride || (context.file ? process.env.OPENROUTER_VISION_MODEL : (process.env.OPENROUTER_MODEL || 'openrouter/free')),
      headers: { 'HTTP-Referer': process.env.PUBLIC_APP_URL || 'http://localhost', 'X-Title': 'Nados AI' },
    })
  }
  if (id === 'cloudflare') return await callCloudflare(context)
  if (id === 'openai') throw new Error('OpenAI: use direct client')
  if (id === 'nvidia') {
    const isImage = (context.file?.mimetype || '').startsWith('image/')
    const nvidiaModel = context.modelOverride
      || (isImage ? (process.env.NVIDIA_VISION_MODEL || process.env.NVIDIA_MODEL) : process.env.NVIDIA_MODEL)
      || 'nvidia/nemotron-3-super-120b-a12b'
    const isDeepseek = /deepseek/i.test(nvidiaModel)
    const nvidiaMaxTokens = Number(process.env.NVIDIA_MAX_TOKENS) > 0
      ? Number(process.env.NVIDIA_MAX_TOKENS)
      : computeMaxTokens({ model: nvidiaModel, instructions: context.instructions, history: context.history, message: context.message, file: context.file })
    const keys = providerApiKeys('nvidia')
    let lastError
    const extraKwargs = isDeepseek
      ? { chat_template_kwargs: { thinking: true, reasoning_effort: 'high' } }
      : /nemotron/i.test(nvidiaModel)
        ? { chat_template_kwargs: { thinking: false } }
        : {}
    for (const apiKey of keys) {
      try {
        return await callCompatible({
          ...context,
          id,
          name: 'NVIDIA NIM',
          baseUrl: 'https://integrate.api.nvidia.com/v1',
          apiKey,
          model: nvidiaModel,
          maxTokens: nvidiaMaxTokens,
          extraBody: extraKwargs,
        })
      } catch (error) {
        lastError = error
        if (isModelSelectionError(error)) break
      }
    }
    throw lastError || new Error('NVIDIA: لا يوجد مفتاح متاح.')
  }
  if (id === 'huggingface') {
    return await callCompatible({
      ...context,
      id,
      name: 'Hugging Face',
      baseUrl: 'https://router.huggingface.co/v1',
      apiKey: process.env.HUGGINGFACE_TOKEN,
      model: context.modelOverride || process.env.HUGGINGFACE_MODEL || 'meta-llama/Llama-3.1-8B-Instruct',
    })
  }
  if (runtime) {
    const customModel = context.modelOverride || runtime.model
    const customMaxTokens = Number(process.env.CUSTOM_PROVIDER_MAX_TOKENS) > 0
      ? Number(process.env.CUSTOM_PROVIDER_MAX_TOKENS)
      : computeMaxTokens({ model: customModel, instructions: context.instructions, history: context.history, message: context.message, file: context.file })
    return await callCompatible({
      ...context,
      id: runtime.id,
      name: runtime.name,
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
      model: customModel,
      wireApi: runtime.wireApi,
      maxTokens: customMaxTokens,
      extraBody: runtime.extraBody && typeof runtime.extraBody === 'object' ? runtime.extraBody : {},
    })
  }
  throw new Error(`المزوّد ${id} غير مهيأ.`)
}

function shouldPruneRuntimeProvider(providerId, error) {
  const runtime = findRuntimeProvider(providerId)
  if (!runtime || runtime.presetId !== 'custom') return false

  const status = Number(error?.status || 0)
  const detail = String(error?.message || '')
  const isModelIssue = /No model with the id|model not found|unsupported model|not supported|unknown model/i.test(detail)

  return (status === 400 || status === 404 || status === 422) && isModelIssue
}

function pruneBrokenRuntimeProvider(providerId, error) {
  if (!shouldPruneRuntimeProvider(providerId, error)) return false
  removeRuntimeProvider(providerId)
  return true
}

function parallelResult(ids, context) {
  const attempts = ids.map(async (id) => {
    try {
      return await callProvider(id, context)
    } catch (error) {
      pruneBrokenRuntimeProvider(id, error)
      throw Object.assign(new Error(error.message), { providerId: id, status: error.status })
    }
  })
  return Promise.any(attempts)
}

export async function callExternalProviders(context) {
  let ids = orderedConfiguredProviders(context.file, context.mode, context.providerOverride)
  if (!ids.length) return { result: null, failures: [] }

  if (estimateTokens(context.message) > HUGE_MESSAGE_TOKENS && ids.includes('gemini')) {
    try {
      const result = await parallelResult(['gemini'], context)
      return { ...result, orchestration: 'huge-context-full-comprehension', attemptedProviders: ['gemini'] }
    } catch (error) {
      ids = ids.filter((id) => id !== 'gemini')
      if (!ids.length) {
        const failures = (error.errors || []).map((failure) => `${failure.providerId || 'provider'}: ${failure.message}`)
        return { result: null, failures, orchestration: 'parallel-first-success', attemptedProviders: ['gemini'] }
      }
    }
  }

  if (process.env.NADOS_PROVIDER_MODE === 'sequential') {
    const failures = []
    for (const id of ids) {
      try {
        return await callProvider(id, context)
      } catch (error) {
        pruneBrokenRuntimeProvider(id, error)
        failures.push(`${id}: ${error.message}`)
      }
    }
    return { result: null, failures }
  }

  try {
    const result = await parallelResult(ids, context)
    return { ...result, orchestration: 'parallel-first-success', attemptedProviders: ids }
  } catch (error) {
    const failures = (error.errors || []).map((failure) => `${failure.providerId || 'provider'}: ${failure.message}`)
    ;(error.errors || []).forEach((failure) => pruneBrokenRuntimeProvider(failure.providerId, failure))

    if (SEARCH_MODES.has(context.mode)) {
      const fallbackIds = orderedConfiguredProviders(context.file, 'create', context.providerOverride).filter((id) => !ids.includes(id))
      if (fallbackIds.length) {
        const webResults = await fetchWebResults(context.message)
        const fallbackContext = webResults.length
          ? { ...context, instructions: [context.instructions, webResultsInstructions(webResults)].filter(Boolean).join('\n\n') }
          : context
        try {
          const fallback = await parallelResult(fallbackIds, fallbackContext)
          return {
            ...fallback,
            sources: webResults.length
              ? webResults.map((item) => sourceFromUrl(item.url, item.title)).filter(Boolean)
              : fallback.sources,
            orchestration: 'search-provider-fallback',
            attemptedProviders: [...ids, ...fallbackIds],
            searchFallback: true,
            webResults: webResults.length > 0,
          }
        } catch (fallbackError) {
          failures.push(...(fallbackError.errors || []).map((failure) => `${failure.providerId || 'provider'}: ${failure.message}`))
          ;(fallbackError.errors || []).forEach((failure) => pruneBrokenRuntimeProvider(failure.providerId, failure))
        }
      }
    }

    return { result: null, failures, orchestration: 'parallel-first-success', attemptedProviders: ids }
  }
}

export async function callSelectedProvider(context, providerId, model) {
  return await callProvider(providerId, { ...context, modelOverride: model })
}

export async function testProvider(id) {
  const runtime = findRuntimeProvider(id)
  try {
    const result = await callProvider(id, { message: 'Reply with OK only.', mode: 'create', history: [], instructions: 'Reply with OK only.' })
    return { ok: true, provider: id, preview: result.text.slice(0, 80) }
  } catch (error) {
    if (shouldPruneRuntimeProvider(id, error)) {
      removeRuntimeProvider(id)
    }
    throw error
  }
}

export function hasExternalProvider() {
  return providerStatuses().some((item) => item.id !== 'openai' && item.configured)
}

/**
 * Check health of a single provider with timeout.
 * Uses callProvider directly (never testProvider) so a failed
 * health probe can never remove a runtime provider from the store.
 */
async function checkProviderHealth(providerId, timeoutMs = 20_000) {
  const start = Date.now()
  try {
    const result = await Promise.race([
      callProvider(providerId, { message: 'Reply with OK only.', mode: 'create', history: [], instructions: 'Reply with OK only.' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))
    ])
    const latency = Date.now() - start
    recordProviderResult(providerId, true, latency)
    return { id: providerId, status: 'ready', latencyMs: latency, model: result?.text?.slice(0, 80) }
  } catch (error) {
    const latency = Date.now() - start
    recordProviderResult(providerId, false, latency, error?.message)
    return { id: providerId, status: 'error', latencyMs: latency, error: error?.message || 'Unknown error' }
  }
}

/**
 * Get cached health or run fresh check
 */
export async function getProviderHealth(providerId) {
  const cached = providerHealthCache.get(providerId)
  if (cached && Date.now() - cached.timestamp < HEALTH_CACHE_TTL) {
    return { ...cached.data, cached: true }
  }
  const result = await checkProviderHealth(providerId)
  providerHealthCache.set(providerId, { data: result, timestamp: Date.now() })
  return { ...result, cached: false }
}

/**
 * Get health for all configured providers (parallel, cached per provider)
 */
export async function getAllProvidersHealth() {
  const statuses = providerStatuses()
  const configured = statuses.filter((item) => item.configured)
  const results = await Promise.allSettled(
    configured.map((p) => getProviderHealth(p.id))
  )
  return results.map((r, i) => {
    if (r.status !== 'fulfilled') return { id: configured[i].id, status: 'error', error: r.reason?.message }
    const { cached, ...health } = r.value
    return health
  })
}

/**
 * Initialize all configured providers
 */
export async function initializeAllProviders() {
  const statuses = providerStatuses()
  const configured = statuses.filter((item) => item.configured)
  const results = {
    initialized: [],
    failed: [],
    summary: {},
  }

  const health = await getAllProvidersHealth()

  for (const h of health) {
    try {
      if (h.status === 'ready') {
        const p = configured.find(c => c.id === h.id)
        results.initialized.push({
          id: h.id,
          name: p?.name || h.id,
          status: 'ready',
          latencyMs: h.latencyMs,
          model: h.model,
        })
      } else {
        throw new Error(h.error)
      }
    } catch (error) {
      const p = configured.find(c => c.id === h.id)
      results.failed.push({
        id: h.id,
        name: p?.name || h.id,
        error: error?.message || 'خطأ غير معروف',
        status: 'error',
      })
    }
  }

  results.summary = {
    total: configured.length,
    ready: results.initialized.length,
    failed: results.failed.length,
    providers: configured.map((p) => ({
      id: p.id,
      name: p.name,
      configured: p.configured,
      source: p.source,
    })),
  }

  return results
}

/**
 * Get available providers with capabilities
 */
export function getProviderCapabilities() {
  const statuses = providerStatuses()
  const connected = statuses.filter((item) => item.configured)
  const connectedIds = new Set(connected.map((item) => item.id))

  return {
    available: statuses,
    connected: connected,
    count: connected.length,
    features: {
      webSearch: connectedIds.has('gemini') || connectedIds.has('groq') || connectedIds.has('openai'),
      vision: connectedIds.has('gemini') || connectedIds.has('openai') || (connectedIds.has('nvidia') && Boolean(process.env.NVIDIA_VISION_MODEL)),
      images: Boolean(process.env.OPENAI_API_KEY) || hasProviderApiKey('gemini') || hasProviderApiKey('huggingface'),
      transcription: Boolean(process.env.OPENAI_API_KEY) || hasProviderApiKey('groq'),
      speech: Boolean(process.env.OPENAI_API_KEY) || hasProviderApiKey('gemini'),
    },
  }
}
