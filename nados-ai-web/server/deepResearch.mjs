import { fetchWebResults, parseWebResults, webResultsInstructions } from './webSearch.mjs'
import { fetchJson } from './utils.mjs'
import { board_post } from './subagents.mjs'

const MAX_ITERATIONS = 3
const SEARCH_TIMEOUT = 15_000
const MAX_SOURCES_PER_ITERATION = 8
const MAX_TOTAL_SOURCES = 20
const JUNK_DOMAINS = /instagram\.com|facebook\.com|tiktok\.com|pinterest\.|twitter\.com|x\.com|spotify\.com|lyrics|lyrkit|songtext|9lyrics|mo3lyrics|cs\.instagram|google\.com|apkpure|apkmirror|apkcombo|uptodown|softonic|accounts\.|calendar\.|drive\.google|login\.|signin\./i
// Deterministic research angles keep later iterations on-topic instead of
// amplifying whatever noisy terms the first results happened to contain.
const RESEARCH_ANGLES = ['تعريف شامل', 'أمثلة وتطبيقات عملية', 'أحدث التطورات 2026']

const SEARCH_ENGINES = {
  bing: {
    name: 'Bing',
    fetch: async (query) => {
      const trimmed = String(query || '').trim().slice(0, 400)
      if (!trimmed) return []
      const url = `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}&count=15`
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept-Language': 'ar,en;q=0.9',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) return []
      const html = await response.text()
      if (/captcha|are you a robot/i.test(html)) return []
      return parseBingResults(html)
    },
  },
  wikipedia: {
    name: 'Wikipedia',
    fetch: async (query) => {
      const trimmed = String(query || '').trim().slice(0, 300)
      if (!trimmed) return []
      const out = []
      for (const lang of ['ar', 'en']) {
        try {
          const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(trimmed)}&format=json&srlimit=5&origin=*`
          const response = await fetch(url, {
            headers: { 'User-Agent': 'NadosAI/1.0 (research)', Accept: 'application/json' },
            signal: AbortSignal.timeout(12_000),
          })
          if (!response.ok) continue
          const body = await response.json()
          for (const item of body?.query?.search || []) {
            out.push({
              url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(item.title || '').replace(/ /g, '_'))}`,
              title: item.title,
              snippet: String(item.snippet || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
            })
          }
        } catch {}
        if (out.length >= 6) break
      }
      return out
    },
  },
  duckduckgo: {
    name: 'DuckDuckGo',
    fetch: async (query) => {
      const trimmed = String(query || '').trim().slice(0, 400)
      if (!trimmed) return []
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(trimmed)}`
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept-Language': 'ar,en;q=0.9',
        },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) return []
      const html = await response.text()
      if (/anomaly|captcha/i.test(html)) return []
      return parseWebResults(html)
    },
  },
}

function decodeBingUrl(url) {
  const match = /[?&]u=a1([^&]+)/.exec(url)
  if (!match) return url
  try {
    let base64 = match[1].replace(/-/g, '+').replace(/_/g, '/')
    while (base64.length % 4) base64 += '='
    return Buffer.from(base64, 'base64').toString('utf8')
  } catch {
    return url
  }
}

function parseBingResults(html) {
  const results = []
  const seen = new Set()
  const blocks = html.split(/<li class="b_algo"/i).slice(1)
  for (const block of blocks) {
    const anchor = /<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    if (!anchor) continue
    const url = decodeBingUrl(anchor[1].replace(/&amp;/g, '&'))
    if (!/^https?:\/\//i.test(url) || seen.has(url) || /bing\.com|go\.microsoft\.com/i.test(url) || JUNK_DOMAINS.test(url)) continue
    const title = anchor[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
    if (!title || title.length < 3) continue
    const snippetMatch = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block)
    const snippet = snippetMatch
      ? snippetMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 400)
      : ''
    seen.add(url)
    results.push({ url, title, snippet })
    if (results.length >= 10) break
  }
  return results
}

async function searchMultipleEngines(query, engines = ['bing', 'wikipedia', 'duckduckgo']) {
  const promises = engines.map(async (engineName) => {
    const engine = SEARCH_ENGINES[engineName]
    if (!engine) return { engine: engineName, results: [] }
    try {
      const results = await engine.fetch(query)
      return { engine: engineName, results }
    } catch (error) {
      console.warn(`Search engine ${engineName} failed:`, error.message)
      return { engine: engineName, results: [] }
    }
  })
  const results = await Promise.allSettled(promises)
  return results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value)
}

async function extractContent(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    const html = await response.text()
    return extractMainContent(html)
  } catch {
    return null
  }
}

function extractMainContent(html) {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, 8000)
}

function deduplicateSources(sources) {
  const seen = new Set()
  return sources.filter((source) => {
    const normalized = source.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
    if (seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

function rankSources(sources, query) {
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
  return sources
    .map((source) => {
      let score = 0
      const text = `${source.title || ''} ${source.snippet || ''}`.toLowerCase()
      for (const term of queryTerms) {
        if (text.includes(term)) score += 1
      }
      if (source.url.includes('.gov') || source.url.includes('.edu')) score += 5
      if (source.url.includes('.org')) score += 3
      if (source.url.includes('wikipedia.org')) score += 6
      if (JUNK_DOMAINS.test(source.url)) score -= 10
      return { ...source, score }
    })
    .sort((a, b) => b.score - a.score)
}

export async function deepSearch(query, options = {}) {
  const { maxIterations = MAX_ITERATIONS, engines = ['bing', 'wikipedia', 'duckduckgo'] } = options
  let allSources = []
  let currentQuery = query
  const iterations = []

  for (let i = 0; i < maxIterations; i++) {
    const searchResults = await searchMultipleEngines(currentQuery)
    let iterationSources = []
    for (const { engine, results } of searchResults) {
      for (const result of results) {
        iterationSources.push({
          ...result,
          engine,
          iteration: i + 1,
        })
      }
    }
    iterationSources = deduplicateSources(iterationSources)
    iterationSources = rankSources(iterationSources, currentQuery).slice(0, MAX_SOURCES_PER_ITERATION)
    allSources = deduplicateSources([...allSources, ...iterationSources])
    iterations.push({ iteration: i + 1, query: currentQuery, sourcesCount: iterationSources.length })
    if (iterationSources.length === 0) break
    currentQuery = refineQuery(query, i + 1)
    if (currentQuery === query) break
  }

  const ranked = deduplicateSources(allSources)
    .filter((source) => (source.score ?? 0) >= 0)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
  // Prefer domain diversity: at most two results per domain so the answer is not
  // built from a single site, then fill the remaining slots by score.
  const perDomain = new Map()
  const diverse = []
  const overflow = []
  const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }
  for (const source of ranked) {
    const domain = domainOf(source.url)
    const count = perDomain.get(domain) || 0
    if (count < 2) { perDomain.set(domain, count + 1); diverse.push(source) }
    else overflow.push(source)
  }
  const finalSources = [...diverse, ...overflow].slice(0, MAX_TOTAL_SOURCES)
  return {
    query,
    sources: finalSources,
    iterations,
    totalSources: finalSources.length,
  }
}

function refineQuery(originalQuery, iterationIndex) {
  const angle = RESEARCH_ANGLES[iterationIndex - 1]
  return angle ? `${originalQuery} ${angle}` : originalQuery
}

function extractKeyTerms(sources) {
  const text = sources.map((s) => `${s.title} ${s.snippet || ''}`).join(' ')
  const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
  const freq = {}
  for (const word of words) freq[word] = (freq[word] || 0) + 1
  return Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .map(([word]) => word)
    .slice(0, 10)
}

export function formatDeepResearchOutput(searchResult, thinking) {
  const { query, sources, iterations, totalSources } = searchResult
  const lines = [
    `# بحث عميق: ${query}`,
    `**التكرارات:** ${iterations.length} | **المصادر:** ${totalSources}`,
    '',
    '## عملية التفكير',
    ...thinking.map((step, i) => `${i + 1}. ${step}`),
    '',
    '## المصادر',
    ...searchResult.sources.map((s, i) => `${i + 1}. **${s.title || 'بدون عنوان'}** - ${s.url}${s.snippet ? `\n   ${s.snippet}` : ''}`),
  ]
  return lines.join('\n')
}

