// The Cloudflare Worker serves the static SPA and proxies /api to the Nados Node
// server (a Cloudflare Tunnel to the local machine via API_TARGET). When that
// origin is unreachable — e.g. the user's computer is off — it answers chat
// directly with Cloudflare Workers AI so the site keeps working, instead of
// going dark.
const FALLBACK_API_TARGET = ''
const LOCAL_TIMEOUT_MS = Number('15000')
const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const AI_LABEL = 'Cloudflare Workers AI'

const FALLBACK_PATHS = new Set(['/api/chat/stream', '/api/chat', '/api/health', '/api/providers/capabilities', '/api/models'])

const SYSTEM_PROMPT = [
  'أنت Nados AI، مساعد ذكي يتحدث العربية بطلاقة.',
  'أجب مباشرة وبعمق وبأسلوب منظم، وابدأ بالنتيجة الأهم.',
  'اكتب الكود في كتل Markdown مسيجة وحدد اللغة، وتحقق من صحة الحقائق، واذكر الشك عند عدم اليقين.',
  'لا تختلق معلومات أو روابط.',
].join('\n')

const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`

function aiCapabilities() {
  return {
    ok: true,
    configured: true,
    provider: 'cloudflare',
    model: AI_LABEL,
    orchestration: { name: 'cloudflare-workers-ai', mode: 'sequential-failover', activeProviders: 1 },
    providers: [{ id: 'cloudflare', name: AI_LABEL, configured: true }],
    features: { chat: true, webSearch: false, files: false, vision: false, video: false, transcription: false, speech: false, computer: false },
  }
}

async function readForm(request, bodyBuffer) {
  try {
    const form = await new Response(bodyBuffer, { headers: { 'content-type': request.headers.get('content-type') || '' } }).formData()
    const message = String(form.get('message') || '').trim()
    let history = []
    try { history = JSON.parse(String(form.get('history') || '[]')) } catch {}
    return { message, history: Array.isArray(history) ? history : [], mode: String(form.get('mode') || 'create') }
  } catch {
    return { message: '', history: [], mode: 'create' }
  }
}

function buildMessages({ message, history }) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }]
  for (const item of history.slice(-8)) {
    if ((item?.role === 'user' || item?.role === 'assistant') && typeof item.content === 'string') {
      messages.push({ role: item.role, content: item.content.slice(0, 4000) })
    }
  }
  messages.push({ role: 'user', content: message })
  return messages
}

function aiErrorStream(message) {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      controller.enqueue(encoder.encode(sse({ type: 'error', message })))
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' } })
}

async function aiChatReply(env, request, bodyBuffer) {
  const { message, history } = await readForm(request, bodyBuffer)
  if (!message) return aiErrorStream('لم يصل نص السؤال.')
  if (!env?.AI) return aiErrorStream('خدمة Nados السحابية غير مهيأة على هذا الحساب.')
  let text = ''
  try {
    const result = await env.AI.run(AI_MODEL, { messages: buildMessages({ message, history }), max_tokens: 1536 })
    text = String(result?.response || '').trim()
  } catch (error) {
    return aiErrorStream(`تعذّر الاتصال بخدمة Nados السحابية: ${String(error?.message || error).slice(0, 160)}`)
  }
  if (!text) return aiErrorStream('لم تصل إجابة من خدمة Nados السحابية.')
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sse({ type: 'status', status: 'connected' })))
      controller.enqueue(encoder.encode(sse({ type: 'meta', provider: 'nados', model: AI_LABEL })))
      for (let index = 0; index < text.length; index += 64) {
        controller.enqueue(encoder.encode(sse({ type: 'delta', delta: text.slice(index, index + 64) })))
      }
      controller.enqueue(encoder.encode(sse({
        type: 'done',
        reply: { answer: [text], bullets: [], sources: [], provider: 'nados', model: AI_LABEL, demo: false },
      })))
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' } })
}

function cloudFallback(request, env, url, bodyBuffer) {
  const path = url.pathname
  if (path === '/api/health' || path === '/api/providers/capabilities') {
    return Response.json(aiCapabilities())
  }
  if (path === '/api/models') {
    return Response.json({
      chatDefault: 'nados',
      models: [{
        id: 'nados',
        label: 'Nados · Cloud AI',
        providerId: 'cloudflare',
        provider: AI_LABEL,
        model: AI_LABEL,
        webSearch: false,
        vision: false,
        files: false,
        recommended: true,
        chatDefault: true,
      }],
    })
  }
  if (path === '/api/chat/stream' || path === '/api/chat') return aiChatReply(env, request, bodyBuffer)
  return Response.json({ error: 'cloud_fallback_unsupported', message: 'هذه الميزة تتطلب تشغيل خادم Nados المحلي.' }, { status: 503 })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)

    const hasBody = !['GET', 'HEAD'].includes(request.method)
    const bodyBuffer = hasBody ? await request.arrayBuffer() : undefined

    const target = String(env?.API_TARGET || FALLBACK_API_TARGET || '').replace(/\/+$/, '')
    if (target) {
      const headers = new Headers(request.headers)
      headers.delete('host')
      headers.set('x-nados-proxy', 'cloudflare-worker')
      const token = String(env?.NADOS_PROXY_TOKEN || '')
      if (token) headers.set('x-nados-proxy-token', token)
      const upstream = new Request(`${target}${url.pathname}${url.search}`, { method: request.method, headers, body: bodyBuffer, redirect: 'manual' })
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), LOCAL_TIMEOUT_MS)
      try {
        const response = await fetch(upstream, { signal: controller.signal })
        clearTimeout(timer)
        // Streaming responses keep flowing: the timeout only guards the initial connect.
        if (response.ok || !FALLBACK_PATHS.has(url.pathname)) return response
      } catch {
        clearTimeout(timer)
      }
    }

    return cloudFallback(request, env, url, bodyBuffer)
  },
}
