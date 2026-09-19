import test from 'node:test'
import assert from 'node:assert/strict'
import { callExternalProviders, callSelectedProvider, fitHistoryToContext, getProviderCapabilities, initializeAllProviders, providerStatuses, stripReasoningLeak, testProvider } from './providers.mjs'
import { findRuntimeProvider, removeRuntimeProvider, upsertRuntimeProvider } from './providerStore.mjs'

const originalFetch = globalThis.fetch
const keyNames = ['GEMINI_API_KEY', 'GEMINI_API_KEYS', 'GROQ_API_KEY', 'GROQ_API_KEYS', 'OPENROUTER_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'HUGGINGFACE_TOKEN', 'HUGGINGFACE_TOKENS', 'OPENAI_API_KEY', 'NVIDIA_API_KEY', 'NVIDIA_MODEL', 'NVIDIA_MAX_TOKENS', 'GEMINI_MODEL', 'GEMINI_MODELS', 'GROQ_MODEL', 'GROQ_MODELS', 'GROQ_MAX_TOKENS', 'GROQ_SEARCH_MODEL', 'GROQ_SEARCH_MODELS', 'GROQ_SEARCH_MAX_TOKENS']

function resetProviders() {
  keyNames.forEach((key) => { delete process.env[key] })
  delete process.env.OPENROUTER_VISION_MODEL
  process.env.NADOS_PROVIDER_MODE = 'sequential'
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

test.afterEach(() => {
  resetProviders()
  globalThis.fetch = originalFetch
})

test('reports configured providers without exposing credentials', () => {
  resetProviders()
  process.env.GEMINI_API_KEY = 'test-secret'
  const gemini = providerStatuses().find((item) => item.id === 'gemini')
  assert.deepEqual(gemini, { id: 'gemini', name: 'Gemini API / AI Studio', configured: true, source: 'environment' })
  assert.equal(JSON.stringify(gemini).includes('test-secret'), false)
})

test('fits long history while retaining initial and recent memory', () => {
  const history = [
    { role: 'user', content: `اسمي علي ${'a'.repeat(4_000)}` },
    { role: 'assistant', content: 'middle'.repeat(1_000) },
    { role: 'user', content: `الرمز الأخير 7731 ${'z'.repeat(4_000)}` },
  ]
  const fitted = fitHistoryToContext(history, 2_000)
  assert.match(fitted[0].content, /اسمي علي/)
  assert.match(fitted.at(-1).content, /الرمز الأخير 7731/)
  assert.match(fitted.at(-1).content, /z+$/)
  assert.ok(fitted.reduce((total, item) => total + item.content.length, 0) <= 2_000)
})

test('uses Gemini grounding for search requests', async () => {
  resetProviders()
  process.env.GEMINI_API_KEY = 'gemini-test'
  process.env.NADOS_PROVIDER_ORDER = 'gemini'
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /generativelanguage\.googleapis\.com/)
    const body = JSON.parse(options.body)
    assert.deepEqual(body.tools, [{ google_search: {} }])
    return jsonResponse({ candidates: [{ content: { parts: [{ text: 'إجابة Gemini' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/source', title: 'مصدر' } }] } }] })
  }
  const result = await callExternalProviders({ message: 'سؤال', mode: 'web', instructions: 'تعليمات' })
  assert.equal(result.text, 'إجابة Gemini')
  assert.equal(result.sources[0].url, 'https://example.com/source')
})

test('falls back to the next configured Gemini model when one is unavailable', async () => {
  resetProviders()
  process.env.GEMINI_API_KEY = 'gemini-test'
  process.env.GEMINI_MODEL = 'missing-model'
  process.env.GEMINI_MODELS = 'working-model'
  process.env.NADOS_PROVIDER_ORDER = 'gemini'
  const requested = []
  globalThis.fetch = async (url) => {
    requested.push(String(url))
    if (String(url).includes('missing-model')) {
      return new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 })
    }
    return jsonResponse({ candidates: [{ content: { parts: [{ text: 'النموذج البديل يعمل' }] } }] })
  }
  const result = await callExternalProviders({ message: 'سؤال', mode: 'create', instructions: 'تعليمات' })
  assert.equal(result.text, 'النموذج البديل يعمل')
  assert.equal(requested.length, 2)
})

test('falls back to another Gemini key when the primary quota is exhausted', async () => {
  resetProviders()
  process.env.GEMINI_API_KEY = 'quota-key'
  process.env.GEMINI_API_KEYS = 'working-key'
  process.env.NADOS_PROVIDER_ORDER = 'gemini'
  const requested = []
  globalThis.fetch = async (url) => {
    requested.push(String(url))
    if (String(url).includes('quota-key')) {
      return new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 })
    }
    return jsonResponse({ candidates: [{ content: { parts: [{ text: 'المفتاح الاحتياطي يعمل' }] } }] })
  }
  const result = await callExternalProviders({ message: 'سؤال', mode: 'create', instructions: 'تعليمات' })
  assert.equal(result.text, 'المفتاح الاحتياطي يعمل')
  assert.equal(requested.length, 2)
})

test('does not use generic non-search providers for a web request', async () => {
  resetProviders()
  process.env.HUGGINGFACE_TOKEN = 'test-key'
  process.env.NADOS_PROVIDER_ORDER = 'huggingface'
  let called = false
  globalThis.fetch = async () => {
    called = true
    return jsonResponse({ choices: [{ message: { content: 'غير مؤرض' } }] })
  }
  const result = await callExternalProviders({ message: 'ابحث', mode: 'web', instructions: 'system' })
  assert.equal(result.result, null)
  assert.equal(called, false)
})

test('sends prior conversation memory to Groq', async () => {
  resetProviders()
  process.env.GROQ_API_KEY = 'test-key'
  process.env.NADOS_PROVIDER_ORDER = 'groq'
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    assert.deepEqual(body.messages.slice(1), [
      { role: 'user', content: 'اسمي علي' },
      { role: 'assistant', content: 'أهلاً علي' },
      { role: 'user', content: 'ما اسمي؟' },
    ])
    return jsonResponse({ choices: [{ message: { content: 'اسمك علي' } }] })
  }
  const result = await callExternalProviders({
    message: 'ما اسمي؟',
    mode: 'create',
    instructions: 'system',
    history: [{ role: 'user', content: 'اسمي علي' }, { role: 'assistant', content: 'أهلاً علي' }],
  })
  assert.equal(result.text, 'اسمك علي')
})

test('gives Groq web search a budget that fits the metered tier with its built-in tools', async () => {
  resetProviders()
  process.env.GROQ_API_KEY = 'test-key'
  process.env.NADOS_PROVIDER_ORDER = 'groq'
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'groq/compound-mini')
    assert.ok(body.max_tokens > 1_000, `expected an adaptive budget, got ${body.max_tokens}`)
    assert.ok(body.max_tokens <= 6_000, `expected budget within free-tier TPM including tool overhead, got ${body.max_tokens}`)
    return jsonResponse({ choices: [{ message: { content: 'نتيجة بحث', executed_tools: [{ type: 'visit', arguments: '{"url":"https://example.com/source"}', output: 'Title: مصدر موثوق' }] } }] })
  }
  const result = await callExternalProviders({ message: 'ابحث', mode: 'web', instructions: 'system' })
  assert.equal(result.text, 'نتيجة بحث')
  assert.equal(result.sources[0].url, 'https://example.com/source')
})