export async function deepResearch(query, options = {}) {
  // Keep the original session-id form for the research board API while the
  // object form powers the richer UI pipeline.
  const legacySessionId = typeof options === 'string' ? options : null
  const config = legacySessionId ? {} : options
  const { maxIterations = MAX_ITERATIONS, onProgress, thinking = [] } = config

  if (legacySessionId) {
    board_post(legacySessionId, { agentId: 'planner', message: `تخطيط بحث: ${query}`, tags: ['research', 'plan'] })
  }

  thinking.push(`🔍 بدء البحث العميق: "${query}"`)

  const searchResult = await deepSearch(query, { maxIterations, onProgress })

  thinking.push(`📚 تم جمع ${searchResult.totalSources} مصدر من ${searchResult.iterations.length} دورة بحث`)

  if (legacySessionId) {
    board_post(legacySessionId, { agentId: 'validator', message: `التحقق من ${searchResult.totalSources} مصدر`, tags: ['research', 'verify'] })
  }

  if (searchResult.totalSources === 0) {
    thinking.push('⚠️ لم يتم العثور على مصادر ذات صلة')
    const empty = {
      mainQuestion: query,
      subQuestions: [{ question: query, keywords: [] }],
      report: 'لم يتم العثور على مصادر كافية.',
      sources: [],
    }
    if (legacySessionId) board_post(legacySessionId, { agentId: 'synthesizer', message: empty.report, tags: ['research', 'synthesis'] })
    return { ...empty, searchResult, thinking, answer: null }
  }

  thinking.push('🔍 تحليل وتلخيص المصادر...')

  const summaryPrompt = buildSummaryPrompt(searchResult.query, searchResult.sources)
  thinking.push('📝 بناء الإجابة النهائية...')

  const report = buildSummaryPrompt(searchResult.query, searchResult.sources)
  if (legacySessionId) board_post(legacySessionId, { agentId: 'synthesizer', message: 'تم تركيب تقرير البحث.', tags: ['research', 'synthesis'] })
  return {
    mainQuestion: query,
    subQuestions: [{ question: query, keywords: extractKeyTerms(searchResult.sources) }],
    report,
    sources: searchResult.sources,
    searchResult,
    thinking,
  }
}

export function buildSummaryPrompt(query, sources) {
  const sourceText = sources
    .map((s, i) => `[${i + 1}] ${s.title}: ${s.snippet || 'لا يوجد ملخص'} (${s.url})`)
    .join('\n')
  return `السؤال: ${query}\n\nالمصادر الموثوقة:\n${sourceText}\n\nبناءً على هذه المصادر فقط، اكتب إجابة شاملة ومفصلة مع الاستشهاد بالمصادر بأرقامها.`
}
