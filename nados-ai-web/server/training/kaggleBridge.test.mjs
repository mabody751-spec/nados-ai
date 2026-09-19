import test from 'node:test'
import assert from 'node:assert/strict'
import { exportDatasetFromSupabase, kaggleEnabled, kernelStatus, verifyKaggleCredentials } from './kaggleBridge.mjs'

const originalFetch = globalThis.fetch

test.afterEach(() => {
  globalThis.fetch = originalFetch
  delete process.env.KAGGLE_USERNAME
  delete process.env.KAGGLE_KEY
})

test('reports honest waiting state without credentials', async () => {
  delete process.env.KAGGLE_USERNAME
  delete process.env.KAGGLE_KEY
  assert.equal(kaggleEnabled(), false)
  const verification = await verifyKaggleCredentials()
  assert.equal(verification.ok, false)
  assert.match(verification.error, /KAGGLE_WAITING_FOR_CREDENTIALS/)
  await assert.rejects(() => exportDatasetFromSupabase(), /Supabase غير مهيأ/)
})

test('verifies credentials through the Kaggle API', async () => {
  process.env.KAGGLE_USERNAME = 'nados-test'
  process.env.KAGGLE_KEY = 'test-key'
  let authHeader = ''
  globalThis.fetch = async (url, options) => {
    authHeader = options?.headers?.Authorization || ''
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const verification = await verifyKaggleCredentials()
  assert.equal(verification.ok, true)
  assert.match(authHeader, /^Basic /)
})

test('exports training examples as JSONL from Supabase', async () => {
  process.env.SUPABASE_URL = 'https://nados-test.supabase.co'
  process.env.SUPABASE_ANON_KEY = 'test-key'
  globalThis.fetch = async () => new Response(JSON.stringify([
    { messages: [{ role: 'user', content: 'سؤال أول' }, { role: 'assistant', content: 'جواب أول' }], quality_score: 0.8 },
    { messages: [{ role: 'user', content: 'سؤال ثانٍ' }, { role: 'assistant', content: 'جواب ثانٍ' }], quality_score: 0.7 },
  ]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const dataset = await exportDatasetFromSupabase()
  assert.equal(dataset.count, 2)
  const lines = dataset.jsonl.split('\n')
  assert.equal(lines.length, 2)
  const first = JSON.parse(lines[0])
  assert.equal(first.question, 'سؤال أول')
  assert.equal(first.answer, 'جواب أول')
})

test('reports kernel not_found honestly before first training', async () => {
  process.env.KAGGLE_USERNAME = 'nados-test'
  process.env.KAGGLE_KEY = 'test-key'
  globalThis.fetch = async () => new Response(JSON.stringify({ message: '404 - Kernel not found' }), { status: 404 })
  const kernel = await kernelStatus()
  assert.equal(kernel.status, 'not_found')
  assert.match(kernel.message, /شغّل تدريباً/)
})
