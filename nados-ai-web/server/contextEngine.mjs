// Context engine: gives Nados an effectively very large working context by
// combining a rolling extractive memory of older turns with relevance-based
// selection of the most related older messages, while keeping the newest turns
// verbatim. This does not claim a fictitious 100M-token model window; it retains
// the whole conversation's important content across an effectively unbounded
// stored history.

const STOP = new Set(['في', 'من', 'على', 'إلى', 'عن', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'ثم', 'هل', 'ما', 'هو', 'هي', 'مع', 'أو', 'و', 'لا', 'نعم', 'the', 'and', 'for', 'with', 'that', 'this', 'you', 'are', 'what', 'how'])

function keywords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
}

function overlapScore(a, b) {
  const setA = new Set(keywords(a))
  let score = 0
  for (const word of keywords(b)) if (setA.has(word)) score += 1
  return score
}

function digestLine(message) {
  const role = message.role === 'user' ? 'س' : 'ج'
  const text = String(message.content || '').replace(/\s+/g, ' ').trim()
  return `${role}: ${text.slice(0, 220)}${text.length > 220 ? '…' : ''}`
}

/**
 * @param {Array<{role:string,content:string}>} history
 * @param {string} message current user message
 * @param {{ budgetChars?: number, keepRecent?: number, maxRelevant?: number }} [options]
 * @returns {{ history: Array<{role:string,content:string}>, memory: string, stats: object }}
 */
export function buildContextHistory(history = [], message = '', options = {}) {
  const list = Array.isArray(history) ? history.filter((m) => m && typeof m.content === 'string') : []
  const budget = Math.max(4_000, Number(options.budgetChars) || 48_000)
  const keepRecent = Math.max(4, Number(options.keepRecent) || 12)
  const maxRelevant = Math.max(0, Number(options.maxRelevant) || 6)

  if (list.length <= keepRecent) {
    return { history: list, memory: '', stats: { total: list.length, recent: list.length, relevant: 0, digested: 0 } }
  }

  const recent = list.slice(-keepRecent)
  const older = list.slice(0, -keepRecent)

  // Pick older turns most related to the current message (verbatim, cheap RAG).
  const scored = older
    .map((entry, index) => ({ entry, index, score: overlapScore(entry.content, message) }))
    .sort((a, b) => b.score - a.score || b.index - a.index)
  const relevant = scored.filter((item) => item.score > 0).slice(0, maxRelevant).sort((a, b) => a.index - b.index).map((item) => item.entry)
  const relevantIndexes = new Set(scored.filter((item) => item.score > 0).slice(0, maxRelevant).map((item) => item.index))
  const digested = older.filter((_, index) => !relevantIndexes.has(index))

  // Extractive memory of everything not carried verbatim.
  const memoryCap = Math.floor(budget * 0.25)
  const memoryLines = []
  let memoryChars = 0
  for (const entry of digested) {
    const line = digestLine(entry)
    if (memoryChars + line.length > memoryCap) break
    memoryLines.push(line)
    memoryChars += line.length + 1
  }
  const memory = memoryLines.length
    ? `ملخص ذاكرة المحادثة (أقدم الرسائل):\n${memoryLines.join('\n')}`
    : ''

  // Keep verbatim turns within budget (drop oldest of the kept set if needed).
  const kept = [...relevant, ...recent]
  const keptBudget = Math.floor(budget * 0.9)
  let used = 0
  const trimmed = []
  for (let i = kept.length - 1; i >= 0; i -= 1) {
    const entry = kept[i]
    const size = String(entry.content).length
    if (used + size > keptBudget && trimmed.length >= 2) break
    trimmed.unshift(entry)
    used += size
  }

  return {
    history: trimmed,
    memory,
    stats: { total: list.length, recent: recent.length, relevant: relevant.length, digested: digested.length, keptChars: used, memoryChars },
  }
}
