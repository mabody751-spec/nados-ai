import test from 'node:test'
import assert from 'node:assert/strict'
import { getConversations, saveConversation, supabaseEnabled } from './supabaseStore.mjs'

const originalFetch = globalThis.fetch

test.afterEach(() => { globalThis.fetch = originalFetch })

test('reports disabled without credentials', async () => {
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  delete process.env.SUPABASE_ANON_KEY
  assert.equal(supabaseEnabled(), false)
  assert.deepEqual(await getConversations(), [])
  assert.equal(await saveConversation({ message: 'hi' }), false)
})

test('saves conversations through the Supabase REST API', async () => {
  process.env.SUPABASE_URL = 'https://nados-test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  let captured = null
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options }
    return new Response(null, { status: 201 })
  }
  const ok = await saveConversation({ message: 'سؤال', reply: ['جواب'], mode: 'web', provider: 'groq', sources: [{ url: 'https://example.com' }] })
  assert.equal(ok, true)
  assert.match(captured.url, /\/rest\/v1\/conversations$/)
  const body = JSON.parse(captured.options.body)
  assert.equal(body.message, 'سؤال')
  assert.equal(body.reply, 'جواب')
  assert.equal(body.provider, 'groq')
  assert.equal(body.sources_count, 1)
  assert.equal(captured.options.headers.apikey, 'service-key')
})

test('fetches recent conversations ordered by date', async () => {
  process.env.SUPABASE_URL = 'https://nados-test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  let requestedUrl = ''
  globalThis.fetch = async (url) => {
    requestedUrl = String(url)
    return new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const rows = await getConversations(10)
  assert.equal(rows.length, 2)
  assert.match(requestedUrl, /order=created_at\.desc/)
  assert.match(requestedUrl, /limit=10/)
})

test('rejects non-supabase urls', () => {
  process.env.SUPABASE_URL = 'https://evil.example.com'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  assert.equal(supabaseEnabled(), false)
})