test('uses the exact Groq model selected by the user', async () => {
  resetProviders()
  process.env.GROQ_API_KEY = 'test-key'
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'selected/model-v1')
    return jsonResponse({ choices: [{ message: { content: 'Selected model answer' } }] })
  }
  const result = await callSelectedProvider({ message: 'hello', mode: 'create', instructions: 'system' }, 'groq', 'selected/model-v1')
  assert.equal(result.text, 'Selected model answer')
  assert.equal(result.provider, 'groq')
})

test('halves the Groq web output budget after a free-tier size rejection', async () => {
  resetProviders()
  process.env.GROQ_API_KEY = 'test-key'
  process.env.NADOS_PROVIDER_ORDER = 'groq'
  const budgets = []
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    budgets.push(body.max_tokens)
    if (budgets.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'Request Entity Too Large' } }), { status: 413 })
    }
    assert.ok(budgets[1] < budgets[0])
    return jsonResponse({ choices: [{ message: { content: 'نتيجة مختصرة' } }] })
  }
  const result = await callExternalProviders({ message: 'ابحث', mode: 'web', instructions: 'system' })
  assert.equal(result.text, 'نتيجة مختصرة')
  assert.equal(budgets.length, 2)
})

for (const provider of [
  { id: 'groq', key: 'GROQ_API_KEY', host: 'api.groq.com', response: { choices: [{ message: { content: 'Groq answer' } }] } },
  { id: 'openrouter', key: 'OPENROUTER_API_KEY', host: 'openrouter.ai', response: { choices: [{ message: { content: 'OpenRouter answer' } }] } },
  { id: 'huggingface', key: 'HUGGINGFACE_TOKEN', host: 'router.huggingface.co', response: { choices: [{ message: { content: 'Hugging Face answer' } }] } },
  { id: 'nvidia', key: 'NVIDIA_API_KEY', host: 'integrate.api.nvidia.com', response: { choices: [{ message: { content: 'NVIDIA answer' } }] } },
]) {
  test(`uses the ${provider.id} compatible endpoint`, async () => {
    resetProviders()
    process.env[provider.key] = 'test-key'
    process.env.NADOS_PROVIDER_ORDER = provider.id
    globalThis.fetch = async (url, options) => {
      assert.match(String(url), new RegExp(provider.host.replaceAll('.', '\\.')))
      assert.equal(options.headers.Authorization, 'Bearer test-key')
      return jsonResponse(provider.response)
    }
    const result = await callExternalProviders({ message: 'hello', mode: 'create', instructions: 'system' })
    assert.equal(result.provider, provider.id)
  })
}

