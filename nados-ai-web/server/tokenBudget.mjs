const CHARS_PER_TOKEN = 3
const MIN_CHARS_PER_TOKEN = 2.5
const SAFETY_MARGIN_TOKENS = 2_048
const MIN_OUTPUT_TOKENS = 256
const MIN_HISTORY_CHARS = 24_000
const IMAGE_PROMPT_TOKENS = 1_600
const DEFAULT_LIMITS = { context: 128_000, maxOutput: 32_768 }

const MODEL_LIMITS = [
  [/compound-mini/, { context: 131_072, maxOutput: 32_768, tpm: 30_000, searchToolTokens: 24_000 }],
  [/compound/, { context: 131_072, maxOutput: 32_768, tpm: 30_000, searchToolTokens: 24_000 }],
  [/gpt-oss/, { context: 131_072, maxOutput: 32_768 }],
  [/qwen/, { context: 131_072, maxOutput: 32_768 }],
  [/allam/, { context: 32_768, maxOutput: 8_192 }],
  [/gemini/, { context: 1_000_000, maxOutput: 65_535 }],
  [/nemotron/, { context: 131_072, maxOutput: 32_768 }],
  [/glm/, { context: 131_072, maxOutput: 32_768 }],
  [/deepseek/, { context: 131_072, maxOutput: 32_768 }],
  [/minimax/, { context: 131_072, maxOutput: 32_768 }],
  [/diffusiongemma/, { context: 131_072, maxOutput: 16_384 }],
  [/llama-3\.3-70b/, { context: 131_072, maxOutput: 8_192 }],
  [/llama-3\.1-8b/, { context: 131_072, maxOutput: 8_192 }],
]

export function estimateTokens(text) {
  const value = String(text || '')
  if (!value) return 0
  const arabicChars = (value.match(/[\u0600-\u06FF]/g) || []).length
  const charsPerToken = CHARS_PER_TOKEN - (arabicChars / value.length) * (CHARS_PER_TOKEN - MIN_CHARS_PER_TOKEN)
  return Math.ceil(value.length / charsPerToken)
}

export function modelTokenLimits(model) {
  const name = String(model || '').toLowerCase()
  for (const [pattern, limits] of MODEL_LIMITS) {
    if (pattern.test(name)) return limits
  }
  return DEFAULT_LIMITS
}

function attachmentList({ file = null, files = [] }) {
  if (Array.isArray(files) && files.length) return files
  return file ? [file] : []
}

function promptTokens({ instructions = '', history = [], message = '', file = null, files = [] }) {
  let fileTokens = 0
  for (const item of attachmentList({ file, files })) {
    if (item?.mimetype?.startsWith('image/')) fileTokens += IMAGE_PROMPT_TOKENS
    else if (item?.buffer) fileTokens += estimateTokens(item.buffer.toString('utf8'))
  }
  return estimateTokens(instructions) + estimateTokens(message)
    + history.reduce((total, item) => total + estimateTokens(item?.content), 0)
    + fileTokens
}

export function searchToolReserve(model) {
  return modelTokenLimits(model).searchToolTokens || 0
}

export function computeMaxTokens({ model, instructions = '', history = [], message = '', file = null, files = [] }) {
  const limits = modelTokenLimits(model)
  const used = promptTokens({ instructions, history, message, file, files })
  let budget = Math.min(limits.maxOutput, limits.context - used - SAFETY_MARGIN_TOKENS)
  if (limits.tpm) budget = Math.min(budget, limits.tpm - used - SAFETY_MARGIN_TOKENS)
  const globalCeiling = Number(process.env.NADOS_MAX_OUTPUT_TOKENS)
  if (globalCeiling > 0) budget = Math.min(budget, globalCeiling)
  return Math.max(MIN_OUTPUT_TOKENS, Math.floor(budget))
}

export function historyCharacterBudget(model) {
  const limits = modelTokenLimits(model)
  const requestLimit = Math.min(limits.context, limits.tpm || limits.context)
  const reservedForOutput = Math.min(limits.maxOutput, Math.floor(requestLimit * 0.6))
  const availableTokens = Math.max(requestLimit - reservedForOutput - SAFETY_MARGIN_TOKENS, 8_192)
  return Math.max(MIN_HISTORY_CHARS, Math.floor(availableTokens * MIN_CHARS_PER_TOKEN))
}

export function trimToLimit(content, limit) {
  const value = String(content || '')
  if (value.length <= limit) return value
  const marker = '\n[تم اختصار السياق]\n'
  if (limit <= marker.length + 2) return value.slice(0, Math.max(0, limit))
  const available = Math.max(2, limit - marker.length)
  const head = Math.ceil(available / 2)
  return `${value.slice(0, head)}${marker}${value.slice(-(available - head))}`
}

export function fitMessageToContext({ model, instructions = '', history = [], message = '' }) {
  const limits = modelTokenLimits(model)
  const requestLimit = Math.min(limits.context, limits.tpm || limits.context)
  const reservedForOutput = Math.min(limits.maxOutput, 32_768)
  const availablePromptTokens = Math.max(requestLimit - reservedForOutput - SAFETY_MARGIN_TOKENS, 4_096)
  const usedTokens = estimateTokens(instructions)
    + history.reduce((total, item) => total + estimateTokens(item?.content), 0)
  const maxChars = Math.max(Math.floor((availablePromptTokens - usedTokens) * MIN_CHARS_PER_TOKEN), MIN_HISTORY_CHARS)
  return trimToLimit(message, maxChars)
}

export function descendingBudgets(budget, floor = 512) {
  const requested = Math.max(1, Math.floor(Number(budget) || 1))
  const minimum = Math.min(Math.max(1, Math.floor(floor)), requested)
  const ladder = []
  let current = requested
  while (current >= minimum) {
    ladder.push(current)
    if (current === minimum) break
    current = Math.max(minimum, Math.floor(current / 2))
  }
  return [...new Set(ladder)]
}

export function isTokenBudgetError(error) {
  const status = Number(error?.status || 0)
  const detail = String(error?.message || '')
  return status === 413 || (status === 400 && /max_tokens|max_completion_tokens|maximum.{0,20}tokens/i.test(detail))
}
