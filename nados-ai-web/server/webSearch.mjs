const DDG_ENDPOINT = 'https://lite.duckduckgo.com/lite/?q='
const MAX_RESULTS = 6
const REQUEST_TIMEOUT = 10_000

export async function fetchWebResults(query) {
  const trimmed = String(query || '').trim().slice(0, 400)
  if (!trimmed) return []
  try {
    const response = await fetch(`${DDG_ENDPOINT}${encodeURIComponent(trimmed)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'ar,en;q=0.9',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    })
    if (!response.ok) return []
    const html = await response.text()
    if (/anomaly|captcha/i.test(html)) return []
    return parseWebResults(html)
  } catch {
    return []
  }
}

export function parseWebResults(html) {
  const results = []
  const seen = new Set()
  const anchorPattern = /<a[^>]+href=["']([^"']+)["'][^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g
  let match
  while ((match = anchorPattern.exec(html)) && results.length < MAX_RESULTS) {
    let url = match[1]
    const uddg = /[?&]uddg=([^&]+)/.exec(url)
    if (uddg) {
      try { url = decodeURIComponent(uddg[1]) } catch { continue }
    }
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    results.push({ url, title: match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() })
  }
  const snippetPattern = /<[^>]+class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/(?:td|div|span)>/g
  let index = 0
  while ((match = snippetPattern.exec(html)) && index < results.length) {
    results[index].snippet = match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300)
    index += 1
  }
  return results
}

export function webResultsInstructions(results) {
  const lines = results.map((item, index) => `${index + 1}. ${item.title || item.url}${item.snippet ? `\n   ${item.snippet}` : ''}\n   ${item.url}`)
  return [
    'نتائج بحث ويب فعلية جُلبت للتو لهذا السؤال. اعتمد عليها في إجابتك واستشهد بأرقام النتائج أو روابطها، ولا تختلق مصادر أخرى.',
    ...lines,
  ].join('\n')
}