test('sends NVIDIA chat template kwargs for the selected deepseek model', async () => {
  resetProviders()
  process.env.NVIDIA_API_KEY = 'nvidia-test'
  process.env.NVIDIA_MODEL = 'deepseek-ai/deepseek-v4-flash-0731'
  process.env.NADOS_PROVIDER_ORDER = 'nvidia'
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /integrate\.api\.nvidia\.com/)
    assert.equal(options.headers.Authorization, 'Bearer nvidia-test')
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'deepseek-ai/deepseek-v4-flash-0731')
    assert.deepEqual(body.chat_template_kwargs, { thinking: true, reasoning_effort: 'high' })
    return jsonResponse({ choices: [{ message: { content: 'NVIDIA answer' } }] })
  }
  const result = await callExternalProviders({ message: 'hello', mode: 'create', instructions: 'system' })
  assert.equal(result.text, 'NVIDIA answer')
  assert.equal(result.provider, 'nvidia')
})

test('uses Cloudflare Workers AI endpoint', async () => {
  resetProviders()
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account-test'
  process.env.CLOUDFLARE_API_TOKEN = 'token-test'
  process.env.NADOS_PROVIDER_ORDER = 'cloudflare'
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /cloudflare\.com\/client\/v4\/accounts\/account-test\/ai\/run/)
    assert.equal(options.headers.Authorization, 'Bearer token-test')
    return jsonResponse({ result: { response: 'Cloudflare answer' } })
  }
  const result = await callExternalProviders({ message: 'hello', mode: 'create', instructions: 'system' })
  assert.equal(result.text, 'Cloudflare answer')
})

test('falls back to the responses endpoint for custom providers when chat completions is unsupported', async () => {
  resetProviders()
  upsertRuntimeProvider({ presetId: 'custom', id: 'odyssey', name: 'Odyssey', baseUrl: 'https://odysseyapi.tech/v1', model: 'gpt-5.6-sol', apiKey: 'test-key' })

  const requested = []
  globalThis.fetch = async (url, options) => {
    requested.push(String(url))
    if (String(url).includes('/chat/completions')) {
      return new Response(JSON.stringify({ error: { message: 'No model with the id "gpt-5.6-sol". List available models.' } }), { status: 404 })
    }
    if (String(url).includes('/responses')) {
      const body = JSON.parse(options.body)
      assert.equal(body.model, 'gpt-5.6-sol')
      assert.equal(body.input, 'hello')
      return jsonResponse({ output_text: 'Responses answer', output: [{ content: [{ text: 'Responses answer', type: 'output_text' }] }] })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }

  const result = await callSelectedProvider({ message: 'hello', mode: 'create', instructions: 'system' }, 'odyssey', 'gpt-5.6-sol')
  assert.equal(result.text, 'Responses answer')
  assert.equal(result.provider, 'odyssey')
  assert.ok(requested.some((url) => url.includes('/chat/completions')))
  assert.ok(requested.some((url) => url.includes('/responses')))
  removeRuntimeProvider('odyssey')
})

test('removes a custom provider when its model is invalid', async () => {
  resetProviders()
  upsertRuntimeProvider({ presetId: 'custom', id: 'invalid-model-provider', name: 'Invalid Model Provider', baseUrl: 'https://odysseyapi.tech/v1', model: 'missing-model', apiKey: 'test-key' })
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'No model with the id "missing-model". List available models.' } }), { status: 404 })

  await assert.rejects(() => testProvider('invalid-model-provider'), /No model with the id/)
  assert.equal(findRuntimeProvider('invalid-model-provider'), undefined)
})

