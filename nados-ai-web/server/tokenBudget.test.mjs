import test from 'node:test'
import assert from 'node:assert/strict'
import { computeMaxTokens, descendingBudgets, estimateTokens, fitMessageToContext, historyCharacterBudget, isTokenBudgetError, modelTokenLimits, searchToolReserve } from './tokenBudget.mjs'

test.beforeEach(() => { delete process.env.NADOS_MAX_OUTPUT_TOKENS })

test('estimates more tokens for Arabic-dense text', () => {
  assert.equal(estimateTokens('x'.repeat(300)), 100)
  assert.ok(estimateTokens('م'.repeat(300)) > 100)
})

test('gives the reply the full output room the model allows', () => {
  assert.equal(computeMaxTokens({ model: 'qwen/qwen3.8-27b', instructions: 'system', message: 'hi' }), modelTokenLimits('qwen/qwen3.8-27b').maxOutput)
})

test('shrinks the budget as the conversation grows', () => {
  const short = computeMaxTokens({ model: 'qwen/qwen3.8-27b', instructions: '', message: 'hi' })
  const long = computeMaxTokens({ model: 'qwen/qwen3.8-27b', instructions: '', message: 'hi', history: [{ role: 'user', content: 'x'.repeat(360_000) }] })
  assert.ok(long < short)
  assert.ok(long >= 256)
})

test('caps metered models to their tokens-per-minute', () => {
  const budget = computeMaxTokens({ model: 'groq/compound-mini', instructions: '', message: 'hi' })
  assert.ok(budget > 20_000, `expected a large budget, got ${budget}`)
  assert.ok(budget <= 30_000 - 2_048, `expected budget within free-tier TPM, got ${budget}`)
})

test('reserves reply room when trimming history to the model context', () => {
  assert.equal(historyCharacterBudget('qwen/qwen3.8-27b'), Math.floor((131_072 - 32_768 - 2_048) * 2.5))
  assert.equal(historyCharacterBudget('groq/compound-mini'), Math.floor((30_000 - Math.floor(30_000 * 0.6) - 2_048) * 2.5))
})

test('knows the hidden token cost of built-in search tools', () => {
  assert.equal(searchToolReserve('groq/compound-mini'), 24_000)
  assert.equal(searchToolReserve('groq/compound'), 24_000)
  assert.equal(searchToolReserve('qwen/qwen3.8-27b'), 0)
})

test('honors a global output ceiling when configured', () => {
  process.env.NADOS_MAX_OUTPUT_TOKENS = '4096'
  assert.equal(computeMaxTokens({ model: 'qwen/qwen3.8-27b', instructions: '', message: 'hi' }), 4096)
})

test('builds a halving retry ladder for rejected budgets', () => {
  assert.deepEqual(descendingBudgets(2_000), [2_000, 1_000, 512])
  assert.deepEqual(descendingBudgets(300), [300])
})

test('detects budget rejections from provider errors', () => {
  assert.equal(isTokenBudgetError({ status: 413, message: 'Request Entity Too Large' }), true)
  assert.equal(isTokenBudgetError({ status: 400, message: "'max_completion_tokens' must be at most 8192" }), true)
  assert.equal(isTokenBudgetError({ status: 400, message: 'model not found' }), false)
  assert.equal(isTokenBudgetError({ status: 429, message: 'rate limit' }), false)
})

test('keeps a short message untouched', () => {
  const message = 'سؤال قصير جداً'
  assert.equal(fitMessageToContext({ model: 'qwen/qwen3.8-27b', instructions: 'system', message }), message)
})

test('trims a long message while keeping its head and tail', () => {
  const message = `${'ب'.repeat(300_000)}${'ت'.repeat(290_000)}الرمز الأخير 9911${'ت'.repeat(10_000)}`
  const fitted = fitMessageToContext({ model: 'qwen/qwen3.8-27b', instructions: '', history: [], message })
  assert.ok(fitted.length < message.length)
  assert.match(fitted, /^ب+/)
  assert.match(fitted, /الرمز الأخير 9911/)
  assert.match(fitted, /ت+$/)
  assert.ok(fitted.includes('تم اختصار السياق'))
})

test('still gives a long message room when the history is huge', () => {
  const message = 'ب'.repeat(100_000)
  const fitted = fitMessageToContext({
    model: 'qwen/qwen3.8-27b',
    instructions: 'system',
    history: [{ role: 'user', content: 'x'.repeat(600_000) }],
    message,
  })
  assert.ok(fitted.length < message.length)
  assert.ok(fitted.length >= 24_000)
})