test('removes a custom provider automatically when it fails during live auto-selection', async () => {
  resetProviders()
  upsertRuntimeProvider({ presetId: 'custom', id: 'broken-provider', name: 'Broken Provider', baseUrl: 'https://example.com/v1', model: 'missing-model', apiKey: 'test-key' })

  process.env.GEMINI_API_KEY = 'gemini-test'
  process.env.NADOS_PROVIDER_MODE = 'sequential'
  process.env.NADOS_PROVIDER_ORDER = 'broken-provider,gemini'
  globalThis.fetch = async (url) => {
    if (String(url).includes('example.com')) {
      return new Response(JSON.stringify({ error: { message: 'No model with the id "missing-model". List available models.' } }), { status: 404 })
    }
    return jsonResponse({ candidates: [{ content: { parts: [{ text: 'Gemini answer' }] } }] })
  }

  const result = await callExternalProviders({ message: 'hello', mode: 'create', instructions: 'system' })
  assert.equal(result.text, 'Gemini answer')
  assert.equal(findRuntimeProvider('broken-provider'), undefined)
})

test('keeps a custom provider after a transient gateway failure', async () => {
  resetProviders()
  upsertRuntimeProvider({ presetId: 'custom', id: 'odyssey', name: 'Odyssey', baseUrl: 'https://odysseyapi.tech/v1', model: 'openai/gpt-5.6-sol', apiKey: 'test-key' })
  globalThis.fetch = async () => new Response('<html>bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } })

  await assert.rejects(() => testProvider('odyssey'), /HTTP 502|bad gateway/i)
  assert.ok(findRuntimeProvider('odyssey'))
  removeRuntimeProvider('odyssey')
})

test('starts configured providers in parallel and returns the first success', async () => {
  resetProviders()
  process.env.NADOS_PROVIDER_MODE = 'parallel'
  process.env.NADOS_PROVIDER_ORDER = 'gemini,groq'
  process.env.GEMINI_API_KEY = 'gemini-test'
  process.env.GROQ_API_KEY = 'groq-test'
  const requested = []
  globalThis.fetch = async (url) => {
    const target = String(url)
    requested.push(target)
    if (target.includes('generativelanguage.googleapis.com')) {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return jsonResponse({ candidates: [{ content: { parts: [{ text: 'Gemini answer' }] } }] })
    }
    if (target.includes('api.groq.com')) return jsonResponse({ choices: [{ message: { content: 'Groq answer' } }] })
    await new Promise((resolve) => setTimeout(resolve, 60))
    return jsonResponse({ choices: [{ message: { content: 'Runtime answer' } }] })
  }
  const result = await callExternalProviders({ message: 'hello', mode: 'create', instructions: 'system' })
  assert.equal(result.text, 'Groq answer')
  assert.equal(result.orchestration, 'parallel-first-success')
  assert.ok(requested.some((url) => url.includes('generativelanguage.googleapis.com')))
  assert.ok(requested.some((url) => url.includes('api.groq.com')))
})

test('passes stored extraBody to custom provider requests', async () => {
  resetProviders()
  upsertRuntimeProvider({
    presetId: 'custom',
    id: 'kwargs-provider',
    name: 'Kwargs Provider',
    baseUrl: 'https://kwargs.test/v1',
    model: 'deepseek-ai/test-model',
    apiKey: 'test-key',
    extraBody: { chat_template_kwargs: { thinking: false } },
  })
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    assert.deepEqual(body.chat_template_kwargs, { thinking: false })
    return jsonResponse({ choices: [{ message: { content: 'Kwargs answer' } }] })
  }
  const result = await callSelectedProvider({ message: 'hello', mode: 'create', instructions: 'system' }, 'kwargs-provider')
  assert.equal(result.text, 'Kwargs answer')
  removeRuntimeProvider('kwargs-provider')
})

test('strips think blocks from replies', () => {
  const wrapped = '<' + 'think>' + '  جواب نظيف  ' + '<' + '/think>'
  assert.equal(stripReasoningLeak(wrapped), 'جواب نظيف')
  assert.equal(stripReasoningLeak('  جواب نظيف  '), 'جواب نظيف')
})

test('extracts text when the provider returns content as an array of parts', async () => {
  resetProviders()
  process.env.NADOS_PROVIDER_MODE = 'sequential'
  process.env.NADOS_PROVIDER_ORDER = 'groq'
  process.env.GROQ_API_KEY = 'test-key'
  globalThis.fetch = async () => jsonResponse({
    choices: [{
      message: {
        content: [
          { type: 'text', text: '# شركتي - صفحة هبوط\n' },
          { type: 'text', text: 'القسم الأول جاهز.' },
        ],
      },
    }],
  })
  const result = await callExternalProviders({ message: 'اكتب كود', mode: 'create', instructions: 'system' })
  assert.ok(!result.text.includes('[object Object]'))
  assert.ok(result.text.includes('شركتي - صفحة هبوط'))
  assert.ok(result.text.includes('القسم الأول جاهز.'))
})

test('strips a leading reasoning dump when a real answer follows', () => {
  const text = "Here's a thinking process:\n1. **Analyze User Input:**\n- The user asks something\n\nإجابة حقيقية واضحة للمستخدم مع تفاصيل كافية."
  assert.equal(stripReasoningLeak(text), 'إجابة حقيقية واضحة للمستخدم مع تفاصيل كافية.')
})

test('keeps the reply when the reasoning dump has no answer after it', () => {
  const text = "Here's a thinking process:\n1. **Analyze:**\n- thinking only"
  assert.equal(stripReasoningLeak(text), text)
})

test('routes huge prompts to the widest-context provider first', async () => {
  resetProviders()
  process.env.NADOS_PROVIDER_MODE = 'parallel'
  process.env.NADOS_PROVIDER_ORDER = 'gemini,groq'
  process.env.GEMINI_API_KEY = 'gemini-test'
  process.env.GROQ_API_KEY = 'groq-test'
  const order = []
  globalThis.fetch = async (url) => {
    const target = String(url)
    order.push(target.includes('generativelanguage') ? 'gemini' : 'groq')
    if (target.includes('generativelanguage')) return jsonResponse({ candidates: [{ content: { parts: [{ text: 'Gemini full answer' }] } }] })
    return jsonResponse({ choices: [{ message: { content: 'Groq trimmed answer' } }] })
  }
  const hugeMessage = 'كلمة '.repeat(120_000)
  const result = await callExternalProviders({ message: hugeMessage, mode: 'create', instructions: 'system' })
  assert.equal(result.text, 'Gemini full answer')
  assert.equal(result.orchestration, 'huge-context-full-comprehension')
  assert.equal(order[0], 'gemini')
  assert.equal(order.includes('groq'), false)
})

test('feeds real web results to the fallback provider when search providers fail', async () => {
  resetProviders()
  process.env.GEMINI_API_KEY = 'gemini-test'
  process.env.NADOS_PROVIDER_MODE = 'parallel'
  process.env.NADOS_PROVIDER_ORDER = 'gemini'
  upsertRuntimeProvider({ presetId: 'custom', id: 'xkiro-test', name: 'Xkiro', baseUrl: 'https://xkiroapi.test/v1', model: 'deepseek/test', apiKey: 'test-key' })

  const ddgHtml = "<a rel='nofollow' href='//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fsource' class='result-link'>مصدر حقيقي</a><td class='result-snippet'>وصف المصدر</td>"
  const instructionsSeen = []
  globalThis.fetch = async (url, options) => {
    const target = String(url)
    if (target.includes('duckduckgo.com')) {
      return new Response(ddgHtml, { status: 200, headers: { 'Content-Type': 'text/html' } })
    }
    if (target.includes('generativelanguage.googleapis.com')) {
      return new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 })
    }
    if (target.includes('xkiroapi.test')) {
      const body = JSON.parse(options.body)
      instructionsSeen.push(body.messages?.[0]?.content || '')
      return jsonResponse({ choices: [{ message: { content: 'إجابة مبنية على نتائج حقيقية' } }] })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }

  const result = await callExternalProviders({ message: 'ابحث', mode: 'web', instructions: 'system' })
  assert.equal(result.text, 'إجابة مبنية على نتائج حقيقية')
  assert.equal(result.searchFallback, true)
  assert.equal(result.webResults, true)
  assert.equal(result.sources[0]?.url, 'https://example.com/source')
  assert.match(instructionsSeen[0], /نتائج بحث ويب فعلية/)
  assert.match(instructionsSeen[0], /مصدر حقيقي/)
  removeRuntimeProvider('xkiro-test')
})
